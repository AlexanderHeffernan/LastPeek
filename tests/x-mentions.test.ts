import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, webkit } from "playwright";
import { db } from "../src/lib/server/db";
import { blankContent } from "../src/lib/contracts";
import { hash, token } from "../src/lib/server/auth";

after(() => db.end());
test("X mention composer selects accounts, preserves text and distinguishes invalid from unavailable", async () => {
  // Risk: selecting a suggestion overwrites surrounding prose, or stale search/validation
  // responses change a newer mention. Browser coverage also protects touch and keyboard access.
  const userId = randomUUID(),
    otherId = randomUUID(),
    draftId = randomUUID();
  const session = token();
  const browser = await (
    process.env.TEST_BROWSER === "webkit" ? webkit : chromium
  ).launch();
  const content = blankContent("Alex Heffernan", "AlexH2035");
  content.posts[0].text = "Thanks @Amp for the help.";
  try {
    for (const id of [userId, otherId])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,plan,pro_limits) SELECT $1,$2,'Alex Heffernan','unused','pro',limits FROM plan_allowances WHERE plan='pro'",
        [id, `${id}@example.test`],
      );
    await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
      draftId,
      userId,
      content,
    ]);
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(session), userId],
    );
    const base = process.env.TEST_BASE_URL!;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
      hasTouch: true,
    });
    await context.addCookies([
      { name: "lastpeek_session", value: session, url: base },
    ]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let searches = 0,
      checks = 0;
    await page.route("**/mentions", async (route) => {
      const { kind, query } = route.request().postDataJSON();
      if (kind === "search") searches++;
      else checks++;
      if (query.toLowerCase() === "unavailable")
        return route.fulfill({
          status: 503,
          json: { message: "Couldn’t check X accounts. Try again later." },
        });
      await route.fulfill({
        json:
          kind === "check"
            ? { accounts: [], missing: true }
            : {
                accounts: [
                  { id: "1", name: "Amp", username: "AmpCode" },
                  { id: "2", name: "Amp — Status", username: "AmpCodeStatus" },
                ],
                missing: false,
              },
      });
    });
    await page.goto(`${base}/drafts/${draftId}`);
    const input = page.getByRole("combobox", { name: "Post 1 text" });
    await input.waitFor();
    // An explicit input and its resulting hydrated count prove readiness.
    await input.fill("Thanks @Amp for the help.");
    await input.press("Home");
    for (let i = 0; i < 11; i++) await input.press("ArrowRight");
    await page
      .getByRole("option", { name: "Amp @AmpCode", exact: true })
      .waitFor();
    await input.press("Enter");
    assert.equal(await input.inputValue(), "Thanks @AmpCode for the help.");
    await input.press("Tab");
    assert.equal(
      checks,
      0,
      "selected account does not trigger another paid check",
    );
    await input.fill("Hello @MissingHandle");
    await input.press("Tab");
    await page
      .getByText("@missinghandle not found on X.", { exact: true })
      .waitFor();
    const invalid = page.getByText("@MissingHandle", { exact: true });
    assert.equal(
      await invalid.evaluate((el) => getComputedStyle(el).color),
      "rgb(255, 122, 162)",
    );
    const dismiss = page.getByRole("button", {
      name: "Dismiss mention warning",
    });
    await dismiss.focus();
    await dismiss.press("Enter");
    await input.focus();
    await input.press("Tab");
    assert.equal(await dismiss.count(), 0);
    assert.equal(await input.inputValue(), "Hello @MissingHandle");
    assert.equal(
      await invalid.evaluate((el) => getComputedStyle(el).color),
      "rgb(29, 155, 240)",
    );
    await input.fill("Hello @Unavailable");
    await input.press("Tab");
    await page
      .getByText("Couldn’t check X accounts. Try again later.", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByText("@Unavailable", { exact: true })
        .evaluate((el) => getComputedStyle(el).color),
      "rgb(29, 155, 240)",
    );
    await dismiss.click();
    await input.focus();
    await input.press("Tab");
    assert.equal(await dismiss.count(), 0);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await input.fill("Hello @Amp");
      const option = page.getByRole("option", {
        name: "Amp @AmpCode",
        exact: true,
      });
      await option.waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await option.tap();
      assert.equal(await input.inputValue(), "Hello @AmpCode ");
      await input.fill("Hello @MissingHandle");
      await input.press("Tab");
      await dismiss.waitFor();
      await dismiss.tap();
      assert.equal(await dismiss.count(), 0);
      assert.equal(await input.inputValue(), "Hello @MissingHandle");
    }
    assert.equal(
      searches,
      1,
      "one lookup per distinct search, not one per keystroke or repeated focus",
    );
    // Pro works without grants; the real endpoint still enforces origin, ownership and plan.
    const endpoint = `${base}/api/drafts/${draftId}/mentions`;
    const send = (origin: string) =>
      context.request.post(endpoint, {
        headers: { Origin: origin },
        data: { kind: "search", query: "Amp" },
      });
    assert.equal((await send("https://other.example")).status(), 403);
    await db.query("UPDATE drafts SET owner_id=$2 WHERE id=$1", [
      draftId,
      otherId,
    ]);
    assert.equal((await send(base)).status(), 404);
    await db.query("UPDATE drafts SET owner_id=$2 WHERE id=$1", [
      draftId,
      userId,
    ]);
    await db.query("UPDATE users SET plan='free' WHERE id=$1", [userId]);
    assert.equal((await send(base)).status(), 403);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
  } finally {
    await browser.close();
    await db.query("DELETE FROM drafts WHERE id=$1", [draftId]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [userId, otherId],
    ]);
  }
});
