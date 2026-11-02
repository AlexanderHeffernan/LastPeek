import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, webkit } from "playwright";
import { db } from "../src/lib/server/db";
import { passwordHash, token, hash } from "../src/lib/server/auth";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
const origin = new URL(baseURL).origin;
const engine = process.env.TEST_BROWSER === "webkit" ? webkit : chromium;
after(() => db.end());

test("security / browser sign-out, confirmation, failures and mobile parity", async () => {
  const id = randomUUID(),
    legacy = token(),
    password = token();
  const email = `${id}@example.test`;
  const browser = await engine.launch();
  try {
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Security author',$3)",
      [id, email, await passwordHash(password)],
    );
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at,user_agent,last_used_at) VALUES($1,$2,now()+interval '1 day',$3,now()-interval '2 hours')",
      [
        hash(legacy),
        id,
        "Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/605.1.15",
      ],
    );
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      hasTouch: true,
    });
    const other = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Firefox/145.0",
    });
    for (const client of [context, other]) {
      const signedIn = await client.request.post(`${baseURL}/login`, {
        form: { email, password },
        headers: { Origin: origin },
      });
      assert.equal(signedIn.status(), 200);
    }
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseURL}/settings?tab=security`);
    await page
      .getByRole("button", { name: "Update password", disabled: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "Security", exact: true })
      .waitFor();
    const sessions = page.getByRole("group", { name: "Signed-in browsers" });
    assert.equal(await sessions.getByRole("listitem").count(), 3);
    await sessions.getByText("This session", { exact: true }).waitFor();
    assert.equal((await page.content()).includes(hash(legacy)), false);

    // Both small breakpoints retain all actions, without horizontal overflow.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(await sessions.getByRole("button").count(), 3);
      for (const button of await sessions.getByRole("button").all())
        assert.ok((await button.boundingBox())!.height >= 44);
    }
    await page.getByRole("link", { name: "Back to settings" }).tap();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "Security", exact: true })
      .tap();
    await page
      .getByRole("heading", { name: "Security", exact: true })
      .waitFor();
    await page.goto(`${baseURL}/settings?tab=password`);
    await page
      .getByRole("heading", { name: "Security", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1280, height: 900 });
    const signOutPhone = sessions.getByRole("button", {
      name: "Sign out Safari on iOS",
      exact: true,
    });
    await signOutPhone.click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await sessions.getByRole("listitem").count(), 3);

    // A stale session fails locally and leaves the other controls usable.
    await db.query("DELETE FROM sessions WHERE hash=$1", [hash(legacy)]);
    await signOutPhone.click();
    const failed = page.waitForResponse(
      (response) =>
        response.url().includes("/revokeSession") &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Sign out browser", exact: true })
      .click();
    assert.equal((await failed).status(), 404);
    await sessions
      .getByRole("alert")
      .getByText("This session is no longer available. Reload and try again.", {
        exact: true,
      })
      .waitFor();
    assert.equal(await sessions.getByRole("listitem").count(), 3);
    await page.reload();
    await page
      .getByRole("button", { name: "Update password", disabled: true })
      .waitFor();
    await sessions
      .getByRole("button", { name: "Sign out Firefox on Windows", exact: true })
      .click();
    const revoked = page.waitForResponse(
      (response) =>
        response.url().includes("/revokeSession") &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Sign out browser", exact: true })
      .click();
    assert.equal((await revoked).status(), 200);
    await sessions
      .getByRole("button", { name: "Sign out other sessions", exact: true })
      .waitFor({ state: "detached" });
    assert.equal(await sessions.getByRole("listitem").count(), 1);
    const denied = await other.request.get(`${baseURL}/settings`, {
      maxRedirects: 0,
    });
    assert.equal(denied.status(), 303);
    assert.equal(
      new URL(denied.headers().location, baseURL).pathname,
      "/login",
    );

    // Reintroduce a second session to exercise mobile bulk confirmation.
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(legacy), id],
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page
      .getByRole("button", { name: "Update password", disabled: true })
      .waitFor();
    await sessions
      .getByRole("button", { name: "Sign out other sessions", exact: true })
      .tap();
    const bulk = page.waitForResponse(
      (response) =>
        response.url().includes("/revokeSession") &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Sign out others", exact: true })
      .tap();
    assert.equal((await bulk).status(), 200);
    await sessions
      .getByRole("button", { name: "Sign out other sessions", exact: true })
      .waitFor({ state: "detached" });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Signed-in browsers"]')
          ?.getAttribute("aria-busy") === "false",
    );
    await page.reload();
    await page
      .getByRole("heading", { name: "Security", exact: true })
      .waitFor();
    assert.equal(await sessions.getByRole("listitem").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await db.query("DELETE FROM users WHERE id=$1", [id]);
  }
});
