import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, webkit } from "playwright";
import { db } from "../src/lib/server/db";
import { blankContent } from "../src/lib/contracts";
import { hash, token } from "../src/lib/server/auth";
import { encryptXToken } from "../src/lib/server/x-auth";
import { xPublishing } from "../src/lib/server/x-publishing";
import type { XPublishing } from "../src/lib/x-publishing";

after(() => db.end());

// Server publication contracts run once in x-publishing-server.test.ts. This
// independently selectable fixture exercises only the browser's publication UI.
test("X publishing confirms, cancels holds, and advances thread jobs", async () => {
  const userId = randomUUID(),
    draftId = randomUUID();
  const xId = `${Date.now()}17`;
  const content = blankContent("Posting tester", "editable_not_x");
  content.posts[0].text = "Ready for a second look 👀\nhttps://example.com/a";
  const session = token();
  const browser = await (
    process.env.TEST_BROWSER === "webkit" ? webkit : chromium
  ).launch();
  try {
    await db.query(
      "INSERT INTO users(id,email,name,handle,password_hash,plan,pro_limits) SELECT $1,$2,'Posting tester','editable_not_x','unused','pro',limits FROM plan_allowances WHERE plan='pro'",
      [userId, `${userId}@example.test`],
    );
    await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
      draftId,
      userId,
      content,
    ]);
    await db.query(
      "INSERT INTO feature_grants(user_id,feature) VALUES($1,'x-publishing')",
      [userId],
    );
    await db.query(
      "INSERT INTO x_accounts(user_id,x_id,access_token,refresh_token,expires_at,scope,profile) VALUES($1,$2,$3,$4,now()+interval '1 hour','tweet.read users.read offline.access tweet.write',$5)",
      [
        userId,
        xId,
        await encryptXToken("test-access"),
        await encryptXToken("test-refresh"),
        { id: xId, username: "actual_account", name: "Real X account" },
      ],
    );
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(session), userId],
    );
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
    // Use the real read contract, but never call a provider to seed browser state.
    const available = await xPublishing(userId, draftId);
    const published: XPublishing = {
      ...available,
      publication: {
        status: "posted",
        version: 1,
        text: content.posts[0].text,
        url: "https://x.com/i/web/status/123456789123456789",
        completed: 1,
        total: 1,
      },
    };
    let requests = 0;
    await page.route("**/post-to-x", async (route) => {
      requests++;
      assert.deepEqual(route.request().postDataJSON(), { version: 1, xId });
      await route.fulfill({ status: 200, json: published });
    });
    await page.goto(`${base}/drafts/${draftId}`);
    // The server-rendered posting button is visible before its gesture handlers
    // hydrate. This worker blocks service workers, so wait for bootstrap loading
    // here rather than losing the first click and timing out on the dialog.
    await page.waitForLoadState("networkidle");
    const button = page.getByRole("button", { name: "Post to X", exact: true });
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
    // These waits straddle the real 1.5s hold threshold, not page readiness.
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
    const postAll = page.getByRole("button", { name: "Post all", exact: true });
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
    await page.getByRole("link", { name: "View on X", exact: true }).waitFor();
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
  } finally {
    await browser.close();
    await db.query("DELETE FROM drafts WHERE id=$1", [draftId]);
    await db.query("DELETE FROM users WHERE id=$1", [userId]);
  }
});
