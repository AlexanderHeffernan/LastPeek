import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, rm } from "node:fs/promises";
import {
  chromium,
  webkit,
  type Page,
  type APIRequestContext,
} from "playwright";
import sharp from "sharp";
import { db } from "../src/lib/server/db";
import { featureAccess, setFeatureAccess } from "../src/lib/server/features";
import { passwordHash, token, hash as tokenHash } from "../src/lib/server/auth";
import { mediaPath } from "../src/lib/server/media";
import { avatarPath } from "../src/lib/server/avatars";
import type { Content } from "../src/lib/contracts";
import { X_SOURCE_UNAVAILABLE, type XSourcePost } from "../src/lib/x-post";

// Only run against a disposable development instance whose DATABASE_URL matches the server.
const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
const origin = new URL(baseURL).origin;
const artifacts = ".amp/in/artifacts";
const engine = process.env.TEST_BROWSER === "webkit" ? webkit : chromium;
const password = `test-only-${randomUUID()}`;
const userId = randomUUID(),
  strangerId = randomUUID();
const email = `test-${userId}@example.test`,
  strangerEmail = `test-${strangerId}@example.test`;

async function login(page: Page, account: string, secret = password) {
  await page.goto(`${baseURL}/login`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email", { exact: true }).fill(account);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
}
async function action(
  request: APIRequestContext,
  id: string,
  body: object,
  status = 200,
) {
  const response = await request.post(`${baseURL}/api/drafts/${id}`, {
    data: body,
    headers: { Origin: origin },
  });
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
async function edited(page: Page, work: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/drafts/") &&
      r.request().postDataJSON()?.action === "save",
  );
  await work();
  const saved = await response;
  assert.equal(saved.status(), 200, await saved.text());
  await page.getByText("All changes saved", { exact: true }).waitFor();
  return (await saved.json()).version as number;
}
async function screenshot(page: Page, name: string) {
  if (process.env.SCREENSHOTS !== "1") return;
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: `${artifacts}/${name}-${engine.name()}.png`,
    fullPage: true,
  });
}

