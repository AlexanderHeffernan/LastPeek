import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, webkit } from "playwright";
import { isHttpError } from "@sveltejs/kit";
import { db } from "../src/lib/server/db";
import { blankContent } from "../src/lib/contracts";
import { hash, token } from "../src/lib/server/auth";
import { encryptXToken, decryptXToken } from "../src/lib/server/x-auth";
import { postToX, xPublishing } from "../src/lib/server/x-publishing";

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
        true,
        "Unsupported threads must never post only the opening item",
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
