import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { chromium, webkit } from "playwright";
import { isHttpError } from "@sveltejs/kit";
import { db } from "../src/lib/server/db";
import { blankContent } from "../src/lib/contracts";
import { hash, token } from "../src/lib/server/auth";
import { encryptXToken, decryptXToken } from "../src/lib/server/x-auth";
import { postToX, xPublishing } from "../src/lib/server/x-publishing";
import { storeMedia, mediaPath } from "../src/lib/server/media";

test("X publishing binds saved content and account, reserves costs, and blocks duplicates and uncertain retries", async (t) => {
  process.env.X_CLIENT_ID = "test-client";
  process.env.X_CLIENT_SECRET = "test-secret";
  process.env.X_API_MONTHLY_BUDGET_USD = "100";
  const userId = randomUUID(),
    otherId = randomUUID();
  const xId = `${Date.now()}17`;
  const content = blankContent("Posting tester", "editable_not_x");
  content.posts[0].text = "Ready for a second look 👀\nhttps://example.com/a";
  const draftId = randomUUID();
  const session = token();
  let posts = 0,
    refreshes = 0,
    outcome = "success";
  const originalFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.x.com/2/oauth2/token") {
        refreshes++;
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 7200,
          scope: "tweet.read users.read offline.access tweet.write",
        });
      }
      if (String(url) !== "https://api.x.com/2/tweets")
        return originalFetch(url, init);
      posts++;
      assert.equal(init?.method, "POST");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer new-access",
      );
      assert.deepEqual(JSON.parse(String(init?.body)), {
        text: content.posts[0].text,
      });
      if (outcome === "unknown") throw new TypeError("simulated lost response");
      if (outcome === "rejected") return Response.json({}, { status: 403 });
      return Response.json(
        { data: { id: "123456789123456789" } },
        { status: 201 },
      );
    },
  );
  const rejects = (status: number) => (e: unknown) =>
    isHttpError(e) && e.status === status;
  const post = (version = 1, account = xId) =>
    postToX(userId, draftId, version, account);
  try {
    for (const id of [userId, otherId])
      await db.query(
        "INSERT INTO users(id,email,name,handle,password_hash,plan,pro_limits) SELECT $1,$2,'Posting tester','editable_not_x','unused','pro',limits FROM plan_allowances WHERE plan='pro'",
        [id, `${id}@example.test`],
      );
    await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
      draftId,
      userId,
      content,
    ]);
    await db.query(
      "INSERT INTO x_accounts(user_id,x_id,access_token,refresh_token,expires_at,scope,profile) VALUES($1,$2,$3,$4,now()-interval '1 minute','tweet.read users.read offline.access tweet.write',$5)",
      [
        userId,
        xId,
        await encryptXToken("old-access"),
        await encryptXToken("old-refresh"),
        { id: xId, username: "actual_account", name: "Real X account" },
      ],
    );
    await assert.rejects(post(), rejects(403));
    await db.query(
      "INSERT INTO feature_grants(user_id,feature) VALUES($1,'x-publishing')",
      [userId],
    );
    await assert.rejects(postToX(otherId, draftId, 1, xId), rejects(404));
    await assert.rejects(post(1, "999"), rejects(409));
    await assert.rejects(post(2), rejects(409));
    assert.equal(posts, 0);
    assert.equal(refreshes, 1);
    const rotated = (
      await db.query("SELECT refresh_token FROM x_accounts WHERE user_id=$1", [
        userId,
      ])
    ).rows[0];
    assert.equal(
      await decryptXToken(rotated.refresh_token),
      "new-refresh",
      "A later stale-draft rejection must not roll back provider token rotation",
    );
    const result = await Promise.allSettled([post(), post()]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(posts, 1);
    const published = await xPublishing(userId, draftId);
    assert.equal(
      published.publication?.url,
      "https://x.com/i/web/status/123456789123456789",
    );
    assert.equal(published.publication?.text, content.posts[0].text);
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT estimated_usd FROM api_usage WHERE user_id=$1 AND model='post-create'",
            [userId],
          )
        ).rows[0].estimated_usd,
      ),
      0.2,
    );
    await assert.rejects(post(), rejects(409));
    await db.query("DELETE FROM x_publications WHERE draft_id=$1", [draftId]);
    outcome = "unknown";
    await assert.rejects(post(), rejects(409));
    await assert.rejects(post(), rejects(409));
    assert.equal(posts, 2, "Lost responses never automatically retry");
    await db.query("DELETE FROM x_publications WHERE draft_id=$1", [draftId]);
    outcome = "rejected";
    await assert.rejects(post(), rejects(502));
    assert.equal(
      (await xPublishing(userId, draftId)).publication?.status,
      "failed",
    );
    await t.test(
      "media completes before posting; threads resume only unfinished posts and retain reply/quote relationships",
      async (t) => {
        await db.query(
          "UPDATE x_accounts SET scope=scope || ' media.write' WHERE user_id=$1",
          [userId],
        );
        await db.query(
          "UPDATE users SET pro_limits=jsonb_set(pro_limits,'{x_usd}','100') WHERE id=$1",
          [userId],
        );
        const id = randomUUID();
        const draft = structuredClone(content);
        draft.posts[0].text = "";
        draft.posts.push({
          id: randomUUID(),
          text: "Second, not first",
          media: [],
        });
        draft.source = {
          kind: "reply",
          url: "https://x.com/person/status/999123456789",
        };
        await db.query(
          "INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)",
          [id, userId, draft],
        );
        const fixture = join(tmpdir(), `${id}.webm`);
        const sent: Record<string, unknown>[] = [];
        let failSecond = true,
          loseSecond = false,
          processingFailure = false,
          mediaId = 8000;
        const initialized: { mime: string; bytes: number; category: string }[] =
          [];
        const appended: Buffer[] = [];
        let checks = 0;
        t.mock.method(
          globalThis,
          "fetch",
          async (url: string | URL | Request, init?: RequestInit) => {
            const path = String(url).replace("https://api.x.com/2/", "");
            if (path === "media/upload/initialize") {
              const body = JSON.parse(String(init?.body));
              initialized.push({
                mime: body.media_type,
                bytes: body.total_bytes,
                category: body.media_category,
              });
              return Response.json({
                data: { id: String(++mediaId), expires_after_secs: 3600 },
              });
            }
            if (path.endsWith("/append")) {
              const form = init?.body as FormData;
              assert.equal(form.get("segment_index"), "0");
              appended.push(
                Buffer.from(await (form.get("media") as Blob).arrayBuffer()),
              );
              return new Response(null, { status: 204 });
            }
            if (path.endsWith("/finalize"))
              return Response.json({
                data: {
                  id: String(mediaId),
                  processing_info: {
                    state: processingFailure ? "failed" : "pending",
                    check_after_secs: 0,
                  },
                },
              });
            if (path.startsWith("media/upload?")) {
              checks++;
              return Response.json({
                data: {
                  id: String(mediaId),
                  processing_info: { state: "succeeded" },
                },
              });
            }
            assert.equal(
              path,
              "tweets",
              "Never access any real provider endpoint",
            );
            const body = JSON.parse(String(init?.body));
            sent.push(body);
            if (body.text === "Second, not first" && loseSecond)
              throw new TypeError("Lost second-post response");
            if (body.text === "Second, not first" && failSecond)
              return Response.json({}, { status: 403 });
            return Response.json(
              {
                data: {
                  id:
                    body.text === "Second, not first"
                      ? "222123456789"
                      : "111123456789",
                },
              },
              { status: 201 },
            );
          },
        );
        const advance = () => postToX(userId, id, 1, xId);
        const finish = async () => {
          for (let i = 0; i < 50; i++) {
            const result = await advance();
            if (result.publication?.status === "posted") return result;
            if (result.publication?.retryAfter)
              await new Promise((r) =>
                setTimeout(r, result.publication!.retryAfter),
              );
          }
          assert.fail("Publishing failed to finish within bounded steps");
        };
        const paths: string[] = [];
        try {
          const original = await sharp({
            create: {
              width: 40,
              height: 30,
              channels: 3,
              background: "#ff6b5b",
            },
          })
            .avif()
            .toBuffer();
          const photo = await storeMedia(original, "photo.avif", id, userId);
          paths.push(mediaPath(photo.id));
          draft.posts[0].media = [photo.id];
          await db.query("UPDATE drafts SET content=$2 WHERE id=$1", [
            id,
            draft,
          ]);
          // Older grants remain good for text, but cannot upload without consent.
          await db.query(
            "UPDATE x_accounts SET scope=replace(scope,' media.write','') WHERE user_id=$1",
            [userId],
          );
          await assert.rejects(advance(), rejects(409));
          assert.equal(initialized.length, 0);
          await db.query(
            "UPDATE x_accounts SET scope=scope || ' media.write' WHERE user_id=$1",
            [userId],
          );
          await assert.rejects(finish(), rejects(502));
          assert.equal(sent.length, 2);
          assert.deepEqual(sent[0], {
            media: { media_ids: ["8001"] },
            reply: { in_reply_to_tweet_id: "999123456789" },
          });
          assert.deepEqual(sent[1], {
            text: "Second, not first",
            reply: { in_reply_to_tweet_id: "111123456789" },
          });
          assert.equal(initialized[0].mime, "image/jpeg");
          assert.equal(initialized[0].bytes, appended[0].length);
          assert.equal((await sharp(appended[0]).metadata()).format, "jpeg");
          assert.deepEqual(
            await readFile(mediaPath(photo.id)),
            original,
            "Original review media stays intact",
          );
          assert.equal(checks, 1, "Wait for media readiness before posting");
          const partial = await xPublishing(userId, id);
          assert.equal(partial.publication?.completed, 1);
          assert.equal(partial.publication?.resumable, true);
          assert.equal(
            (await db.query("SELECT posted_at FROM drafts WHERE id=$1", [id]))
              .rows[0].posted_at,
            null,
            "A partially published thread stays in Drafts",
          );
          await db.query("UPDATE drafts SET edit_version=2 WHERE id=$1", [id]);
          await assert.rejects(postToX(userId, id, 2, xId), rejects(409));
          await db.query("UPDATE drafts SET edit_version=1 WHERE id=$1", [id]);
          failSecond = false;
          assert.equal((await finish()).publication?.completed, 2);
          assert.ok(
            (await db.query("SELECT posted_at FROM drafts WHERE id=$1", [id]))
              .rows[0].posted_at,
            "The fully published thread moves to Done",
          );
          assert.equal(
            sent.filter((p) => !p.text).length,
            1,
            "Never resend the confirmed opening post",
          );
          // Actual WebM conversion exercises the same upload path for videos.
          await db.query("DELETE FROM x_publications WHERE draft_id=$1", [id]);
          execFileSync("ffmpeg", [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=160x120:d=0.8",
            "-c:v",
            "libvpx-vp9",
            fixture,
          ]);
          const video = await storeMedia(
            await readFile(fixture),
            "clip.webm",
            id,
            userId,
          );
          paths.push(mediaPath(video.id));
          draft.posts = [
            { ...draft.posts[0], text: "Video quote", media: [video.id] },
          ];
          draft.source = {
            kind: "quote",
            url: "https://x.com/person/status/999123456789",
          };
          await db.query("UPDATE drafts SET content=$2 WHERE id=$1", [
            id,
            draft,
          ]);
          await finish();
          assert.equal(initialized.at(-1)?.mime, "video/mp4");
          assert.equal(initialized.at(-1)?.category, "tweet_video");
          assert.equal(appended.at(-1)?.subarray(4, 8).toString(), "ftyp");
          assert.deepEqual(sent.at(-1), {
            text: "Video quote",
            media: { media_ids: ["8002"] },
            quote_tweet_id: "999123456789",
          });
          await db.query("DELETE FROM x_publications WHERE draft_id=$1", [id]);
          delete draft.source;
          const gif = await storeMedia(
            await sharp(original).gif().toBuffer(),
            "animation.gif",
            id,
            userId,
          );
          paths.push(mediaPath(gif.id));
          draft.posts[0] = {
            ...draft.posts[0],
            text: "A GIF",
            media: [gif.id],
          };
          await db.query("UPDATE drafts SET content=$2 WHERE id=$1", [
            id,
            draft,
          ]);
          await finish();
          assert.equal(initialized.at(-1)?.category, "tweet_gif");
          assert.equal(appended.at(-1)?.subarray(0, 3).toString(), "GIF");
          await db.query("DELETE FROM x_publications WHERE draft_id=$1", [id]);
          const photos = [photo.id];
          for (const format of ["jpeg", "png", "webp"] as const) {
            const image = await storeMedia(
              await sharp(original).toFormat(format).toBuffer(),
              `photo.${format}`,
              id,
              userId,
            );
            photos.push(image.id);
            paths.push(mediaPath(image.id));
          }
          draft.posts[0] = {
            ...draft.posts[0],
            text: "Four photos",
            media: photos,
          };
          await db.query("UPDATE drafts SET content=$2 WHERE id=$1", [
            id,
            draft,
          ]);
          await finish();
          assert.deepEqual(sent.at(-1), {
            text: "Four photos",
            media: { media_ids: ["8004", "8005", "8006", "8007"] },
          });
          await db.query("DELETE FROM x_publications WHERE draft_id=$1", [id]);
          processingFailure = true;
          const before = sent.length;
          await assert.rejects(finish(), rejects(502));
          assert.equal(
            sent.length,
            before,
            "Failed media must never fall back to a text-only post",
          );
          await db.query("DELETE FROM x_publications WHERE draft_id=$1", [id]);
          draft.posts = [
            { id: randomUUID(), text: "Opening only once", media: [] },
            { id: randomUUID(), text: "Second, not first", media: [] },
          ];
          await db.query("UPDATE drafts SET content=$2 WHERE id=$1", [
            id,
            draft,
          ]);
          loseSecond = true;
          await assert.rejects(finish(), rejects(409));
          const uncertain = await xPublishing(userId, id);
          assert.equal(uncertain.publication?.completed, 1);
          assert.equal(uncertain.publication?.status, "unknown");
          assert.equal(uncertain.publication?.resumable, false);
          const attempts = sent.length;
          await assert.rejects(advance(), rejects(409));
          assert.equal(
            sent.length,
            attempts,
            "An uncertain later post cannot replay any of the thread",
          );
        } finally {
          await db.query("DELETE FROM drafts WHERE id=$1", [id]);
          await rm(fixture, { force: true });
          for (const path of paths) await rm(path, { force: true });
        }
      },
    );
    // Browser checks only intercept the publication boundary. No real X writes.
    await db.query("DELETE FROM x_publications WHERE draft_id=$1", [draftId]);
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(session), userId],
    );
    const browser = await (
      process.env.TEST_BROWSER === "webkit" ? webkit : chromium
    ).launch();
    try {
      const base = process.env.TEST_BASE_URL!;
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
        // Keep publication mocks authoritative; PWA coverage runs separately.
        serviceWorkers: "block",
      });
      await context.addCookies([
        { name: "lastpeek_session", value: session, url: base },
      ]);
      const page = await context.newPage();
      let requests = 0;
      await page.route("**/post-to-x", async (route) => {
        requests++;
        assert.deepEqual(route.request().postDataJSON(), { version: 1, xId });
        await route.fulfill({
          status: 200,
          json: {
            ...published,
            publication: { ...published.publication, version: 1 },
          },
        });
      });
      await page.goto(`${base}/drafts/${draftId}`);
      const button = page.getByRole("button", {
        name: "Post to X",
        exact: true,
      });
      await button.waitFor();
      await button.click();
      const dialog = page.getByRole("dialog", { name: "Post to X?" });
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /@actual_account/);
      assert.match(
        await dialog.innerText(),
        /hold the post button to skip confirmation/i,
      );
      assert.equal(await dialog.getByRole("checkbox").count(), 0);
      assert.equal(
        (await dialog.innerText()).includes(content.posts[0].text),
        false,
      );
      assert.equal(requests, 0);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      const box = (await button.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.move(box.x - 30, box.y - 30);
      await page.mouse.up();
      assert.equal(requests, 0);
      assert.equal(await dialog.isVisible(), false);
      await button.focus();
      await page.keyboard.press("Enter");
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      await button.hover();
      await page.mouse.down();
      await page.waitForTimeout(1750);
      await page.mouse.up();
      await page.getByRole("link", { name: "View on X" }).waitFor();
      assert.equal(
        requests,
        1,
        "Hold sends once and does not open confirmation on release",
      );
      assert.equal(await dialog.isVisible(), false);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await page.reload();
        await button.waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const add = (await page
          .getByRole("button", { name: "Add post to thread" })
          .boundingBox())!;
        const publish = (await button.boundingBox())!;
        assert.ok(
          publish.x > add.x && Math.abs(publish.y - add.y) < 5,
          "Post stays to the right of add on narrow screens",
        );
      }
      const thread = structuredClone(content);
      thread.posts.push({ id: randomUUID(), text: "A second post", media: [] });
      await db.query("UPDATE drafts SET content=$2 WHERE id=$1", [
        draftId,
        thread,
      ]);
      await page.reload();
      const postAll = page.getByRole("button", {
        name: "Post all",
        exact: true,
      });
      await postAll.waitFor();
      assert.equal(
        await postAll.isDisabled(),
        false,
        "Threads can publish all posts",
      );
      await page.unroute("**/post-to-x");
      let steps = 0;
      await page.route("**/post-to-x", async (route) => {
        steps++;
        await route.fulfill({
          status: 200,
          json: {
            ...published,
            publication: {
              ...published.publication,
              status: steps === 3 ? "posted" : "pending",
              url: steps === 3 ? published.publication!.url : null,
              completed: steps === 1 ? 0 : steps === 2 ? 1 : 2,
              total: 2,
              phase: "Posting",
              resumable: steps < 3,
            },
          },
        });
      });
      await postAll.click();
      await page
        .getByRole("dialog", { name: "Post all to X?" })
        .getByRole("button", { name: "Post now", exact: true })
        .click();
      await page
        .getByRole("link", { name: "View on X", exact: true })
        .waitFor();
      assert.equal(
        steps,
        3,
        "One confirmation advances the job until every post is confirmed",
      );
      await db.query("UPDATE drafts SET content=$2 WHERE id=$1", [
        draftId,
        content,
      ]);
      await db.query(
        "UPDATE x_accounts SET scope='tweet.read users.read' WHERE user_id=$1",
        [userId],
      );
      await page.reload();
      await page
        .getByRole("button", { name: "Allow posting", exact: true })
        .waitFor();
      await db.query("DELETE FROM x_accounts WHERE user_id=$1", [userId]);
      await page.reload();
      await page
        .getByRole("button", { name: "Connect X", exact: true })
        .waitFor();
      const csrf = await context.request.post(
        `${base}/api/drafts/${draftId}/post-to-x`,
        {
          data: { version: 1, xId },
          headers: { Origin: "https://evil.example" },
        },
      );
      assert.equal(csrf.status(), 403);
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    await db.query("DELETE FROM drafts WHERE id=$1", [draftId]);
    await db.query("DELETE FROM api_usage WHERE user_id=ANY($1::uuid[])", [
      [userId, otherId],
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [userId, otherId],
    ]);
    await db.end();
  }
});