test(
  "installed app assets and private, network-only offline recovery",
  { timeout: 60000 },
  async () => {
    const browser = await engine.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/login`);
      const manifestLink = await page
        .locator('link[rel="manifest"]')
        .getAttribute("href");
      assert.equal(manifestLink, "/manifest.webmanifest");
      const manifest = await (
        await context.request.get(`${baseURL}${manifestLink}`)
      ).json();
      assert.equal(manifest.display, "standalone");
      assert.equal(manifest.orientation, "portrait");
      assert.equal(
        manifest.start_url,
        "/",
        "installation must not retain a private review URL",
      );
      for (const icon of manifest.icons) {
        const response = await context.request.get(`${baseURL}${icon.src}`);
        assert.equal(response.status(), 200);
        const metadata = await sharp(await response.body()).metadata();
        assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes);
      }
      const launches = await page
        .locator('link[rel="apple-touch-startup-image"]')
        .evaluateAll((links) =>
          links.map((link) => ({
            href: (link as HTMLLinkElement).getAttribute("href")!,
            media: (link as HTMLLinkElement).media,
          })),
        );
      assert.ok(launches.length >= 2);
      for (const launch of launches) {
        const response = await context.request.get(`${baseURL}${launch.href}`);
        assert.equal(response.status(), 200, launch.href);
        const metadata = await sharp(await response.body()).metadata();
        const [, width, height] = launch.href.match(/launch-(\d+)x(\d+)/)!;
        const landscape = launch.media.includes("landscape");
        assert.equal(metadata.width, Number(landscape ? height : width));
        assert.equal(metadata.height, Number(landscape ? width : height));
      }
      await page.setViewportSize({ width: 844, height: 390 });
      assert.equal(
        await page.getByRole("dialog", { name: "Back to portrait." }).count(),
        0,
        "ordinary browser windows are not orientation-gated",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      const installed = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      try {
        // Emulate iOS home-screen launch; viewport rotation remains real.
        await installed.addInitScript(() =>
          Object.defineProperty(navigator, "standalone", { value: true }),
        );
        const app = await installed.newPage();
        await app.goto(`${baseURL}/login`);
        await app
          .getByLabel("Email", { exact: true })
          .fill("portrait-check@example.test");
        await app.setViewportSize({ width: 844, height: 390 });
        const portraitPrompt = app.getByRole("dialog", {
          name: "Back to portrait.",
        });
        await portraitPrompt.waitFor();
        await app.keyboard.press("Escape");
        assert.ok(
          await portraitPrompt.isVisible(),
          "landscape prompt cannot be dismissed to use the app",
        );
        await app.setViewportSize({ width: 390, height: 844 });
        await portraitPrompt.waitFor({ state: "hidden" });
        assert.equal(
          await app.getByLabel("Email", { exact: true }).inputValue(),
          "portrait-check@example.test",
          "rotation preserves form state",
        );
      } finally {
        await installed.close();
      }
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const missing = await page.goto(`${baseURL}/does-not-exist`);
      assert.equal(
        missing?.status(),
        404,
        "HTTP errors must not be disguised as offline",
      );
      await page.goto(`${baseURL}/login`);
      await context.setOffline(true);
      await page.reload();
      await page.getByRole("heading", { name: "You’re offline." }).waitFor();
      assert.equal(
        page.url(),
        `${baseURL}/login`,
        "retry retains the requested destination",
      );
      assert.equal(
        await page.evaluate(async () => {
          try {
            await fetch("/api/drafts/not-a-draft", { method: "POST" });
            return "sent";
          } catch {
            return "failed";
          }
        }),
        "failed",
        "offline writes must fail, never report a queued save",
      );
      const cached = await page.evaluate(async () => {
        const keys = await caches.keys();
        return (
          await Promise.all(
            keys.map(async (key) =>
              (await (await caches.open(key)).keys()).map(
                (request) => new URL(request.url).pathname,
              ),
            ),
          )
        ).flat();
      });
      assert.deepEqual(
        cached,
        ["/offline.html"],
        "no private page, capability, API or media in Cache Storage",
      );
      await screenshot(page, "pwa-offline");
      await context.setOffline(false);
      await page.getByRole("button", { name: "Try again" }).click();
      await page
        .getByRole("button", { name: "Sign in", exact: true })
        .waitFor();
    } finally {
      await browser.close();
    }
  },
);

test(
  "site admin permissions, shared operator data and owner-managed team",
  { timeout: 90000 },
  async () => {
    const ownerId = process.env.LASTPEEK_OWNER_ID;
    assert.ok(
      ownerId,
      "Set LASTPEEK_OWNER_ID to an unused test UUID on both the server and test process.",
    );
    assert.equal(
      (await db.query("SELECT 1 FROM users WHERE id=$1", [ownerId])).rowCount,
      0,
      "Never reuse a real owner account for the test.",
    );
    const prefix = `monitor-${randomUUID().slice(0, 8)}`;
    const ids = [ownerId, ...Array.from({ length: 26 }, randomUUID)];
    const emails = ids.map((_, i) => `${prefix}-${i}@example.test`);
    const existingAccounts = (await db.query("SELECT created_at FROM users"))
      .rows;
    const hash = await passwordHash(password);
    const browser = await engine.launch();
    const owner = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
    });
    const member = await browser.newContext();
    const author = await browser.newContext();
    const page = await owner.newPage();
    const memberPage = await member.newPage();
    const authorPage = await author.newPage();
    // This extra sign-in scenario must not exhaust the shared localhost throttle
    // before the existing auth regression suite (or the next browser engine).
    const loginBuckets = ["login:127.0.0.1", "login:::ffff:127.0.0.1"].map(
      tokenHash,
    );
    await db.query("DELETE FROM rate_limits WHERE key=ANY($1::text[])", [
      loginBuckets,
    ]);
    const operator = (command: object) => {
      const result = spawnSync(
        process.execPath,
        ["--env-file-if-exists=.env", "--import", "tsx", "scripts/operator.ts"],
        { input: JSON.stringify(command), encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stdout || result.stderr);
      return JSON.parse(result.stdout).result;
    };
    try {
      for (const [i, id] of ids.entries())
        await db.query(
          "INSERT INTO users(id,email,name,password_hash,is_admin,created_at) VALUES($1,$2,$3,$4,$5,now()-($6::int * interval '1 day'))",
          [
            id,
            emails[i],
            i === 0 ? "Monitor owner" : `Monitor account ${i}`,
            hash,
            i === 0,
            i === 0 ? 14 : 0,
          ],
        );
      await db.query(
        "INSERT INTO feature_grants(user_id,feature) VALUES($1,'ai-review')",
        [ids[2]],
      );
      await login(authorPage, emails[2]);
      const activity = (index: number) =>
        operator({ action: "admin_users", search: emails[index] }).users[0]
          .last_seen_at;
      const firstSeen = activity(2);
      assert.ok(Date.now() - Date.parse(firstSeen) < 60000);
      await author.request.get(`${baseURL}/health`);
      assert.equal(
        activity(2),
        firstSeen,
        "Activity writes are minute-bounded.",
      );
      await db.query(
        "UPDATE users SET last_seen_at=now()-interval '2 minutes' WHERE id=$1",
        [ids[2]],
      );
      await author.request.get(`${baseURL}/health`);
      assert.ok(Date.parse(activity(2)) >= Date.parse(firstSeen));
      const legacyToken = token();
      const expiredToken = token();
      await db.query(
        "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day'),($3,$4,now()-interval '1 day')",
        [tokenHash(legacyToken), ids[25], tokenHash(expiredToken), ids[24]],
      );
      for (const cookie of ["", "invalid", expiredToken])
        await fetch(`${baseURL}/health`, {
          headers: { Cookie: `lastpeek_session=${cookie}` },
        });
      assert.equal(
        activity(24),
        null,
        "Expired sessions do not record activity.",
      );
      assert.equal(
        activity(25),
        null,
        "Unseen accounts have no invented activity.",
      );
      await fetch(`${baseURL}/health`, {
        headers: { Cookie: `lastpeek_session=${legacyToken}` },
      });
      assert.ok(Date.now() - Date.parse(activity(25)) < 60000);
      const photo = await sharp({
        create: { width: 32, height: 32, channels: 3, background: "#ff6b5b" },
      })
        .png()
        .toBuffer();
      const avatar = await author.request.post(
        `${baseURL}/api/profile/avatar`,
        {
          data: photo,
          headers: { Origin: origin, "Content-Type": "image/png" },
        },
      );
      assert.equal(avatar.status(), 201);
      const retiredAvatarId = (await avatar.json()).avatar;
      const currentAvatar = await author.request.post(
        `${baseURL}/api/profile/avatar`,
        {
          data: photo,
          headers: { Origin: origin, "Content-Type": "image/png" },
        },
      );
      assert.equal(currentAvatar.status(), 201);
      const avatarId = (await currentAvatar.json()).avatar;
      const createdDrafts: string[] = [];
      for (let i = 0; i < 2; i++) {
        const created = await author.request.post(`${baseURL}/?/create`, {
          form: {},
          headers: { Origin: origin, Accept: "text/html" },
          maxRedirects: 0,
        });
        assert.equal(created.status(), 303);
        createdDrafts.push(created.headers().location.split("/").at(-1)!);
      }
      const uploaded = await author.request.post(
        `${baseURL}/api/drafts/${createdDrafts[0]}/media`,
        {
          multipart: {
            file: {
              name: "account-storage.png",
              mimeType: "image/png",
              buffer: photo,
            },
          },
          headers: { Origin: origin },
        },
      );
      assert.equal(uploaded.status(), 201);
      const expectedStorage =
        photo.length +
        (await readFile(avatarPath(retiredAvatarId))).length +
        (await readFile(avatarPath(avatarId))).length;
      await login(memberPage, emails[1]);
      const memberDraft = await member.request.post(`${baseURL}/?/create`, {
        form: {},
        headers: { Origin: origin, Accept: "text/html" },
        maxRedirects: 0,
      });
      assert.equal(memberDraft.status(), 303);
      assert.equal(
        (await member.request.get(`${baseURL}/avatars/${avatarId}`)).status(),
        404,
      );
      assert.equal(
        await authorPage
          .getByRole("link", { name: "Admin", exact: true })
          .count(),
        0,
      );
      assert.equal(
        (await author.request.get(`${baseURL}/siteadmin`)).status(),
        404,
      );
      assert.equal(
        (
          await author.request.post(`${baseURL}/siteadmin/snapshot`, {
            data: { action: "admin-access", userId: ids[2], enabled: true },
            headers: { Origin: origin },
          })
        ).status(),
        404,
      );
      await authorPage.locator("body").click({ position: { x: 2, y: 2 } });
      await authorPage.keyboard.press("~");
      assert.equal(new URL(authorPage.url()).pathname, "/");
      await authorPage.setViewportSize({ width: 390, height: 844 });
      await authorPage
        .getByRole("button", { name: "Back to top", exact: true })
        .click({ delay: 700 });
      assert.equal(
        await authorPage
          .getByRole("dialog", { name: "Site admin overlay" })
          .count(),
        0,
        "secret gesture grants no access to regular accounts",
      );
      await authorPage.setViewportSize({ width: 1280, height: 900 });

      await login(page, emails[0]);
      assert.equal(
        (
          await owner.request.get(`${baseURL}/avatars/${retiredAvatarId}`)
        ).status(),
        404,
        "Admins cannot read non-current avatars.",
      );
      assert.equal(
        (await owner.request.get(`${baseURL}/avatars/${avatarId}`)).status(),
        200,
      );
      await page.getByRole("link", { name: "Account settings" }).click();
      const originalHandle = await page
        .getByLabel("X handle", { exact: true })
        .inputValue();
      await page.getByLabel("X handle", { exact: true }).fill("test");
      await page.getByLabel("X handle", { exact: true }).press("~");
      assert.equal(
        await page.getByLabel("X handle", { exact: true }).inputValue(),
        "test~",
      );
      assert.equal(new URL(page.url()).pathname, "/settings");
      await page
        .getByRole("heading", { name: "Settings", exact: true })
        .click();
      await page.keyboard.press("~");
      await page
        .getByRole("heading", { name: "Site admin.", exact: true })
        .waitFor();
      assert.equal(
        new URL(page.url()).pathname,
        "/settings",
        "Overlay must not navigate away from the current page.",
      );
      await page
        .getByRole("button", { name: "Close site admin", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("X handle", { exact: true }).inputValue(),
        "test~",
        "Opening and closing admin preserves the underlying form.",
      );
      await page
        .getByRole("heading", { name: "Settings", exact: true })
        .click();
      await page.keyboard.press("~");
      await page
        .getByRole("dialog", { name: "Site admin overlay", exact: true })
        .waitFor();
      const overview = operator({ action: "admin_overview" });
      assert.equal(overview.accounts, existingAccounts.length + 27);
      assert.equal(
        overview.new_accounts,
        existingAccounts.filter(
          (account) =>
            Date.now() - new Date(account.created_at).getTime() <= 7 * 86400000,
        ).length + 26,
        "The owner fixture joined fourteen days ago; only the other 26 are new.",
      );
      await screenshot(page, "siteadmin-overlay-desktop");
      await page.keyboard.press("~");
      assert.equal(await page.getByRole("dialog").isVisible(), false);
      await page.keyboard.press("~");
      await page
        .getByRole("dialog", { name: "Site admin overlay", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").isVisible(), false);
      assert.equal(
        await page.getByRole("link", { name: "Admin", exact: true }).count(),
        0,
      );
      await page.keyboard.press("~");
      assert.equal(new URL(page.url()).pathname, "/settings");
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot(page, "siteadmin-overlay-mobile");
      if (engine === chromium) {
        const cdp = await owner.newCDPSession(page);
        for (const { width, height, insets } of [
          {
            width: 390,
            height: 844,
            insets: { top: 59, bottom: 34, left: 0, right: 0 },
          },
          {
            width: 844,
            height: 390,
            insets: { top: 0, bottom: 21, left: 59, right: 21 },
          },
        ]) {
          await page.setViewportSize({ width, height });
          await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          for (const element of [
            page.getByRole("dialog", {
              name: "Site admin overlay",
              exact: true,
            }),
            page.getByRole("heading", { name: "Site admin.", exact: true }),
            page.getByRole("button", { name: "Close site admin", exact: true }),
          ]) {
            const bounds = await element.boundingBox();
            assert.ok(bounds);
            assert.ok(
              bounds.x >= insets.left + 8 && bounds.y >= insets.top + 8,
              "Admin and its controls must clear the notch/status area.",
            );
            assert.ok(
              bounds.x + bounds.width <= width - insets.right - 8 &&
                bounds.y + bounds.height <= height - insets.bottom - 8,
              "Admin and its controls must clear side insets and the home indicator.",
            );
          }
          await screenshot(page, `siteadmin-safe-area-${width}`);
        }
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: {} });
        await cdp.detach();
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await page
        .getByRole("heading", { name: "Site admin.", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("dialog", { name: "Site admin overlay", exact: true })
          .isVisible(),
        true,
        "Tapping inside admin keeps it open.",
      );
      await page.mouse.click(2, 400);
      assert.equal(
        await page
          .getByRole("dialog", { name: "Site admin overlay", exact: true })
          .isVisible(),
        false,
        "Tapping the backdrop closes admin.",
      );
      assert.equal(
        await page.getByLabel("X handle", { exact: true }).inputValue(),
        "test~",
        "Backdrop dismissal preserves the underlying form.",
      );
      await page.getByLabel("X handle", { exact: true }).fill(originalHandle);
      const secretMascot = page.getByRole("button", {
        name: "Back to top",
        exact: true,
      });
      await secretMascot.click();
      assert.equal(
        await page
          .getByRole("dialog", { name: "Site admin overlay" })
          .isVisible(),
        false,
        "ordinary mascot taps do not open admin",
      );
      await secretMascot.click({ delay: 700 });
      await page
        .getByRole("dialog", { name: "Site admin overlay", exact: true })
        .waitFor();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.route("**/siteadmin/snapshot?**", (route) => route.abort());
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page.getByRole("alert").waitFor();
      await screenshot(page, "siteadmin-refresh-error");
      await page.unroute("**/siteadmin/snapshot?**");
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await page
        .getByRole("button", { name: "Refresh", exact: true })
        .waitFor();
      for (const [label, expected] of [
        ["Registered accounts", overview.accounts],
        ["Joined in the last 7 days", overview.new_accounts],
        ["Pending invitations", overview.pending_invites],
        ["Drafts", overview.drafts],
        ["Feedback", overview.feedback],
      ] as const)
        assert.equal(
          await page
            .getByText(label, { exact: true })
            .locator("..")
            .locator("dd")
            .innerText(),
          String(expected),
        );
      const safe = JSON.stringify(overview);
      for (const forbidden of [
        "password_hash",
        "share_token",
        "content",
        "session",
      ])
        assert.equal(safe.includes(forbidden), false);

      await page.getByRole("link", { name: "Accounts", exact: true }).click();
      assert.equal(
        new URL(page.url()).pathname,
        "/settings",
        "Sidebar navigation stays inside the overlay.",
      );
      await page.getByRole("textbox", { name: "Search accounts" }).fill(prefix);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "27 accounts" })
        .waitFor();
      const directory = operator({ action: "admin_users", search: prefix });
      assert.equal(directory.total, 27);
      assert.equal(directory.users.length, 25);
      const authorAccount = directory.users.find(
        (u: { id: string }) => u.id === ids[2],
      );
      assert.equal(authorAccount.drafts, 2);
      assert.equal(authorAccount.media_bytes, expectedStorage);
      const memberAccount = operator({
        action: "admin_users",
        search: emails[1],
      }).users[0];
      assert.equal(memberAccount.drafts, 1);
      assert.equal(memberAccount.media_bytes, 0);
      const authorRow = page.getByRole("row").filter({
        has: page.getByRole("cell", { name: emails[2], exact: true }),
      });
      await authorRow.getByRole("cell", { name: "2", exact: true }).waitFor();
      await authorRow.getByText("Last online", { exact: true }).waitFor();
      assert.equal(
        await authorRow
          .locator("time[datetime]")
          .first()
          .getAttribute("datetime"),
        authorAccount.last_seen_at,
      );
      await page.getByText("Not recorded", { exact: true }).first().waitFor();
      await screenshot(page, "siteadmin-accounts-desktop");
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await authorRow.getByText("Last online", { exact: true }).waitFor();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          "Account activity fits narrow screens.",
        );
        await screenshot(page, `siteadmin-accounts-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await authorRow
        .getByRole("cell", {
          name: `${expectedStorage.toLocaleString()} B`,
          exact: true,
        })
        .waitFor();
      assert.equal(
        directory.users.find((u: { id: string }) => u.id === ids[2]).avatar_id,
        avatarId,
      );
      assert.equal(
        directory.users.find((u: { id: string }) => u.id === ids[2])
          .features[0],
        "ai-review",
      );
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByText("Page 2 of 2", { exact: true }).waitFor();
      const secondPage = operator({
        action: "admin_users",
        search: prefix,
        page: 2,
      });
      for (const account of secondPage.users)
        await page.getByText(account.email, { exact: true }).waitFor();
      assert.equal(
        operator({ action: "admin_users", search: "%" }).total,
        0,
        "Search wildcards are literal.",
      );
      await page.goto(
        `${baseURL}/siteadmin?search=${encodeURIComponent(emails[1])}`,
      );
      await page
        .getByRole("button", { name: `Actions for ${emails[1]}`, exact: true })
        .click();
      await page
        .getByRole("button", {
          name: `Grant admin access to ${emails[1]}`,
          exact: true,
        })
        .click();
      await screenshot(page, "siteadmin-confirm-access");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(
        (await db.query("SELECT is_admin FROM users WHERE id=$1", [ids[1]]))
          .rows[0].is_admin,
        false,
      );
      await page
        .getByRole("button", { name: `Actions for ${emails[1]}`, exact: true })
        .click();
      await page
        .getByRole("button", {
          name: `Grant admin access to ${emails[1]}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Grant access", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Grant admin access?", exact: true })
        .waitFor({ state: "hidden" });
      await memberPage.goto(`${baseURL}/`);
      for (const command of [
        {
          action: "feature-access",
          userId: ids[2],
          feature: "ai-review",
          enabled: true,
          reason: "Denied",
        },
        {
          action: "all-feature-access",
          feature: "ai-review",
          enabled: true,
          reason: "Denied",
        },
      ])
        assert.equal(
          (
            await member.request.post(`${baseURL}/siteadmin/snapshot`, {
              data: command,
              headers: { Origin: origin },
            })
          ).status(),
          403,
        );
      assert.equal(
        (await member.request.get(`${baseURL}/siteadmin`)).status(),
        200,
      );
      assert.equal(
        (await member.request.get(`${baseURL}/avatars/${avatarId}`)).status(),
        200,
      );
      assert.equal(
        (
          await member.request.post(`${baseURL}/siteadmin/snapshot`, {
            data: { action: "admin-access", userId: ids[2], enabled: true },
            headers: { Origin: origin },
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await owner.request.post(`${baseURL}/siteadmin/snapshot`, {
            data: { action: "admin-access", userId: ownerId, enabled: false },
            headers: { Origin: origin },
          })
        ).status(),
        400,
      );
      assert.equal(
        (
          await owner.request.post(`${baseURL}/siteadmin/snapshot`, {
            data: { action: "admin-access", userId: ids[2], enabled: true },
            headers: { Origin: "https://evil.example" },
          })
        ).status(),
        403,
      );
      await page
        .getByRole("button", { name: `Actions for ${emails[1]}`, exact: true })
        .click();
      await page
        .getByRole("button", {
          name: `Remove admin access from ${emails[1]}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Remove access", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Remove admin access?", exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(
        (await member.request.get(`${baseURL}/avatars/${avatarId}`)).status(),
        404,
      );
      assert.equal(
        (await member.request.get(`${baseURL}/siteadmin`)).status(),
        404,
        "Revocation applies to an existing session.",
      );
      const history = operator({
        action: "admin_overview",
      }).accessHistory.filter(
        (item: { account: string }) => item.account === emails[1],
      );
      assert.deepEqual(
        history.map((item: { enabled: boolean }) => item.enabled),
        [false, true],
      );

      await page
        .getByRole("link", { name: "Feature flags", exact: true })
        .click();
      const flags = operator({ action: "admin_flags" });
      assert.equal(flags.flags.length, 2);
      assert.equal(flags.total, overview.accounts);
      await page
        .getByRole("button", {
          name: "Enable x-source-posts for all users",
          exact: true,
        })
        .click();
      await page.getByText("All existing accounts", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Search users for feature flags" })
        .fill(emails[1]);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page
        .getByRole("button", { name: `Select ${emails[1]}`, exact: true })
        .click();
      await page
        .getByRole("table", {
          name: `Feature flags for ${emails[1]}`,
          exact: true,
        })
        .waitFor();
      assert.equal(
        operator({ action: "admin_flags", userId: ids[1] }).flags.find(
          (flag: { feature: string }) => flag.feature === "x-source-posts",
        ).enabled,
        false,
      );
      await page
        .getByRole("button", {
          name: `Enable x-source-posts for ${emails[1]}`,
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .getByLabel("Reason", { exact: true })
          .getAttribute("required"),
        null,
      );
      await page
        .getByRole("button", { name: "Confirm change", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: `Disable x-source-posts for ${emails[1]}`,
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.getByRole("status").count(),
        0,
        "Successful flag changes do not show notices.",
      );
      assert.equal(
        (await featureAccess(emails[1])).features["x-source-posts"],
        true,
      );
      assert.equal(
        operator({ action: "admin_flags", userId: ids[1] }).flags.find(
          (flag: { feature: string }) => flag.feature === "x-source-posts",
        ).enabled,
        true,
      );
      for (const action of ["feature-access", "all-feature-access"]) {
        assert.equal(
          (
            await owner.request.post(`${baseURL}/siteadmin/snapshot`, {
              data: {
                action,
                ...(action === "feature-access" ? { userId: ids[1] } : {}),
                feature: "x-source-posts",
                enabled: false,
              },
              headers: { Origin: origin },
            })
          ).status(),
          400,
          "Revocations still require a reason.",
        );
      }
      await page
        .getByRole("link", { name: "Access history", exact: true })
        .click();
      await page
        .getByText("x-source-posts · Granted", { exact: true })
        .first()
        .waitFor();
      assert.ok(
        operator({ action: "admin_history" }).some(
          (change: { account: string; feature: string; reason: string }) =>
            change.account === emails[1] &&
            change.feature === "x-source-posts" &&
            change.reason === "",
        ),
      );
      await page.getByRole("link", { name: "API usage", exact: true }).click();
      await page
        .getByRole("region", { name: "OpenAI usage", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("heading", { name: "API usage", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.getByRole("button", { name: "Save model pricing" }).count(),
        0,
      );
      assert.deepEqual(
        operator({ action: "admin_usage", userId: ids[1] }).providers.map(
          (usage: { requests: number }) => usage.requests,
        ),
        [0, 0],
      );
      await page.getByRole("link", { name: "Accounts", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Search accounts" })
        .fill(emails[1]);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "1 account" }).waitFor();
      await page
        .getByRole("button", {
          name: `API usage for ${emails[1]}`,
          exact: true,
        })
        .click();
      await page.getByText(emails[1], { exact: true }).waitFor();
      await page.getByRole("button", { name: "All time", exact: true }).click();
      await page
        .getByRole("button", { name: "All accounts", exact: true })
        .click();
      for (const command of [
        {
          action: "feature-access",
          userId: ids[2],
          feature: "ai-review",
          enabled: true,
          reason: "Denied",
        },
        {
          action: "all-feature-access",
          feature: "ai-review",
          enabled: true,
          reason: "Denied",
        },
      ])
        assert.equal(
          (
            await author.request.post(`${baseURL}/siteadmin/snapshot`, {
              data: command,
              headers: { Origin: origin },
            })
          ).status(),
          404,
        );
      await page.goto(`${baseURL}/siteadmin`);

      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await screenshot(page, `siteadmin-${width}`);
      }
      await page.goto(`${baseURL}/siteadmin?search=not-an-account`);
      await page
        .getByText("No accounts match this search.", { exact: true })
        .waitFor();
      await screenshot(page, "siteadmin-empty");
      await page.goto(`${baseURL}/siteadmin?page=-1`);
      await page.getByRole("alert").waitFor();
      await screenshot(page, "siteadmin-invalid");
    } finally {
      await browser.close();
      await db.query("DELETE FROM admin_access_audit WHERE actor_id=$1", [
        ownerId,
      ]);
      await db.query(
        "DELETE FROM feature_audit WHERE user_id=ANY($1::uuid[])",
        [ids],
      );
      const uploadedMedia = await db.query(
        "SELECT id FROM media WHERE owner_id=ANY($1::uuid[])",
        [ids],
      );
      await db.query("DELETE FROM drafts WHERE owner_id=ANY($1::uuid[])", [
        ids,
      ]);
      await Promise.all(
        uploadedMedia.rows.map((row) => rm(mediaPath(row.id), { force: true })),
      );
      const avatars = await db.query(
        "DELETE FROM avatars WHERE owner_id=ANY($1::uuid[]) RETURNING id",
        [ids],
      );
      await Promise.all(
        avatars.rows.map((row) => rm(avatarPath(row.id), { force: true })),
      );
      await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM rate_limits WHERE key=ANY($1::text[])", [
        loginBuckets,
      ]);
    }
  },
);

test(
  "X forms work on the first attempt after client-side account navigation",
  { timeout: 60000 },
  async () => {
    const id = randomUUID(),
      session = token();
    const browser = await engine.launch();
    try {
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'X navigation author',$3)",
        [id, `${id}@example.test`, await passwordHash(token())],
      );
      await db.query(
        "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [tokenHash(session), id],
      );
      for (const width of [1280, 390]) {
        for (const signIn of [false, true]) {
          const context = await browser.newContext({
            viewport: { width, height: 900 },
          });
          await context.addCookies([
            { name: "lastpeek_session", value: session, url: baseURL },
          ]);
          const page = await context.newPage();
          await page.route("https://x.com/i/oauth2/authorize**", (route) =>
            route.fulfill({ contentType: "text/html", body: "Test X consent" }),
          );
          await page.goto(baseURL);
          await page.waitForLoadState("networkidle");
          // Keep the original document: a full reload would hide this regression.
          await page.evaluate(() =>
            Reflect.set(window, "accountNavigation", true),
          );
          await page
            .getByRole("link", { name: "Account settings", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Settings", exact: true })
            .waitFor();
          // Leaving Account must restore privacy, not keep its more permissive policy.
          await page.getByRole("link", { name: "Drafts", exact: true }).click();
          await page
            .getByRole("main", { name: "Drafts", exact: true })
            .waitFor();
          const privateRequest = page.waitForRequest(`${baseURL}/health`);
          await page.evaluate(() => fetch("/health"));
          assert.equal((await privateRequest).headers().referer, undefined);
          await page
            .getByRole("link", { name: "Account settings", exact: true })
            .click();
          await page
            .getByRole("heading", { name: "Settings", exact: true })
            .waitFor();
          if (signIn) {
            await page
              .getByRole("button", { name: "Sign out", exact: true })
              .click();
            await page
              .getByRole("heading", { name: "Welcome back.", exact: true })
              .waitFor();
          } else {
            await page
              .getByRole("link", { name: "Connections", exact: true })
              .click();
          }
          assert.equal(
            await page.evaluate(() => Reflect.get(window, "accountNavigation")),
            true,
          );
          const [request] = await Promise.all([
            page.waitForRequest(
              (request) => request.url() === `${baseURL}/auth/x/start`,
            ),
            page
              .getByRole("button", {
                name: signIn ? "Sign in with X" : "Link X account",
                exact: true,
              })
              .click(),
          ]);
          assert.equal(request.headers().origin, origin);
          await page.waitForURL("https://x.com/i/oauth2/authorize**");
          assert.equal(
            new URL(page.url()).searchParams.get("code_challenge_method"),
            "S256",
          );
          await context.close();
          // Sign out deliberately revokes the fixture session; restore it for the next case.
          if (signIn)
            await db.query(
              "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
              [tokenHash(session), id],
            );
        }
      }
    } finally {
      await browser.close();
      await db.query("DELETE FROM x_oauth_flows WHERE user_id=$1", [id]);
      await db.query("DELETE FROM users WHERE id=$1", [id]);
    }
  },
);

test(
  "X-only accounts keep a sign-in method when disconnecting",
  { timeout: 30000 },
  async () => {
    const id = randomUUID(),
      session = token();
    const browser = await engine.launch();
    const context = await browser.newContext();
    try {
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,has_password) VALUES($1,$2,'X author',$3,false)",
        [id, `${id}@example.test`, await passwordHash(token())],
      );
      await db.query(
        "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [tokenHash(session), id],
      );
      await db.query(
        "INSERT INTO x_accounts(user_id,x_id,access_token,expires_at,scope,profile) VALUES($1,$2,'test-only',now(),'users.read',$3)",
        [
          id,
          `${Date.now()}654`,
          { id: `${Date.now()}654`, name: "X author", username: "x_author" },
        ],
      );
      await context.addCookies([
        { name: "lastpeek_session", value: session, url: baseURL },
      ]);
      const page = await context.newPage();
      await page.goto(`${baseURL}/settings?tab=connections`);
      assert.equal(
        (
          await context.request.post(`${baseURL}/auth/x/start`, {
            form: {},
            headers: { Origin: "https://not-lastpeek.example" },
          })
        ).status(),
        403,
      );
      await page
        .getByRole("button", { name: "X account actions", exact: true })
        .click();
      const reconnect = page.getByRole("button", {
        name: "Reconnect X",
        exact: true,
      });
      if (await reconnect.isVisible()) {
        // Exercise the native form and callback, without contacting the real X service.
        await page.route("https://x.com/i/oauth2/authorize**", (route) =>
          route.fulfill({ contentType: "text/html", body: "Test X consent" }),
        );
        await reconnect.click();
        await page.waitForURL("https://x.com/i/oauth2/authorize**");
        const authorization = new URL(page.url());
        assert.equal(
          authorization.searchParams.get("code_challenge_method"),
          "S256",
        );
        assert.equal(
          authorization.searchParams.get("redirect_uri"),
          `${origin}/auth/x/callback`,
        );
        await page.goto(
          `${baseURL}/auth/x/callback?state=${authorization.searchParams.get("state")}&error=access_denied`,
        );
        await page.getByText("Reconnect needed", { exact: true }).waitFor();
        await page
          .getByRole("button", { name: "X account actions", exact: true })
          .click();
      }
      assert.equal(
        await page
          .getByRole("button", { name: "Disconnect X", exact: true })
          .isDisabled(),
        true,
      );
      const blocked = await context.request.post(
        `${baseURL}/settings?/disconnectX`,
        { form: {}, headers: { Origin: origin } },
      );
      assert.equal(blocked.status(), 400);
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "Password", exact: true }).click();
      await page.getByLabel("New password", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "Set password", exact: true })
        .click();
      await page
        .getByText("Password changed. Other sessions have been signed out.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        (await db.query("SELECT has_password FROM users WHERE id=$1", [id]))
          .rows[0].has_password,
        true,
      );
      assert.equal(
        (
          await db.query("SELECT 1 FROM sessions WHERE hash=$1", [
            tokenHash(session),
          ])
        ).rowCount,
        0,
      );
      await page
        .getByRole("link", { name: "Connections", exact: true })
        .click();
      await page
        .getByRole("button", { name: "X account actions", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Disconnect X", exact: true })
        .click();
      await page.getByText("Not connected", { exact: true }).waitFor();
      assert.equal(
        await page.getByText("X disconnected.", { exact: false }).count(),
        0,
      );
      await context.clearCookies();
      await page.goto(`${baseURL}/login?x=unlinked`);
      await page
        .getByRole("heading", { name: "Welcome back.", exact: true })
        .waitFor();
      await page
        .getByRole("status")
        .getByText("This X account isn’t linked yet.", { exact: false })
        .waitFor();
      assert.equal(
        await page
          .getByRole("link", { name: "Back to sign in", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Dismiss X sign-in notice", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.getByRole("status").count(), 0);
      await page.route("https://x.com/i/oauth2/authorize**", (route) =>
        route.fulfill({ contentType: "text/html", body: "Test X consent" }),
      );
      await page
        .getByRole("button", { name: "Sign in with X", exact: true })
        .click();
      await page.waitForURL("https://x.com/i/oauth2/authorize**");
      const retried = new URL(page.url());
      assert.equal(
        retried.searchParams.get("redirect_uri"),
        `${origin}/auth/x/callback`,
      );
      await page.goto(
        `${baseURL}/auth/x/callback?state=${retried.searchParams.get("state")}&error=access_denied`,
      );
      await page.waitForURL(`${baseURL}/login?x=cancelled`);
      await page.goto(`${baseURL}/login?x=unlinked`);
      await page
        .getByRole("button", { name: "Dismiss X sign-in notice", exact: true })
        .click();
      await page
        .getByLabel("Email", { exact: true })
        .fill(`${id}@example.test`);
      await page.getByLabel("Password", { exact: true }).fill("wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .getByRole("alert")
        .getByText("That email and password don’t match.")
        .waitFor();
      assert.equal(
        await page.getByLabel("Email", { exact: true }).inputValue(),
        `${id}@example.test`,
      );
      assert.equal(await page.getByRole("status").count(), 0);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(`${baseURL}/`);
      await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
      assert.equal(
        (await db.query("SELECT 1 FROM x_accounts WHERE user_id=$1", [id]))
          .rowCount,
        0,
      );
    } finally {
      await browser.close();
      await db.query("DELETE FROM users WHERE id=$1", [id]);
    }
  },
);

test(
  "author → private draft → media → live guest review → revoke",
  { timeout: 150000 },
  async () => {
    assert.ok(
      process.env.DATABASE_URL,
      "Use the development database, never a production instance",
    );
    const hash = await passwordHash(password);
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,is_admin) VALUES($1,$2,'Alex',$3,true),($4,$5,'Other author',$3,false)",
      [userId, email, hash, strangerId, strangerEmail],
    );
    const browser = await engine.launch();
    const owner = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const guest = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const other = await browser.newContext();
    const page = await owner.newPage(),
      reviewer = await guest.newPage(),
      stranger = await other.newPage();
    const crashes: string[] = [];
    let dismissNextDialog = false;
    for (const p of [page, reviewer, stranger]) {
      p.on("pageerror", (e) => crashes.push(e.message));
      p.on("dialog", (dialog) => {
        if (p === page && dismissNextDialog) {
          dismissNextDialog = false;
          return dialog.dismiss();
        }
        return dialog.accept();
      });
    }
    try {
      await page.goto(`${baseURL}/login`);
      assert.ok(
        await page
          .locator("footer")
          .evaluate(
            (footer) =>
              footer.getBoundingClientRect().bottom >= innerHeight - 40,
          ),
        "footer stays at the bottom of short pages",
      );
      await screenshot(page, "login");
      assert.equal(
        await page
          .getByRole("link", { name: "Source code", exact: true })
          .getAttribute("href"),
        "https://github.com/AlexanderHeffernan/LastPeek",
      );
      // Native forms must work before hydration or with JavaScript disabled.
      const native = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 390, height: 844 },
      });
      const nativePage = await native.newPage();
      const nativeLogin = await nativePage.goto(`${baseURL}/login`);
      assert.equal(nativeLogin?.headers()["referrer-policy"], "strict-origin");
      await login(nativePage, email);
      await nativePage.goto(`${baseURL}/settings`);
      await nativePage
        .getByRole("heading", { name: "Settings", exact: true })
        .waitFor();
      await nativePage
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await nativePage
        .getByRole("button", { name: "Sign in", exact: true })
        .waitFor();
      assert.equal(
        new URL((await native.request.get(`${baseURL}/settings`)).url())
          .pathname,
        "/login",
      );
      await native.close();
      // Restoring the browser's origin must not trust cross-site or opaque origins.
      for (const submittedOrigin of ["https://not-lastpeek.example", "null"]) {
        const rejected = await guest.request.post(`${baseURL}/login`, {
          form: { email, password },
          headers: { Origin: submittedOrigin },
        });
        assert.equal(rejected.status(), 403);
      }
      // A plausible signup request must not bypass the invitation capability.
      const invalidInvite = `${baseURL}/join/${"A".repeat(43)}`;
      assert.equal((await guest.request.get(invalidInvite)).status(), 404);
      const rejectedSignup = await guest.request.post(invalidInvite, {
        form: {
          name: "Uninvited",
          email: `uninvited-${userId}@example.test`,
          password,
        },
        headers: { Origin: origin },
      });
      assert.equal(rejectedSignup.status(), 400);
      // Better Auth's general-purpose endpoints are intentionally not public.
      for (const path of [
        "sign-up/email",
        "sign-in/email",
        "change-password",
      ]) {
        assert.equal(
          (
            await guest.request.post(`${baseURL}/api/auth/${path}`, {
              data: {
                name: "Uninvited",
                email: `uninvited-${userId}@example.test`,
                password,
              },
              headers: { Origin: origin },
            })
          ).status(),
          404,
        );
      }
      assert.equal(
        (
          await db.query("SELECT 1 FROM users WHERE email=$1", [
            `uninvited-${userId}@example.test`,
          ])
        ).rowCount,
        0,
      );
      for (const account of [email, `missing-${userId}@example.test`]) {
        await page.getByLabel("Email", { exact: true }).fill(account);
        await page
          .getByLabel("Password", { exact: true })
          .fill("incorrect-password");
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page
          .getByText("That email and password don’t match.", { exact: true })
          .waitFor();
      }
      await login(page, email);
      const navigation = page.getByRole("navigation", {
        name: "Main navigation",
      });
      const accountLink = navigation.getByRole("link", {
        name: "Account settings",
      });
      const desktopNav = (await navigation.boundingBox())!;
      const draftFeed = (await page
        .getByRole("region", { name: "Draft feed", exact: true })
        .boundingBox())!;
      assert.ok(
        desktopNav.x > 0,
        "navigation follows the centered application, not the screen edge",
      );
      assert.equal(desktopNav.x + desktopNav.width, draftFeed.x);
      assert.ok(desktopNav.width <= 72);
      const newPost = (await page
        .getByRole("button", { name: "New post", exact: true })
        .boundingBox())!;
      assert.ok(
        newPost.x > draftFeed.x + draftFeed.width,
        "desktop creation belongs in the right column, not above the feed",
      );
      assert.equal(desktopNav.y, 0);
      assert.equal(desktopNav.height, 1000);
      assert.ok((await accountLink.boundingBox())!.y > 900);
      // Check rendered geometry, not computed CSS: Safari can reject SVG keyframes.
      const mascot = navigation.getByRole("link", { name: "LastPeek home" });
      const eyeHeight = await mascot.evaluate(
        (link) => link.querySelector("ellipse")!.getBoundingClientRect().height,
      );
      await mascot.hover();
      // Leaving during the blink must not cancel the expression midway through.
      await navigation
        .getByRole("link", { name: "Drafts", exact: true })
        .hover();
      await page.waitForFunction(
        ({ link, eyeHeight }) =>
          link!.querySelector("ellipse")!.getBoundingClientRect().height >
          eyeHeight + 2,
        { link: await mascot.elementHandle(), eyeHeight },
      );
      await page.waitForFunction(
        ({ link, eyeHeight }) =>
          Math.abs(
            link!.querySelector("ellipse")!.getBoundingClientRect().height -
              eyeHeight,
          ) < 0.1,
        { link: await mascot.elementHandle(), eyeHeight },
      );
      await accountLink.click();
      await page
        .getByRole("heading", { name: "Settings", exact: true })
        .waitFor();
      assert.equal(await accountLink.getAttribute("aria-current"), "page");
      await navigation
        .getByRole("link", { name: "Drafts", exact: true })
        .click();
      await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(await navigation.getByRole("link").count(), 2);
        assert.ok(
          (await page
            .getByRole("link", { name: "Account settings" })
            .boundingBox())!.y < 64,
        );
        const mobileLogo = (await page
          .getByRole("button", { name: "Back to top", exact: true })
          .boundingBox())!;
        assert.equal(mobileLogo.x + mobileLogo.width / 2, width / 2);
        const mobileNav = (await navigation.boundingBox())!;
        assert.equal(mobileNav.x, 0);
        assert.equal(mobileNav.width, width);
        assert.equal(mobileNav.y + mobileNav.height, 844);
        assert.ok(mobileNav.height >= 48 && mobileNav.height <= 60);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          width,
        );
        assert.equal(await page.getByRole("contentinfo").count(), 0);
        assert.ok(await page.getByLabel("Search posts").isVisible());
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      const sessionCookie = (await owner.cookies()).find((cookie) =>
        cookie.name.endsWith("lastpeek.session_token"),
      );
      assert.ok(
        sessionCookie,
        "password sign-in creates a Better Auth session",
      );
      assert.ok(sessionCookie.httpOnly);
      assert.equal(sessionCookie.sameSite, "Lax");
      const tampered = await browser.newContext();
      await tampered.addCookies([
        { ...sessionCookie, value: `${sessionCookie.value.slice(0, -1)}!` },
      ]);
      assert.equal(
        new URL((await tampered.request.get(`${baseURL}/`)).url()).pathname,
        "/login",
      );
      await tampered.close();
      await screenshot(page, "empty-drafts");
      // Created order deliberately differs from updated order; search includes replies.
      const feedIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const [index, feedId] of feedIds.entries()) {
        const content: Content = {
          title: "",
          author: { name: "Old profile", handle: "old" },
          posts: [
            { id: randomUUID(), text: `Feed example ${index}`, media: [] },
          ],
        };
        if (index === 1)
          content.posts.push({
            id: randomUUID(),
            text: "Hidden kiwi reply",
            media: [],
          });
        await db.query(
          `INSERT INTO drafts(id,owner_id,content,created_at,updated_at)
           VALUES($1,$2,$3,now()-($4::int * interval '1 day'),now()-($5::int * interval '1 hour'))`,
          [
            feedId,
            userId,
            JSON.stringify(content),
            3 - index,
            [1, 3, 2][index],
          ],
        );
      }
      await action(owner.request, feedIds[1], {
        action: "publish",
        version: 1,
      });
      await db.query(
        "INSERT INTO comments(id,draft_id,revision,post_id,name,body,resolved) SELECT $1,id,shared_revision,(content->'posts'->0->>'id')::uuid,'Reviewer','Check this',false FROM drafts WHERE id=$2",
        [randomUUID(), feedIds[1]],
      );
      await page.reload();
      await page.waitForLoadState("networkidle");
      const feedLinks = page.getByRole("link", { name: /^Open draft:/ });
      const feedOrder = () =>
        feedLinks.evaluateAll((links) =>
          links.map((link) => link.getAttribute("href")?.split("/").at(-1)),
        );
      assert.deepEqual(await feedOrder(), [feedIds[0], feedIds[2], feedIds[1]]);
      assert.equal(
        await page.getByRole("button", { name: "Back to top" }).count(),
        0,
        "short, unscrolled list has no ending actions",
      );
      await setFeatureAccess(
        email,
        "x-source-posts",
        true,
        "test",
        "Exercise end-of-list creation options",
      );
      await page.reload();
      await page.setViewportSize({ width: 390, height: 400 });
      const firstPostY = await feedLinks
        .first()
        .evaluate((el) => el.getBoundingClientRect().top + scrollY);
      const mobileHeader = page.getByRole("banner");
      const searchTop = (await page.getByLabel("Search posts").boundingBox())!
        .y;
      const floatingPost = page
        .getByRole("button", {
          name: "New post",
          exact: true,
        })
        .first();
      const raisedY = (await floatingPost.boundingBox())!.y;
      assert.ok((await navigation.boundingBox())!.height <= 60);
      const partialScroll = await mobileHeader.evaluate(async (header) => {
        // Keep the gesture active so slow CI frames cannot trigger idle settling.
        dispatchEvent(new Event("touchstart"));
        const top = header.getBoundingClientRect().top;
        scrollTo(0, 24);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const down = header.getBoundingClientRect().top;
        scrollTo(0, 16);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const reversed = header.getBoundingClientRect().top;
        dispatchEvent(new Event("touchend"));
        return { top, down, reversed };
      });
      assert.equal(
        Math.round(partialScroll.top - partialScroll.down),
        24,
        "chrome follows a small scroll rather than waiting and toggling",
      );
      assert.equal(
        Math.round(partialScroll.reversed - partialScroll.down),
        8,
        "direction reversal reveals only the distance scrolled",
      );
      assert.equal(
        Math.round(
          searchTop - (await page.getByLabel("Search posts").boundingBox())!.y,
        ),
        16,
        "search belongs to the scrolling feed, not the fixed header",
      );
      await page.evaluate(() => scrollTo(0, 200));
      await page.waitForFunction(
        (el) => el!.getBoundingClientRect().top >= innerHeight,
        await navigation.elementHandle(),
      );
      assert.ok((await mobileHeader.boundingBox())!.y < -60);
      const loweredY = (await floatingPost.boundingBox())!.y;
      assert.equal(Math.round(loweredY - raisedY), 48);
      assert.ok(loweredY + 56 < 400, "floating creation remains onscreen");
      assert.equal(
        await feedLinks
          .first()
          .evaluate((el) => el.getBoundingClientRect().top + scrollY),
        firstPostY,
        "hiding chrome does not move posts in the document",
      );
      await floatingPost.click();
      const mobileMenu = page.getByLabel("New post actions", { exact: true });
      await mobileMenu
        .getByRole("button", { name: "New Quote", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "New Quote", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.evaluate(() => scrollTo(0, 40));
      await page.waitForFunction(
        (el) => el!.getBoundingClientRect().top === 0,
        await mobileHeader.elementHandle(),
      );
      assert.ok((await page.getByLabel("Search posts").boundingBox())!.y > 64);
      await mobileHeader
        .getByRole("button", { name: "Back to top", exact: true })
        .click();
      await page.waitForFunction(() => scrollY === 0);
      await page.setViewportSize({ width: 1440, height: 300 });
      assert.equal(
        await page.getByRole("group", { name: "End of drafts" }).count(),
        0,
        "overflow alone does not show ending actions before scrolling",
      );
      await page.evaluate(() => scrollTo(0, 120));
      assert.equal(
        await page
          .getByRole("button", { name: "New post", exact: true })
          .first()
          .evaluate((button) => {
            const bounds = button.getBoundingClientRect();
            return document
              .elementFromPoint(bounds.x + bounds.width / 2, 0)
              ?.contains(button);
          }),
        true,
        "sticky creation surface covers the viewport edge without a see-through gap",
      );
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight),
      );
      const ending = page.getByRole("group", { name: "End of drafts" });
      await ending.getByRole("button", { name: "Back to top" }).waitFor();
      await ending.getByRole("button", { name: "New post options" }).click();
      await page
        .getByRole("button", { name: "New Quote", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "New Quote", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await ending.getByRole("button", { name: "Back to top" }).click();
      await page.waitForFunction(() => scrollY === 0);
      await ending.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await setFeatureAccess(
        email,
        "x-source-posts",
        false,
        "test",
        "Restore feature-gated account",
      );
      await page.reload();
      await page
        .getByRole("button", { name: "With feedback", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("article", { name: "Draft preview", exact: true })
          .getByRole("link", { name: "1 open comment", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await feedLinks.first().getByText("Alex", { exact: true }).count(),
        1,
        "feed uses current profile",
      );
      assert.equal(
        await page.getByRole("link", { name: "2 posts in thread" }).count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("link", { name: "Shared for review", exact: true })
          .count(),
        1,
      );
      await page.getByRole("link", { name: "2 posts in thread" }).hover();
      await page
        .getByRole("tooltip", { name: "Thread", exact: true })
        .waitFor();
      await page.getByRole("link", { name: "2 posts in thread" }).focus();
      await page.keyboard.press("Tab");
      await page
        .getByRole("tooltip", { name: "Feedback", exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Back to top" }).count(),
        0,
      );
      const headerTime = feedLinks.first().locator("time");
      assert.equal(
        await headerTime.getAttribute("datetime"),
        (
          await db.query("SELECT updated_at FROM drafts WHERE id=$1", [
            feedIds[1],
          ])
        ).rows[0].updated_at.toISOString(),
      );
      const feedbackIds = Array.from({ length: 6 }, () => randomUUID());
      for (const [index, commentId] of feedbackIds.entries()) {
        await db.query(
          `INSERT INTO comments(id,draft_id,revision,post_id,name,body,resolved,created_at)
           SELECT $1,id,shared_revision,(content->'posts'->0->>'id')::uuid,'Reader',
           $3,$4,now()+($5::int * interval '1 second') FROM drafts WHERE id=$2`,
          [
            commentId,
            feedIds[1],
            `Feedback-only mango ${index}`,
            index === 5,
            index,
          ],
        );
      }
      await page.reload();
      await page.waitForLoadState("networkidle");
      const feedbackLinks = page.getByRole("link", {
        name: /^Open feedback from/,
      });
      assert.equal(
        await feedbackLinks.count(),
        5,
        "five recent open comments, not resolved feedback",
      );
      assert.ok(
        (await feedbackLinks.first().getAttribute("href"))?.endsWith(
          `#feedback-${feedbackIds[4]}`,
        ),
      );
      await page.getByLabel("Search posts").fill("  MANGO 5  ");
      assert.deepEqual(
        await feedOrder(),
        [],
        "draft search does not match feedback",
      );
      await navigation
        .getByRole("link", { name: "Feedback", exact: true })
        .click();
      await page.getByRole("main", { name: "Feedback", exact: true }).waitFor();
      await page.getByLabel("Search feedback").fill("  MANGO 5  ");
      const feedbackFeed = page.getByRole("region", {
        name: "Feedback feed",
        exact: true,
      });
      assert.equal(
        await feedbackFeed
          .getByRole("link", { name: /^Open feedback from/ })
          .count(),
        1,
        "resolved feedback remains searchable",
      );
      await page.getByRole("button", { name: "Open", exact: true }).click();
      assert.equal(await feedbackFeed.getByRole("link").count(), 0);
      await page.getByRole("button", { name: "Resolved", exact: true }).click();
      await feedbackFeed
        .getByRole("link", { name: /^Open feedback from/ })
        .click();
      const targetFeedback = page
        .getByRole("article", { name: "Feedback from Reader" })
        .filter({ hasText: "Feedback-only mango 5" });
      await targetFeedback.waitFor();
      assert.equal(new URL(page.url()).hash, `#feedback-${feedbackIds[5]}`);
      assert.ok(
        await targetFeedback.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.top < innerHeight;
        }),
        "feedback link scrolls to the original comment",
      );
      await page
        .getByRole("link", { name: "LastPeek home", exact: true })
        .click();
      await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
      await page.getByRole("button", { name: "All", exact: true }).click();
      assert.equal(await page.getByLabel("Sort drafts").count(), 0);
      await page
        .getByRole("button", { name: "With feedback", exact: true })
        .click();
      assert.deepEqual(await feedOrder(), [feedIds[1]]);
      await page.getByLabel("Search posts").fill("  KIWI  ");
      assert.deepEqual(await feedOrder(), [feedIds[1]]);
      await page.getByRole("button", { name: "Private", exact: true }).click();
      await page.getByRole("heading", { name: "Not a peep." }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Back to top" }).count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "New post", exact: true })
          .count(),
        2,
        "empty results retain a creation action",
      );
      assert.equal(
        await page
          .getByRole("link", { name: "LastPeek home", exact: true })
          .count(),
        1,
        "empty mascot is decorative, not another navigation link",
      );
      await page
        .getByRole("button", { name: "Clear search and filters" })
        .click();
      assert.equal(await feedLinks.count(), 3);
      await page.getByRole("button", { name: "Shared", exact: true }).click();
      assert.deepEqual(await feedOrder(), [feedIds[1]]);
      await feedLinks.first().click();
      await page.getByLabel("Post 2 text", { exact: true }).waitFor();
      await page.getByText("All changes saved", { exact: true }).waitFor();
      await page
        .getByRole("link", { name: "LastPeek home", exact: true })
        .click();
      await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
      await db.query("DELETE FROM drafts WHERE id=ANY($1::uuid[])", [feedIds]);
      await page.getByRole("link", { name: "Account settings" }).click();
      await page.getByLabel("X handle", { exact: true }).fill("not valid!");
      await page.getByRole("button", { name: "Save profile" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Use an X handle" })
        .waitFor();
      await page.getByLabel("X handle", { exact: true }).fill("@alex");
      await page.getByRole("button", { name: "Save profile" }).click();
      await page.getByText("Profile saved.", { exact: true }).waitFor();
      await page.reload();
      assert.equal(
        await page.getByLabel("X handle", { exact: true }).inputValue(),
        "alex",
      );
      // WebKit bypasses image mocks in service-worker-controlled pages. Isolate
      // only the mocked X onboarding; keep real workers in the author/reviewer
      // contexts so the offline-storage privacy assertions remain unchanged.
      const xProfileContext = await browser.newContext({
        storageState: await owner.storageState(),
        serviceWorkers: "block",
      });
      try {
        const page = await xProfileContext.newPage();
        await db.query(
          "INSERT INTO x_accounts(user_id,x_id,access_token,expires_at,scope,profile,import_pending) VALUES($1,$2,'test-only',now(),'users.read',$3,true)",
          [
            userId,
            `${Date.now()}987`,
            {
              id: `${Date.now()}987`,
              name: "Name from X",
              username: "handle_from_x",
              profile_image_url:
                "https://pbs.twimg.com/profile_images/0/lastpeek-test-missing.png",
            },
          ],
        );
        const xPreview = await sharp({
          create: { width: 48, height: 48, channels: 3, background: "#ff6b5b" },
        })
          .png()
          .toBuffer();
        await page.route(
          "https://pbs.twimg.com/profile_images/0/lastpeek-test-missing.png",
          (route) =>
            route.fulfill({ contentType: "image/png", body: xPreview }),
        );
        await page.goto(`${baseURL}/settings`);
        const xDialog = page.getByRole("dialog", {
          name: "Connected to X",
          exact: true,
        });
        await xDialog.waitFor();
        assert.equal(
          await page
            .getByAltText("Avatar from X", { exact: true })
            .evaluate(async (image: HTMLImageElement) => {
              await image.decode();
              return image.naturalWidth > 0;
            }),
          true,
        );
        assert.equal(
          await page
            .getByText("X account linked. Choose what to update below.", {
              exact: true,
            })
            .count(),
          0,
        );
        const xName = xDialog.getByRole("checkbox", {
          name: "Display name Name from X",
          exact: true,
        });
        const xHandle = xDialog.getByRole("checkbox", { name: /^X handle @/ });
        assert.equal(await xName.isChecked(), false);
        assert.equal(await xHandle.isChecked(), false);
        await xDialog.getByText("Name from X", { exact: true }).click();
        assert.equal(await xName.isChecked(), true);
        await xName.press("Space");
        assert.equal(await xName.isChecked(), false);
        await xName.press("Space");
        assert.equal(await xName.isChecked(), true);
        const releaseRefresh = Promise.withResolvers<void>();
        const refreshURL = `${baseURL}/settings/__data.json*`;
        await page.route(refreshURL, async (route) => {
          await releaseRefresh.promise;
          await route.continue();
        });
        const refreshing = page.waitForRequest((request) =>
          request.url().includes("/settings/__data.json"),
        );
        await page
          .getByRole("button", { name: "Apply selection", exact: true })
          .click();
        await refreshing;
        try {
          assert.equal(await xName.isDisabled(), true);
          assert.equal(await xHandle.isDisabled(), true);
          assert.equal(
            await xDialog.isVisible(),
            true,
            "Keep the dialog visible until the refreshed profile arrives",
          );
        } finally {
          releaseRefresh.resolve();
          await page.unroute(refreshURL);
        }
        await xDialog.waitFor({ state: "hidden" });
        assert.equal(
          await page.getByLabel("Display name", { exact: true }).inputValue(),
          "Name from X",
        );
        assert.equal(
          await page.getByLabel("X handle", { exact: true }).inputValue(),
          "alex",
        );
        await page.reload();
        assert.equal(await page.getByRole("checkbox").count(), 0);
        assert.equal(
          await page
            .getByText("Update profile from X", { exact: true })
            .count(),
          0,
        );
        const finishedImport = await owner.request.post(
          `${baseURL}/settings?/importX`,
          { form: { handle: "on" }, headers: { Origin: origin } },
        );
        assert.equal(finishedImport.status(), 400);
        await db.query(
          "UPDATE x_accounts SET import_pending=true,profile=jsonb_set(profile,'{name}','\"Different X name\"') WHERE user_id=$1",
          [userId],
        );
        await page.reload();
        await xHandle.check();
        await page
          .getByRole("button", { name: "Apply selection", exact: true })
          .click();
        await xDialog.waitFor({ state: "hidden" });
        assert.equal(
          await page.getByLabel("X handle", { exact: true }).inputValue(),
          "handle_from_x",
        );
        assert.equal(
          await page.getByLabel("Display name", { exact: true }).inputValue(),
          "Name from X",
        );
        await db.query(
          "UPDATE x_accounts SET import_pending=true WHERE user_id=$1",
          [userId],
        );
        await page.reload();
        await xDialog
          .getByRole("checkbox", {
            name: "Display name Different X name",
            exact: true,
          })
          .check();
        await page
          .getByRole("button", { name: "Keep current profile", exact: true })
          .click();
        await xDialog.waitFor({ state: "hidden" });
        assert.equal(
          await page.getByLabel("Display name", { exact: true }).inputValue(),
          "Name from X",
        );
        await page.reload();
        assert.equal(await page.getByRole("dialog").count(), 0);
        await db.query(
          "UPDATE x_accounts SET import_pending=true WHERE user_id=$1",
          [userId],
        );
        await page.reload();
        await page
          .getByRole("checkbox", { name: "Profile photo", exact: true })
          .check();
        await xDialog
          .getByRole("checkbox", {
            name: "Display name Different X name",
            exact: true,
          })
          .check();
        await page
          .getByRole("button", { name: "Apply selection", exact: true })
          .click();
        await page
          .getByText("Couldn’t import the X photo.", { exact: false })
          .waitFor();
        assert.equal(
          (await db.query("SELECT avatar_id FROM users WHERE id=$1", [userId]))
            .rows[0].avatar_id,
          null,
        );
        assert.equal(await xDialog.isVisible(), true);
        assert.equal(
          (await db.query("SELECT name FROM users WHERE id=$1", [userId]))
            .rows[0].name,
          "Name from X",
        );
        await screenshot(page, "x-profile-import-error");
        await page.keyboard.press("Escape");
        await xDialog.waitFor({ state: "hidden" });
        await page.reload();
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(
          (
            await db.query(
              "SELECT import_pending FROM x_accounts WHERE user_id=$1",
              [userId],
            )
          ).rows[0].import_pending,
          false,
        );
        // An expired access token with refresh credentials is still connected.
        await db.query(
          "UPDATE x_accounts SET refresh_token='test-only' WHERE user_id=$1",
          [userId],
        );
        await page.reload();
        await page
          .getByRole("link", { name: "Connections", exact: true })
          .click();
        await page.getByText("Connected", { exact: true }).waitFor();
        await page
          .getByRole("button", { name: "X account actions", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("button", { name: "Reconnect X", exact: true })
            .count(),
          0,
        );
        await page
          .getByRole("button", { name: "Disconnect X", exact: true })
          .click();
        await page.getByText("Not connected", { exact: true }).waitFor();
        assert.equal(
          await page.getByText("X disconnected.", { exact: false }).count(),
          0,
        );
        assert.equal(
          (
            await db.query("SELECT 1 FROM x_accounts WHERE user_id=$1", [
              userId,
            ])
          ).rowCount,
          0,
        );
      } finally {
        await xProfileContext.close();
      }
      await page.reload();
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Display name", { exact: true }).fill("Alex");
      await page.getByLabel("X handle", { exact: true }).fill("alex");
      await page
        .getByRole("button", { name: "Save profile", exact: true })
        .click();
      await page.getByText("Profile saved.", { exact: true }).waitFor();
      const photo = await sharp({
        create: { width: 640, height: 480, channels: 3, background: "#c4f36b" },
      })
        .png()
        .toBuffer();
      assert.equal(
        await page
          .getByRole("button", { name: "Save profile", exact: true })
          .isDisabled(),
        true,
      );
      const photoChooser = page.waitForEvent("filechooser");
      await page
        .getByRole("button", { name: "Add photo", exact: true })
        .click();
      await (
        await photoChooser
      ).setFiles({
        name: "profile.png",
        mimeType: "image/png",
        buffer: photo,
      });
      assert.equal(
        (await db.query("SELECT avatar_id FROM users WHERE id=$1", [userId]))
          .rows[0].avatar_id,
        null,
        "Selecting a photo must not save it",
      );
      dismissNextDialog = true;
      await page
        .getByRole("link", { name: "Connections", exact: true })
        .click();
      assert.equal(new URL(page.url()).searchParams.get("tab"), null);
      assert.equal(
        await page
          .getByRole("button", { name: "Save profile", exact: true })
          .isEnabled(),
        true,
      );
      await page
        .getByRole("button", { name: "Save profile", exact: true })
        .click();
      await page.getByText("Profile saved.", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Save profile", exact: true })
          .isDisabled(),
        true,
      );
      const avatarId = (
        await db.query("SELECT avatar_id FROM users WHERE id=$1", [userId])
      ).rows[0].avatar_id;
      await page
        .getByRole("button", { name: "Remove photo", exact: true })
        .click();
      dismissNextDialog = true;
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      assert.equal(
        (await db.query("SELECT avatar_id FROM users WHERE id=$1", [userId]))
          .rows[0].avatar_id,
        avatarId,
        "Removing a photo is staged until Save profile",
      );
      await page.getByRole("link", { name: "Allowances", exact: true }).click();
      await page
        .getByRole("heading", { name: "Media storage", exact: true })
        .waitFor();
      await page.getByRole("link", { name: "Profile", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Save profile", exact: true })
          .isDisabled(),
        true,
        "Accepting navigation discards staged edits",
      );
      await page
        .getByRole("button", { name: "Remove photo", exact: true })
        .waitFor();
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          "Profile photo controls must not introduce horizontal scrolling",
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      const avatarURL = `${baseURL}/avatars/${avatarId}`;
      const avatarResponse = await owner.request.get(avatarURL);
      assert.equal(avatarResponse.status(), 200);
      assert.equal(avatarResponse.headers()["content-type"], "image/webp");
      const avatarMetadata = await sharp(
        await avatarResponse.body(),
      ).metadata();
      assert.equal(avatarMetadata.width, 256);
      assert.equal(avatarMetadata.height, 256);
      assert.equal(avatarMetadata.exif, undefined);
      assert.equal((await guest.request.get(avatarURL)).status(), 404);
      assert.equal(
        (
          await owner.request.post(`${baseURL}/api/profile/avatar`, {
            data: photo,
            headers: { Origin: "https://not-lastpeek.example" },
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await owner.request.post(`${baseURL}/api/profile/avatar`, {
            data: Buffer.alloc(5 * 1024 * 1024 + 1),
            headers: { Origin: origin },
          })
        ).status(),
        413,
      );
      await page.getByLabel("Upload avatar", { exact: true }).setInputFiles({
        name: "unsafe.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      });
      await page
        .getByRole("button", { name: "Save profile", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "Use a JPEG" })
        .waitFor();
      await screenshot(page, "avatar-upload-error");
      await page.getByRole("link", { name: "LastPeek home" }).click();
      await page
        .getByRole("button", { name: "Write your first post", exact: true })
        .click();
      await page.getByLabel("Post 1 text", { exact: true }).waitFor();
      await page.waitForLoadState("networkidle");
      const id = page.url().split("/").at(-1)!;
      await page.getByRole("link", { name: "LastPeek home" }).click();
      await page
        .getByRole("button", { name: "New post", exact: true })
        .first()
        .click();
      await page.getByLabel("Post 1 text", { exact: true }).waitFor();
      assert.notEqual(page.url().split("/").at(-1), id);
      await page.getByRole("link", { name: "LastPeek home" }).click();
      await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "New post options" }).count(),
        0,
        "even admins have no X access by default",
      );
      await screenshot(page, "x-gate-disabled");
      const denied = await owner.request.post(`${baseURL}/?/create`, {
        form: { kind: "quote", url: "https://x.com/source/status/1" },
        headers: { Origin: origin },
      });
      assert.equal(
        denied.status(),
        503,
        "direct creation cannot bypass the grant",
      );
      await setFeatureAccess(
        email,
        "x-source-posts",
        true,
        "browser test",
        "X source trial",
      );
      await page.reload();
      // Native source cards are fixture-backed: tests must never spend real X credits.
      const sourcePostId = String(
        BigInt(`0x${userId.replaceAll("-", "").slice(0, 15)}`),
      );
      const sourceURL = `https://x.com/source/status/${sourcePostId}`;
      const sourceCard: XSourcePost = {
        id: sourcePostId,
        url: sourceURL,
        text: "A little context before replying.\nMore details: https://t.co/test #BuildInPublic",
        createdAt: "2026-10-01T08:30:00.000Z",
        author: {
          name: "Source author",
          username: "source",
          avatar: "https://pbs.twimg.com/test-avatar.jpg",
        },
        links: [
          {
            text: "https://t.co/test",
            url: "https://t.co/test",
            label: "example.com/full",
          },
        ],
        media: [],
      };
      await page.route("https://pbs.twimg.com/**", async (route) =>
        route.fulfill({
          contentType: "image/png",
          body: await sharp({
            create: {
              width: 80,
              height: 80,
              channels: 3,
              background: "#ff6b5b",
            },
          })
            .png()
            .toBuffer(),
        }),
      );
      const cacheSource = (card: XSourcePost | null) =>
        db.query(
          `INSERT INTO x_source_posts(post_id,content,expires_at) VALUES($1,$2,now()+interval '1 hour')
         ON CONFLICT(post_id) DO UPDATE SET content=EXCLUDED.content,expires_at=EXCLUDED.expires_at`,
          [sourcePostId, card ? JSON.stringify(card) : null],
        );
      let lastSourceDraft = "";
      for (const kind of ["quote", "reply"] as const) {
        await page.getByRole("link", { name: "LastPeek home" }).click();
        await page
          .getByRole("button", { name: "New post options", exact: true })
          .click();
        await screenshot(page, "x-gate-enabled-menu");
        await page
          .getByRole("button", {
            name: kind === "quote" ? "New Quote" : "New Reply",
            exact: true,
          })
          .click();
        const dialog = page.getByRole("dialog", {
          name: kind === "quote" ? "New Quote" : "New Reply",
        });
        await dialog
          .getByLabel("X post link")
          .fill("https://example.com/not-a-post");
        await dialog
          .getByRole("button", { name: `Create ${kind}`, exact: true })
          .click();
        await dialog.getByRole("alert").waitFor();
        assert.equal(
          await dialog.getByLabel("X post link").inputValue(),
          "https://example.com/not-a-post",
        );
        await dialog
          .getByLabel("X post link")
          .fill(`https://twitter.com/source/status/${sourcePostId}?s=20`);
        await cacheSource(null);
        const draftCount = (
          await db.query("SELECT count(*) FROM drafts WHERE owner_id=$1", [
            userId,
          ])
        ).rows[0].count;
        await dialog
          .getByRole("button", { name: `Create ${kind}`, exact: true })
          .click();
        await dialog.getByText(X_SOURCE_UNAVAILABLE, { exact: true }).waitFor();
        assert.equal(
          (
            await db.query("SELECT count(*) FROM drafts WHERE owner_id=$1", [
              userId,
            ])
          ).rows[0].count,
          draftCount,
          "an unavailable source must not create an empty draft",
        );
        await screenshot(page, `source-${kind}-unavailable`);
        await cacheSource(sourceCard);
        await dialog
          .getByRole("button", { name: `Create ${kind}`, exact: true })
          .click();
        await page.getByLabel("Post 1 text", { exact: true }).waitFor();
        await page
          .getByRole("heading", {
            name: kind === "reply" ? "Comment" : "Quote",
            exact: true,
          })
          .waitFor();
        const sourceId = page.url().split("/").at(-1)!;
        lastSourceDraft = sourceId;
        await page
          .getByRole("link", { name: "Source author on X", exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("link", { name: "example.com/full", exact: true })
            .getAttribute("href"),
          "https://t.co/test",
        );
        assert.equal(
          await page
            .getByRole("link", { name: "#BuildInPublic", exact: true })
            .getAttribute("href"),
          "https://x.com/hashtag/BuildInPublic",
        );
        assert.equal(await page.locator("iframe").count(), 0);
        await screenshot(page, `source-${kind}-native`);
        const sourceVersion = await edited(page, () =>
          page
            .getByLabel("Post 1 text", { exact: true })
            .fill(`My ${kind} for review`),
        );
        await page.reload();
        assert.equal(
          await page.getByLabel("Post 1 text", { exact: true }).inputValue(),
          `My ${kind} for review`,
        );
        const source = {
          kind,
          url: sourceURL,
        };
        assert.deepEqual(
          (await db.query("SELECT content FROM drafts WHERE id=$1", [sourceId]))
            .rows[0].content.source,
          source,
        );
        const shared = await action(owner.request, sourceId, {
          action: "publish",
          version: sourceVersion,
        });
        await reviewer.goto(`${baseURL}/r/${shared.token}`);
        await reviewer
          .getByRole("heading", {
            name: kind === "reply" ? "Comment" : "Quote",
            exact: true,
          })
          .waitFor();
        const original = reviewer.getByRole("link", {
          name: "View on X",
          exact: true,
        });
        await original.waitFor();
        assert.equal(await original.getAttribute("href"), source.url);
        assert.deepEqual(
          (
            await db.query("SELECT content FROM revisions WHERE draft_id=$1", [
              sourceId,
            ])
          ).rows[0].content.source,
          source,
        );
      }
      // Loss of source access must not destroy drafts or hide existing feedback.
      await setFeatureAccess(
        email,
        "x-source-posts",
        false,
        "browser test",
        "End X trial",
      );
      await reviewer.reload();
      await reviewer.getByText(X_SOURCE_UNAVAILABLE, { exact: true }).waitFor();
      assert.equal(await reviewer.locator("iframe").count(), 0);
      await page.goto(`${baseURL}/drafts/${lastSourceDraft}`);
      await page.getByText(X_SOURCE_UNAVAILABLE, { exact: true }).waitFor();
      await edited(page, () =>
        page
          .getByLabel("Post 1 text", { exact: true })
          .fill("Still editable without X"),
      );
      await screenshot(page, "source-existing-unavailable");
      await db.query("DELETE FROM x_source_posts WHERE post_id=$1", [
        sourcePostId,
      ]);
      await page.unroute("https://pbs.twimg.com/**");
      await page.goto(`${baseURL}/drafts/${id}`);
      assert.equal(
        await page.getByRole("button", { name: "Save", exact: true }).count(),
        0,
      );
      assert.equal(
        await page.getByRole("button", { name: "Copy thread text" }).count(),
        0,
      );
      assert.equal(
        await page.getByText("Draft options", { exact: true }).count(),
        0,
      );
      await page.getByRole("heading", { name: "Post", exact: true }).waitFor();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      assert.equal(
        await page
          .getByLabel("Post 1 text", { exact: true })
          .evaluate((text) => text === document.activeElement),
        true,
        "Edit focuses the inline post without switching modes",
      );
      await page
        .getByRole("button", { name: "More draft actions", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete draft", exact: true })
        .click();
      const deletion = page.getByRole("dialog", { name: "Delete this draft?" });
      await deletion.waitFor();
      await deletion.getByRole("button", { name: "Keep draft" }).click();
      assert.equal(await deletion.isVisible(), false);
      // AI remains owner-only and optional; no key must not break normal editing.
      const aiURL = `${baseURL}/api/drafts/${id}/ai-review`;
      assert.equal(
        (
          await owner.request.post(aiURL, {
            data: {},
            headers: { Origin: "https://wrong.example" },
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await other.request.post(aiURL, {
            data: {},
            headers: { Origin: origin },
            maxRedirects: 0,
          })
        ).status(),
        303,
      );
      // Even administrators default to denied. Grants/revokes take effect without re-login.
      assert.equal(
        await page
          .getByRole("button", { name: "AI Review", exact: true })
          .count(),
        0,
      );
      const aiProbe = () =>
        owner.request.post(aiURL, { data: {}, headers: { Origin: origin } });
      assert.equal((await aiProbe()).status(), 403);
      assert.equal(
        (await setFeatureAccess(email, "ai-review", true, "test", "E2E enable"))
          .changed,
        true,
      );
      assert.equal(
        (
          await setFeatureAccess(
            email,
            "ai-review",
            true,
            "test",
            "Idempotent retry",
          )
        ).changed,
        false,
      );
      await page.reload();
      assert.equal(
        await page
          .getByRole("button", { name: "AI Review", exact: true })
          .count(),
        process.env.OPENAI_API_KEY ? 1 : 0,
      );
      // Empty input rejects before a paid provider request.
      assert.equal(
        (await aiProbe()).status(),
        process.env.OPENAI_API_KEY ? 400 : 503,
      );
      await setFeatureAccess(email, "ai-review", false, "test", "E2E revoke");
      assert.equal((await aiProbe()).status(), 403);
      await page.reload();
      assert.equal(
        await page
          .getByRole("button", { name: "AI Review", exact: true })
          .count(),
        0,
      );
      const access = await featureAccess(email);
      assert.equal(access.features["ai-review"], false);
      assert.deepEqual(
        access.history
          .filter((entry) => entry.feature === "ai-review")
          .map((entry) => [entry.enabled, entry.reason]),
        [
          [false, "E2E revoke"],
          [true, "E2E enable"],
        ],
      );
      // Existing AI UI cases below run with an explicit grant.
      await setFeatureAccess(
        email,
        "ai-review",
        true,
        "test",
        "E2E UI coverage",
      );
      await page.reload();
      if (!process.env.OPENAI_API_KEY) {
        assert.equal(
          await page
            .getByRole("button", { name: "AI Review", exact: true })
            .count(),
          0,
        );
        assert.equal(
          (
            await owner.request.post(aiURL, {
              data: {},
              headers: { Origin: origin },
            })
          ).status(),
          503,
        );
      }
      const initial =
        "The best feedback starts with one question.\n\n“Can you take a quick look?” 👀";
      await edited(page, () =>
        page.getByLabel("Post 1 text", { exact: true }).fill(initial),
      );
      assert.equal(await page.getByLabel("Draft title").count(), 0);
      assert.equal(
        await page.getByLabel("X handle", { exact: true }).count(),
        0,
      );
      assert.equal(await page.getByRole("tab").count(), 0);
      await page.getByText("@alex", { exact: true }).waitFor();

      // The writable preview keeps exact text and safely highlights X entities.
      const linkedText =
        "👀 @alex #BuildInPublic https://example.com/peek\n<script>alert('no')</script>";
      await edited(page, () =>
        page.getByLabel("Post 1 text", { exact: true }).fill(linkedText),
      );
      assert.equal(
        await page.getByLabel("Post 1 text", { exact: true }).isVisible(),
        true,
      );
      const preview = page.getByRole("article", {
        name: "Post 1",
        exact: true,
      });
      assert.equal(
        await preview
          .getByRole("paragraph", { includeHidden: true })
          .innerText(),
        linkedText,
      );
      assert.equal(
        await preview
          .getByRole("link", {
            name: "@alex",
            exact: true,
            includeHidden: true,
          })
          .getAttribute("href"),
        "https://x.com/alex",
      );
      assert.equal(
        await preview
          .getByRole("link", {
            name: "#BuildInPublic",
            exact: true,
            includeHidden: true,
          })
          .getAttribute("href"),
        "https://x.com/hashtag/BuildInPublic",
      );
      assert.equal(
        await preview
          .getByRole("link", {
            name: "https://example.com/peek",
            exact: true,
            includeHidden: true,
          })
          .getAttribute("href"),
        "https://example.com/peek",
      );
      assert.equal(await preview.locator("script").count(), 0);
      await edited(page, () =>
        page.getByLabel("Post 1 text", { exact: true }).fill(initial),
      );

      // Actual image uploads, image ordering, original bytes, and an independent video post.
      const image = await sharp({
        create: { width: 900, height: 520, channels: 3, background: "#dce8c6" },
      })
        .composite([
          {
            input: Buffer.from(
              '<svg width="900" height="520"><path fill="red" d="M0 0h90v520H0z"/><path fill="blue" d="M810 0h90v520h-90z"/></svg>',
            ),
          },
        ])
        .png()
        .toBuffer();
      const upload = page.waitForResponse((r) =>
        r.url().endsWith(`/api/drafts/${id}/media`),
      );
      const savedImage = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/drafts/${id}`) &&
          r.request().postDataJSON()?.action === "save",
      );
      await page
        .getByLabel("Add media to post 1", { exact: true })
        .setInputFiles({
          name: "a-quiet-thought.png",
          mimeType: "image/png",
          buffer: image,
        });
      assert.equal((await upload).status(), 201);
      const imageData = await (await upload).json();
      assert.equal((await savedImage).status(), 200);
      await edited(page, () =>
        page.getByRole("button", { name: "Add post to thread" }).click(),
      );
      assert.equal(
        await page
          .getByLabel("Post 2 text", { exact: true })
          .evaluate((e) => e === document.activeElement),
        true,
      );
      // Empty posts disappear directly; removing real content is an in-page decision.
      await edited(page, () =>
        page
          .getByRole("button", { name: "Remove post 2", exact: true })
          .click(),
      );
      assert.equal(
        await page.getByLabel("Post 2 text", { exact: true }).count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("dialog", { name: "Remove this post?" })
          .isVisible(),
        false,
      );
      await edited(page, () =>
        page.getByRole("button", { name: "Add post to thread" }).click(),
      );
      await edited(page, () =>
        page
          .getByLabel("Post 2 text", { exact: true })
          .fill("Temporary wording"),
      );
      await page
        .getByRole("button", { name: "Remove post 2", exact: true })
        .click();
      const removePostDialog = page.getByRole("dialog", {
        name: "Remove this post?",
      });
      await removePostDialog.waitFor();
      await removePostDialog.getByRole("button", { name: "Keep post" }).click();
      assert.equal(
        await page.getByLabel("Post 2 text", { exact: true }).inputValue(),
        "Temporary wording",
      );
      await page
        .getByRole("button", { name: "Remove post 2", exact: true })
        .click();
      await edited(page, () =>
        removePostDialog
          .getByRole("button", { name: "Remove post", exact: true })
          .click(),
      );
      assert.equal(
        await page.getByLabel("Post 1 text", { exact: true }).inputValue(),
        initial,
      );
      await edited(page, () =>
        page.getByRole("button", { name: "Add post to thread" }).click(),
      );
      await edited(page, () =>
        page
          .getByLabel("Post 2 text", { exact: true })
          .fill("A little motion, too. Original media stays with the thought."),
      );
      const videoUpload = page.waitForResponse((r) =>
        r.url().endsWith(`/api/drafts/${id}/media`),
      );
      const savedVideo = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/drafts/${id}`) &&
          r.request().postDataJSON()?.action === "save",
      );
      await page
        .getByLabel("Add media to post 2", { exact: true })
        .setInputFiles("tests/fixtures/video.mp4");
      const videoData = await (await videoUpload).json();
      assert.equal((await savedVideo).status(), 200);
      const videoText = await page
        .getByLabel("Post 2 text", { exact: true })
        .inputValue();
      await edited(page, () =>
        page.getByLabel("Post 2 text", { exact: true }).fill(""),
      );
      await page
        .getByRole("button", { name: "Remove post 2", exact: true })
        .click();
      await removePostDialog.waitFor();
      await removePostDialog.getByRole("button", { name: "Keep post" }).click();
      assert.equal(
        await page.getByLabel("Video on post 2", { exact: true }).count(),
        1,
        "media-only posts require confirmation too",
      );
      await edited(page, () =>
        page.getByLabel("Post 2 text", { exact: true }).fill(videoText),
      );
      // Like X, only the post being written shows its tools.
      assert.equal(
        await page.getByLabel("Add media to post 1", { exact: true }).count(),
        0,
      );
      await page.getByLabel("Post 1 text", { exact: true }).focus();
      if (engine === chromium) {
        await owner.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page
          .getByRole("button", { name: "Copy post 1 text", exact: true })
          .click();
        assert.equal(
          await page.evaluate(() => navigator.clipboard.readText()),
          initial,
        );
        assert.equal(
          await page.getByRole("button", { name: "Dismiss message" }).count(),
          0,
        );
      }
      const download = page.waitForEvent("download");
      await page
        .getByRole("link", {
          name: "Download a-quiet-thought.png",
          exact: true,
        })
        .click();
      const downloaded = await download;
      assert.equal(downloaded.suggestedFilename(), "a-quiet-thought.png");
      assert.deepEqual(await readFile((await downloaded.path())!), image);
      const rejected = page.waitForResponse((r) =>
        r.url().endsWith(`/api/drafts/${id}/media`),
      );
      await page
        .getByLabel("Add media to post 1", { exact: true })
        .setInputFiles({
          name: "not-a-safe-image.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        });
      assert.equal((await rejected).status(), 400);
      await page.getByRole("alert").filter({ hasText: "Use JPEG" }).waitFor();
      await screenshot(page, "author-upload-error");
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      await page.reload();
      await page.waitForLoadState("networkidle");
      assert.equal(
        await page.getByLabel("Post 1 text", { exact: true }).inputValue(),
        initial,
      );
      await screenshot(page, "author-editor");
      await page.setViewportSize({ width: 320, height: 800 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "author controls must fit narrow mobile screens",
      );
      await page.getByRole("button", { name: "Add post to thread" }).waitFor();
      assert.equal(
        await page.getByLabel("Post 1 text", { exact: true }).isVisible(),
        true,
      );
      await screenshot(page, "author-preview-mobile");
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot(page, "author-editor-mobile");
      await page.setViewportSize({ width: 1440, height: 1000 });
      const mediaURL = `${baseURL}/media/${videoData.id}`;
      assert.equal((await guest.request.get(mediaURL)).status(), 404);
      await login(stranger, strangerEmail);
      assert.equal(
        await stranger
          .getByRole("link", { name: /^Open feedback from/ })
          .count(),
        0,
        "another author's feedback is never included in the sidebar",
      );
      assert.equal(
        (
          await other.request.post(aiURL, {
            data: {},
            headers: { Origin: origin },
          })
        ).status(),
        404,
      );
      assert.equal(
        (await other.request.get(`${baseURL}/drafts/${id}`)).status(),
        404,
      );
      assert.equal((await other.request.get(mediaURL)).status(), 404);
      await action(other.request, id, { action: "revoke" }, 404);
      const forged = await owner.request.post(`${baseURL}/api/drafts/${id}`, {
        data: { action: "revoke" },
        headers: { Origin: "https://not-lastpeek.example" },
      });
      assert.equal(forged.status(), 403);
      const forgedForm = await owner.request.post(
        `${baseURL}/settings?/invite`,
        {
          form: {},
          headers: { Origin: "https://not-lastpeek.example" },
        },
      );
      assert.equal(forgedForm.status(), 403);
      const nonAdminInvite = await other.request.post(
        `${baseURL}/settings?/invite`,
        {
          form: {},
          headers: { Origin: origin },
        },
      );
      assert.equal(nonAdminInvite.status(), 403);

      const publishResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/drafts/${id}`) &&
          r.request().postDataJSON()?.action === "publish",
      );
      await page
        .getByRole("button", { name: "Share draft", exact: true })
        .click();
      const shared = await (await publishResponse).json();
      assert.equal(shared.revision, 1);
      const link = `${baseURL}/r/${shared.token}`;
      // Messaging crawlers receive the real card without JavaScript or a session.
      const robots = await guest.request.get(`${baseURL}/robots.txt`);
      assert.match(await robots.text(), /Allow: \/r\//);
      const crawlerPage = await guest.request.get(link, {
        headers: { "User-Agent": "facebookexternalhit/1.1" },
      });
      assert.equal(crawlerPage.headers()["referrer-policy"], "no-referrer");
      const crawlerHTML = await crawlerPage.text();
      assert.match(crawlerHTML, /property="og:image"/);
      assert.match(crawlerHTML, /The best feedback starts with one question/);
      const previewURL = `${link}/preview.png?v=1`;
      const previewResponse = await guest.request.get(previewURL);
      assert.equal(previewResponse.status(), 200);
      assert.equal(previewResponse.headers()["referrer-policy"], "no-referrer");
      assert.equal(previewResponse.headers()["content-type"], "image/png");
      assert.equal(
        previewResponse.headers()["cache-control"],
        "private, no-store",
      );
      assert.match(previewResponse.headers()["x-robots-tag"], /noindex/);
      const previewBytes = await previewResponse.body();
      const previewSize = await sharp(previewBytes).metadata();
      assert.equal(previewSize.width, 1200);
      assert.equal(previewSize.height, 630);
      // Both outer edges survive in the shared card, rather than a centre crop.
      for (const [left, expected] of [
        [800, [255, 0, 0]],
        [1135, [0, 0, 255]],
      ] as const) {
        const pixel = await sharp(previewBytes)
          .extract({ left, top: 350, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer();
        assert.deepEqual([...pixel], expected);
      }
      assert.equal(
        (
          await guest.request.get(`${baseURL}/r/${"A".repeat(43)}/preview.png`)
        ).status(),
        404,
      );
      await reviewer.goto(link);
      await reviewer
        .getByRole("heading", { name: "Post", exact: true })
        .waitFor();
      await reviewer.getByRole("link", { name: "Back", exact: true }).waitFor();
      assert.equal(
        await reviewer
          .getByRole("button", { name: "Edit", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await reviewer.getByLabel("Post 1 text", { exact: true }).count(),
        0,
      );
      assert.equal(
        await reviewer.locator('meta[property="og:title"]').count(),
        1,
      );
      assert.equal(
        await reviewer
          .locator('meta[property="og:description"]')
          .getAttribute("content"),
        initial,
      );
      assert.equal(
        await reviewer
          .locator('meta[property="og:image"]')
          .getAttribute("content"),
        previewURL,
      );
      assert.equal(
        await reviewer
          .locator('meta[name="twitter:card"]')
          .getAttribute("content"),
        "summary_large_image",
      );
      assert.equal(
        (await guest.request.get(`${avatarURL}?key=${shared.token}`)).status(),
        200,
      );
      assert.equal(
        await reviewer
          .getByRole("article", { name: "Post 1", exact: true })
          .locator(".post-text")
          .innerText(),
        initial,
      );
      assert.equal(
        (
          await guest.request.get(
            `${baseURL}/media/${imageData.id}?key=${shared.token}`,
          )
        ).status(),
        200,
      );
      const bytes = await guest.request.get(
        `${mediaURL}?key=${shared.token}&download=1`,
      );
      assert.deepEqual(
        await bytes.body(),
        await readFile("tests/fixtures/video.mp4"),
      );
      const range = await guest.request.get(`${mediaURL}?key=${shared.token}`, {
        headers: { Range: "bytes=7-31" },
      });
      assert.equal(range.status(), 206);
      assert.deepEqual(
        await range.body(),
        (await readFile("tests/fixtures/video.mp4")).subarray(7, 32),
      );
      assert.equal(
        (
          await guest.request.get(`${mediaURL}?key=${shared.token}`, {
            headers: { Range: "bytes=99999999-" },
          })
        ).status(),
        416,
      );
      await reviewer
        .locator("video")
        .evaluate(async (video: HTMLVideoElement) => {
          await video.play();
        });
      await reviewer.waitForFunction(
        () => document.querySelector("video")!.currentTime > 0.15,
      );
      await reviewer
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.pause());

      assert.equal(
        await reviewer.getByLabel("Your name", { exact: true }).isVisible(),
        false,
      );
      await reviewer
        .getByRole("button", { name: "Comment on post 1", exact: true })
        .click();
      await reviewer
        .getByLabel("Your feedback", { exact: true })
        .fill("The question is a great opener. Try making it more direct.");
      const suggestion =
        "A good post starts with a second pair of eyes.\n\nMind taking a quick look? 👀";
      await reviewer.getByRole("button", { name: "Send feedback" }).click();
      await reviewer
        .getByRole("dialog", { name: "Who’s giving feedback?" })
        .waitFor();
      await reviewer.getByLabel("Your name", { exact: true }).fill("Sam");
      await reviewer
        .getByRole("dialog")
        .getByRole("button", { name: "Send feedback" })
        .click();
      await reviewer
        .getByRole("button", { name: "Feedback sent", exact: true })
        .waitFor();
      // Preserve existing suggested-wording feedback from before the simplified form.
      await db.query("UPDATE comments SET suggestion=$1 WHERE draft_id=$2", [
        suggestion,
        id,
      ]);
      await screenshot(reviewer, "review-desktop");
      await reviewer.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await reviewer.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "review must not overflow on mobile",
      );
      await screenshot(reviewer, "review-mobile");
      await reviewer.setViewportSize({ width: 1440, height: 1000 });

      // Saved edits update the same link without another publication action.
      const newVersion = await edited(page, () =>
        page
          .getByLabel("Post 1 text", { exact: true })
          .fill("UPDATED SHARED WORDING"),
      );
      await reviewer.reload();
      assert.equal(
        await reviewer
          .locator('meta[property="og:description"]')
          .getAttribute("content"),
        "UPDATED SHARED WORDING",
      );
      assert.notEqual(
        await reviewer
          .locator('meta[property="og:image"]')
          .getAttribute("content"),
        previewURL,
      );
      assert.notDeepEqual(
        await (await guest.request.get(previewURL)).body(),
        previewBytes,
        "old image query parameters must not select an older shared revision",
      );
      assert.ok(
        (await reviewer.locator("body").innerText()).includes(
          "UPDATED SHARED WORDING",
        ),
      );
      await action(
        owner.request,
        id,
        { action: "save", version: 1, content: {} },
        400,
      );
      const current: Content = {
        title: "A little room to think",
        author: { name: "Alex", handle: "@alex" },
        posts: [{ id: randomUUID(), text: "Stale", media: [] }],
      };
      await action(
        owner.request,
        id,
        { action: "save", version: 1, content: current },
        409,
      );
      await page.reload();
      await page.getByRole("button", { name: "Use suggestion" }).waitFor();
      await edited(page, () =>
        page.getByRole("button", { name: "Use suggestion" }).click(),
      );
      assert.equal(
        await page.getByLabel("Post 1 text", { exact: true }).inputValue(),
        suggestion,
      );
      await reviewer.goto(link);
      await reviewer.getByText("Earlier feedback", { exact: true }).waitFor();
      assert.equal(
        await reviewer
          .getByRole("article", { name: "Post 1", exact: true })
          .locator(".post-text")
          .innerText(),
        suggestion,
      );
      await screenshot(reviewer, "review-earlier-feedback");
      await reviewer.goto(`${link}?v=1`);
      assert.equal(
        await reviewer
          .getByRole("article", { name: "Post 1", exact: true })
          .locator(".post-text")
          .innerText(),
        suggestion,
      );
      assert.equal(await reviewer.getByLabel("Review version").count(), 0);
      // A genuinely stale browser keeps its unsaved text rather than overwriting another tab.
      const stale = await owner.newPage();
      await stale.goto(`${baseURL}/drafts/${id}`);
      await stale.waitForLoadState("networkidle");
      const followUp = await page
        .getByLabel("Post 2 text", { exact: true })
        .inputValue();
      await edited(page, () =>
        page.getByLabel("Post 2 text", { exact: true }).fill(`${followUp}!`),
      );
      await edited(page, () =>
        page.getByLabel("Post 2 text", { exact: true }).fill(followUp),
      );
      const conflict = stale.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/drafts/${id}`) &&
          r.request().postDataJSON()?.action === "save",
      );
      await stale
        .getByLabel("Post 1 text", { exact: true })
        .fill("Keep my unsaved text in this tab");
      assert.equal((await conflict).status(), 409);
      await stale
        .getByRole("alert")
        .filter({ hasText: "changed in another tab" })
        .waitFor();
      assert.equal(
        await stale.getByLabel("Post 1 text", { exact: true }).inputValue(),
        "Keep my unsaved text in this tab",
      );
      await screenshot(stale, "author-edit-conflict");
      await stale.close();
      // Republishing unchanged content is idempotent.
      const latestVersion = (
        await db.query("SELECT edit_version FROM drafts WHERE id=$1", [id])
      ).rows[0].edit_version;
      const latestRevision = (
        await db.query("SELECT shared_revision FROM drafts WHERE id=$1", [id])
      ).rows[0].shared_revision;
      assert.ok(latestVersion > newVersion);
      assert.equal(
        (
          await action(owner.request, id, {
            action: "publish",
            version: latestVersion,
          })
        ).revision,
        latestRevision,
      );
      await page.getByRole("button", { name: "Resolve", exact: true }).click();
      await page.getByRole("button", { name: "Reopen", exact: true }).waitFor();
      await screenshot(page, "author-shared");
      await page.getByRole("button", { name: "Review link options" }).click();
      assert.equal(
        await page
          .getByRole("link", { name: "Open preview", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "Remove link", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Share draft", exact: true })
        .waitFor();
      assert.equal((await guest.request.get(link)).status(), 404);
      assert.equal((await guest.request.get(previewURL)).status(), 404);
      assert.equal((await owner.request.get(previewURL)).status(), 404);
      assert.equal(
        (await guest.request.get(`${avatarURL}?key=${shared.token}`)).status(),
        404,
      );
      assert.equal(
        (await guest.request.get(`${mediaURL}?key=${shared.token}`)).status(),
        404,
      );
      const renewed = await action(owner.request, id, {
        action: "publish",
        version: latestVersion,
      });
      assert.notEqual(renewed.token, shared.token);
      assert.equal(renewed.revision, latestRevision);

      // Account identity updates existing working drafts, never immutable shared versions.
      await page.getByRole("link", { name: "Account settings" }).click();
      await page
        .getByLabel("Display name", { exact: true })
        .fill("Alex Updated");
      await page.getByLabel("X handle", { exact: true }).fill("@alex_updated");
      await page.getByRole("button", { name: "Save profile" }).click();
      await page.getByText("Profile saved.", { exact: true }).waitFor();
      const replacementPhoto = await sharp({
        create: { width: 420, height: 600, channels: 3, background: "#1d9bf0" },
      })
        .png()
        .toBuffer();
      await page.getByLabel("Upload avatar", { exact: true }).setInputFiles({
        name: "replacement.png",
        mimeType: "image/png",
        buffer: replacementPhoto,
      });
      await page
        .getByRole("button", { name: "Save profile", exact: true })
        .click();
      await page.getByText("Profile saved.", { exact: true }).waitFor();
      const replacementId = (
        await db.query("SELECT avatar_id FROM users WHERE id=$1", [userId])
      ).rows[0].avatar_id;
      assert.equal(
        (
          await guest.request.get(
            `${baseURL}/avatars/${replacementId}?key=${renewed.token}`,
          )
        ).status(),
        404,
      );
      await reviewer.goto(`${baseURL}/r/${renewed.token}`);
      assert.equal(
        (await guest.request.get(`${avatarURL}?key=${renewed.token}`)).status(),
        200,
      );
      await reviewer.getByText("Alex", { exact: true }).first().waitFor();
      assert.equal(
        await reviewer.getByText("Alex", { exact: true }).count(),
        2,
      );
      assert.equal(
        await reviewer.getByText("@alex", { exact: true }).count(),
        2,
      );
      await edited(page, () => page.goto(`${baseURL}/drafts/${id}`));
      await page.getByText("@alex_updated", { exact: true }).first().waitFor();
      assert.equal(
        await page.getByText("Shared version history", { exact: true }).count(),
        0,
      );
      await reviewer.goto(`${baseURL}/r/${renewed.token}`);
      assert.equal(
        (
          await guest.request.get(
            `${baseURL}/avatars/${replacementId}?key=${renewed.token}`,
          )
        ).status(),
        200,
      );
      assert.equal(
        await reviewer.getByText("Alex Updated", { exact: true }).count(),
        2,
      );
      await reviewer.goto(`${baseURL}/r/${renewed.token}?v=1`);
      assert.equal(
        await reviewer.getByText("Alex Updated", { exact: true }).count(),
        2,
      );

      // Invitations actually create a new author, are single-use, and grant no admin power.
      await page.goto(`${baseURL}/settings`);
      await screenshot(page, "settings");
      const invitation = token();
      await db.query(
        "INSERT INTO invites(id,hash,created_by,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
        [randomUUID(), tokenHash(invitation), userId],
      );
      const inviteURL = `${baseURL}/join/${invitation}`;
      const invited = await browser.newContext({ javaScriptEnabled: false });
      const joining = await invited.newPage();
      const invitationPage = await joining.goto(inviteURL);
      assert.equal(
        invitationPage?.headers()["referrer-policy"],
        "strict-origin",
      );
      await joining.waitForLoadState("networkidle");
      await screenshot(joining, "join");
      const passwordAlternative = joining.getByText(
        "Sign up with a password instead",
        { exact: true },
      );
      if (await passwordAlternative.isVisible())
        await passwordAlternative.click();
      await joining
        .getByLabel("Your name", { exact: true })
        .fill("Invited friend");
      const invitedEmail = `test-invited-${userId}@example.test`;
      await joining.getByLabel("Email", { exact: true }).fill(invitedEmail);
      await joining.getByLabel(/^Password/).fill(password);
      await joining.getByRole("button", { name: "Create account" }).click();
      await joining
        .getByRole("main", { name: "Drafts", exact: true })
        .waitFor();
      await joining.goto(`${baseURL}/settings`);
      assert.equal(
        await joining
          .getByRole("button", { name: "Create invitation" })
          .count(),
        0,
      );
      assert.equal((await guest.request.get(inviteURL)).status(), 404);

      // Password changes and CLI recovery invalidate both new and pre-migration sessions.
      const secondLogin = await browser.newContext();
      const secondPage = await secondLogin.newPage();
      await login(secondPage, invitedEmail);
      const legacy = await browser.newContext();
      const legacyToken = token();
      const invitedId = (
        await db.query("SELECT id FROM users WHERE email=$1", [invitedEmail])
      ).rows[0].id;
      await db.query(
        "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [tokenHash(legacyToken), invitedId],
      );
      await legacy.addCookies([
        { name: "lastpeek_session", value: legacyToken, url: baseURL },
      ]);
      assert.equal(
        new URL((await legacy.request.get(`${baseURL}/settings`)).url())
          .pathname,
        "/settings",
      );
      const changedPassword = `changed-${randomUUID()}`;
      await joining
        .getByRole("link", { name: "Password", exact: true })
        .click();
      await joining
        .getByLabel("Current password", { exact: true })
        .fill("incorrect-password");
      await joining
        .getByLabel("New password", { exact: true })
        .fill(changedPassword);
      await joining
        .getByRole("button", { name: "Update password", exact: true })
        .click();
      await joining
        .getByText("The current password doesn’t match.", { exact: true })
        .waitFor();
      await joining
        .getByLabel("Current password", { exact: true })
        .fill(password);
      await joining
        .getByLabel("New password", { exact: true })
        .fill(changedPassword);
      await joining
        .getByRole("button", { name: "Update password", exact: true })
        .click();
      await joining
        .getByText("Password changed. Other sessions have been signed out.", {
          exact: true,
        })
        .waitFor();
      for (const context of [secondLogin, legacy]) {
        assert.equal(
          new URL((await context.request.get(`${baseURL}/settings`)).url())
            .pathname,
          "/login",
        );
      }
      await joining.reload();
      await joining
        .getByRole("heading", { name: "Change your password", exact: true })
        .waitFor();
      await joining
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await joining
        .getByRole("button", { name: "Sign in", exact: true })
        .waitFor();
      assert.equal(
        new URL((await invited.request.get(`${baseURL}/settings`)).url())
          .pathname,
        "/login",
      );
      await login(joining, invitedEmail, changedPassword);
      const recoveredPassword = `recovered-${randomUUID()}`;
      const recovery = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/reset-password.ts", invitedEmail],
        {
          input: `${recoveredPassword}\n`,
          encoding: "utf8",
          env: process.env,
        },
      );
      assert.equal(recovery.status, 0, recovery.stderr);
      assert.match(recovery.stdout, /all existing sessions invalidated/);
      assert.equal(
        new URL((await invited.request.get(`${baseURL}/settings`)).url())
          .pathname,
        "/login",
      );
      await login(joining, invitedEmail, recoveredPassword);
      await secondLogin.close();
      await legacy.close();
      await invited.close();
      await page.getByRole("button", { name: "Remove photo" }).click();
      await page
        .getByRole("button", { name: "Save profile", exact: true })
        .click();
      await page.getByText("Profile saved.", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Remove photo" }).count(),
        0,
      );
      assert.equal(
        (
          await guest.request.get(
            `${baseURL}/avatars/${replacementId}?key=${renewed.token}`,
          )
        ).status(),
        200,
      );
      await page.goto(`${baseURL}/drafts/${id}`);
      await page.getByText("All changes saved", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "More draft actions", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Delete draft", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Delete this draft?" })
        .getByRole("button", { name: "Delete draft", exact: true })
        .click();
      await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
      assert.equal(
        (await guest.request.get(`${baseURL}/r/${renewed.token}`)).status(),
        404,
      );
      assert.equal(
        (await guest.request.get(`${avatarURL}?key=${renewed.token}`)).status(),
        404,
      );
      // Live review: empty posts do not block sharing; general, post and text focus stay distinct.
      const focusId = randomUUID(),
        firstPost = randomUUID(),
        secondPost = randomUUID();
      const focusContent: Content = {
        title: "",
        author: { name: "Alex Updated", handle: "alex_updated", avatar: null },
        posts: [
          {
            id: firstPost,
            text: "A focused opening with a specific phrase.",
            media: [],
          },
          { id: secondPost, text: "A different closing thought.", media: [] },
          { id: randomUUID(), text: "", media: [] },
        ],
      };
      await db.query(
        "INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)",
        [focusId, userId, JSON.stringify(focusContent)],
      );
      await page.goto(`${baseURL}/drafts/${focusId}`);
      const focusPublish = page.waitForResponse(
        (r) => r.request().postDataJSON()?.action === "publish",
      );
      await page
        .getByRole("button", { name: "Share draft", exact: true })
        .click();
      const focusShared = await (await focusPublish).json();
      const focusLink = `${baseURL}/r/${focusShared.token}`;
      await page
        .getByRole("button", { name: "Copy link", exact: true })
        .waitFor();
      await reviewer.goto(focusLink);
      await reviewer
        .getByLabel("Your feedback", { exact: true })
        .fill("The thread works as a whole.");
      await reviewer
        .getByRole("button", { name: "Send feedback", exact: true })
        .click();
      await reviewer
        .getByRole("button", { name: "Feedback sent", exact: true })
        .waitFor();
      await reviewer.getByText("General feedback", { exact: true }).waitFor();
      await reviewer
        .getByRole("button", { name: "Comment on post 2", exact: true })
        .click();
      await reviewer
        .getByLabel("Your feedback", { exact: true })
        .fill("The closing thought could be stronger.");
      await reviewer
        .getByRole("button", { name: "Send feedback", exact: true })
        .click();
      await reviewer
        .getByRole("button", { name: "Feedback sent", exact: true })
        .waitFor();
      await reviewer.getByText("On post 2", { exact: true }).waitFor();
      // Real pointer selection, not a synthetic focus event.
      const bounds = await reviewer
        .getByText(focusContent.posts[0].text, { exact: true })
        .boundingBox();
      assert.ok(bounds);
      await reviewer.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
      await reviewer.mouse.down();
      await reviewer.mouse.move(bounds.x + 117, bounds.y + bounds.height / 2, {
        steps: 12,
      });
      await reviewer.mouse.up();
      const selected = await reviewer.evaluate(() =>
        window.getSelection()?.toString(),
      );
      assert.ok(selected && selected.length > 5);
      await reviewer
        .getByRole("blockquote")
        .filter({ hasText: selected })
        .waitFor();
      await reviewer
        .getByLabel("Your feedback", { exact: true })
        .fill("Tighten this wording.");
      // The author changes the text while the reviewer is writing. The comment must keep the original target.
      await edited(page, () =>
        page
          .getByLabel("Post 1 text", { exact: true })
          .fill("An updated opening without the old phrase."),
      );
      await reviewer
        .getByRole("button", { name: "Send feedback", exact: true })
        .click();
      await reviewer
        .getByRole("button", { name: "Feedback sent", exact: true })
        .waitFor();
      const quoteCard = reviewer
        .getByRole("article", { name: "Feedback from Sam" })
        .filter({ hasText: "Tighten this wording." });
      await quoteCard.getByText("Earlier feedback", { exact: true }).waitFor();
      assert.equal(
        await quoteCard.getByRole("blockquote").innerText(),
        selected,
      );
      await reviewer
        .getByText("An updated opening without the old phrase.", {
          exact: true,
        })
        .waitFor();
      const stored = (
        await db.query(
          "SELECT body,post_id,quote,revision FROM comments WHERE draft_id=$1 ORDER BY created_at",
          [focusId],
        )
      ).rows;
      assert.deepEqual(
        stored.map((c) => [c.body, c.post_id, c.quote, c.revision]),
        [
          ["The thread works as a whole.", null, null, 1],
          ["The closing thought could be stronger.", secondPost, null, 1],
          ["Tighten this wording.", firstPost, selected, 1],
        ],
      );
      const badFocus = await guest.request.post(`${focusLink}?/comment`, {
        headers: { Origin: origin },
        form: {
          name: "Sam",
          body: "Invalid focus",
          revision: "1",
          postId: secondPost,
          quote: selected,
        },
      });
      assert.equal(
        badFocus.status(),
        400,
        "quotes must belong to the selected post and snapshot",
      );
      const changedQuote = await guest.request.post(`${focusLink}?/comment`, {
        headers: { Origin: origin },
        form: {
          name: "Sam",
          body: "Invalid quote",
          revision: "2",
          postId: firstPost,
          quote: selected,
        },
      });
      assert.equal(
        changedQuote.status(),
        400,
        "quotes must belong to the snapshot being commented on",
      );
      const signedFeedback = await owner.request.post(`${focusLink}?/comment`, {
        headers: { Origin: origin },
        form: {
          name: "Forged name",
          body: "Signed-in feedback",
          revision: "2",
          postId: "",
        },
      });
      assert.equal(signedFeedback.status(), 200);
      assert.equal(
        (
          await db.query(
            "SELECT name FROM comments WHERE draft_id=$1 AND body='Signed-in feedback'",
            [focusId],
          )
        ).rows[0].name,
        "Alex Updated",
      );
      // A signed-in reviewer is not the draft owner; identity follows their account.
      const reviewerPhotoUpload = await other.request.post(
        `${baseURL}/api/profile/avatar`,
        {
          headers: { Origin: origin, "Content-Type": "image/png" },
          data: image,
        },
      );
      assert.equal(reviewerPhotoUpload.status(), 201);
      const reviewerAvatar = (await reviewerPhotoUpload.json()).avatar;
      const feedbackAvatarURL = `${baseURL}/avatars/${reviewerAvatar}`;
      assert.equal(
        (
          await guest.request.get(
            `${feedbackAvatarURL}?key=${focusShared.token}`,
          )
        ).status(),
        404,
        "a link cannot read unrelated account photos",
      );
      await stranger.goto(focusLink);
      await stranger
        .getByRole("link", { name: "Account settings", exact: true })
        .waitFor();
      const reviewNavigation = stranger.getByRole("navigation", {
        name: "Main navigation",
      });
      await reviewNavigation
        .getByRole("link", { name: "Drafts", exact: true })
        .waitFor();
      await reviewNavigation
        .getByRole("link", { name: "Feedback", exact: true })
        .waitFor();
      assert.equal(await stranger.locator("footer").count(), 0);
      for (const width of [390, 320]) {
        await stranger.setViewportSize({ width, height: 844 });
        assert.equal(await reviewNavigation.isVisible(), true);
        assert.equal(
          await stranger.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
      }
      await stranger.setViewportSize({ width: 1280, height: 720 });
      await reviewNavigation
        .getByRole("link", { name: "Drafts", exact: true })
        .click();
      await stranger
        .getByRole("main", { name: "Drafts", exact: true })
        .waitFor();
      await stranger.goBack();
      await stranger.getByLabel("Your feedback", { exact: true }).waitFor();
      await stranger
        .getByRole("link", { name: "Back to drafts", exact: true })
        .click();
      await stranger
        .getByRole("main", { name: "Drafts", exact: true })
        .waitFor();
      await stranger.goBack();
      await stranger
        .getByRole("heading", { name: "Post", exact: true })
        .waitFor();
      assert.equal(
        await reviewer
          .getByRole("navigation", { name: "Main navigation" })
          .count(),
        0,
      );
      await reviewer
        .getByRole("link", { name: "Sign in", exact: true })
        .waitFor();
      assert.equal(
        await stranger
          .getByRole("link", { name: "Sign in", exact: true })
          .count(),
        0,
      );
      await stranger
        .getByLabel("Your feedback", { exact: true })
        .fill("Feedback from another signed-in account.");
      await stranger
        .getByRole("button", { name: "Send feedback", exact: true })
        .click();
      await stranger
        .getByRole("button", { name: "Feedback sent", exact: true })
        .waitFor();
      const identityComment = stranger.getByRole("article", {
        name: "Feedback from Other author",
        exact: true,
      });
      await identityComment.waitFor();
      assert.equal(
        await identityComment.locator("img").getAttribute("src"),
        `/avatars/${reviewerAvatar}?key=${focusShared.token}`,
      );
      assert.equal(
        (
          await guest.request.get(
            `${feedbackAvatarURL}?key=${focusShared.token}`,
          )
        ).status(),
        200,
      );
      assert.equal((await guest.request.get(feedbackAvatarURL)).status(), 404);
      assert.equal(
        (
          await guest.request.get(`${feedbackAvatarURL}?key=not-a-review-token`)
        ).status(),
        404,
      );
      // A guest using the same name must never be linked by name matching.
      const sameNameGuest = await guest.request.post(`${focusLink}?/comment`, {
        headers: { Origin: origin },
        form: {
          name: "Other author",
          body: "Same-name guest feedback",
          revision: "2",
          postId: "",
        },
      });
      assert.equal(sameNameGuest.status(), 200);
      const renamed = await other.request.post(`${baseURL}/settings?/profile`, {
        headers: { Origin: origin },
        form: { name: "Reviewer renamed", handle: "new_handle" },
      });
      assert.equal(renamed.status(), 200);
      await stranger.reload();
      await stranger
        .getByRole("article", {
          name: "Feedback from Reviewer renamed",
          exact: true,
        })
        .waitFor();
      await reviewer.reload();
      await reviewer
        .getByRole("article", {
          name: "Feedback from Reviewer renamed",
          exact: true,
        })
        .waitFor();
      const guestIdentity = reviewer.getByRole("article", {
        name: "Feedback from Other author",
        exact: true,
      });
      assert.equal(await guestIdentity.locator("img").count(), 0);
      await page.goto(`${baseURL}/drafts/${focusId}`);
      const authorIdentity = page.getByRole("article", {
        name: "Feedback from Reviewer renamed",
        exact: true,
      });
      await authorIdentity.waitFor();
      assert.equal(
        await authorIdentity.locator("img").getAttribute("src"),
        `/avatars/${reviewerAvatar}`,
      );
      await page.goto(`${baseURL}/feedback`);
      await page
        .getByRole("link", { name: /^Open feedback from Reviewer renamed:/ })
        .waitFor();
      const newReviewerPhoto = await other.request.post(
        `${baseURL}/api/profile/avatar`,
        {
          headers: { Origin: origin, "Content-Type": "image/png" },
          data: replacementPhoto,
        },
      );
      const newReviewerAvatar = (await newReviewerPhoto.json()).avatar;
      await reviewer.reload();
      assert.equal(
        await reviewer
          .getByRole("article", {
            name: "Feedback from Reviewer renamed",
            exact: true,
          })
          .locator("img")
          .getAttribute("src"),
        `/avatars/${newReviewerAvatar}?key=${focusShared.token}`,
      );
      assert.equal(
        (
          await guest.request.get(
            `${feedbackAvatarURL}?key=${focusShared.token}`,
          )
        ).status(),
        404,
        "replaced feedback photos lose capability access",
      );
      assert.equal(
        (
          await guest.request.get(
            `${baseURL}/avatars/${newReviewerAvatar}?key=${focusShared.token}`,
          )
        ).status(),
        200,
      );
      for (const width of [390, 320]) {
        await reviewer.setViewportSize({ width, height: 844 });
        await reviewer
          .getByRole("button", { name: "Comment on post 2", exact: true })
          .click();
        assert.equal(
          await reviewer.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await screenshot(reviewer, `review-focus-${width}`);
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
      }
      await action(owner.request, focusId, { action: "revoke" });
      assert.equal((await guest.request.get(focusLink)).status(), 404);
      assert.equal(
        (
          await guest.request.get(
            `${baseURL}/avatars/${newReviewerAvatar}?key=${focusShared.token}`,
          )
        ).status(),
        404,
        "revocation also protects reviewer photos",
      );
      for (const window of [page, reviewer]) {
        const cachedPaths = await window.evaluate(async () => {
          const entries = await Promise.all(
            (await caches.keys()).map(async (key) =>
              (await (await caches.open(key)).keys()).map(
                (request) => new URL(request.url).pathname,
              ),
            ),
          );
          return entries.flat();
        });
        assert.deepEqual(
          cachedPaths,
          ["/offline.html"],
          "private author/reviewer workflows must not populate offline storage",
        );
      }
      assert.deepEqual(crashes, [], "no browser exceptions");
    } catch (error) {
      console.error("Browser exceptions:", crashes);
      console.error(
        "Visible failure state:",
        await page.locator("body").innerText(),
      );
      await screenshot(page, "failure");
      throw error;
    } finally {
      await browser.close();
      const ids = [userId, strangerId];
      const files = await db.query(
        "SELECT id FROM media WHERE owner_id=ANY($1::uuid[])",
        [ids],
      );
      const avatarFiles = await db.query(
        "SELECT id FROM avatars WHERE owner_id=ANY($1::uuid[])",
        [ids],
      );
      await db.query("DELETE FROM drafts WHERE owner_id=ANY($1::uuid[])", [
        ids,
      ]);
      await db.query("DELETE FROM invites WHERE created_by=ANY($1::uuid[])", [
        ids,
      ]);
      await db.query(
        "DELETE FROM feature_audit WHERE user_id=ANY($1::uuid[])",
        [ids],
      );
      await db.query("DELETE FROM users WHERE id=ANY($1::uuid[]) OR email=$2", [
        ids,
        `test-invited-${userId}@example.test`,
      ]);
      await Promise.all(
        files.rows.map((row) => rm(mediaPath(row.id), { force: true })),
      );
      await Promise.all(
        avatarFiles.rows.map((row) => rm(avatarPath(row.id), { force: true })),
      );
      await db.end();
    }
  },
);
