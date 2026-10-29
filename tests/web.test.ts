import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { passwordHash } from "../src/lib/server/auth";
import { mediaPath } from "../src/lib/server/media";
import { avatarPath } from "../src/lib/server/avatars";
import type { Content } from "../src/lib/contracts";

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

async function login(page: Page, account: string) {
  await page.goto(`${baseURL}/login`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email", { exact: true }).fill(account);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Your drafts." }).waitFor();
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
  "author → private draft → media → versioned guest review → revoke",
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
    for (const p of [page, reviewer, stranger]) {
      p.on("pageerror", (e) => crashes.push(e.message));
      p.on("dialog", (dialog) => dialog.accept());
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
      assert.equal(
        (
          await db.query("SELECT 1 FROM users WHERE email=$1", [
            `uninvited-${userId}@example.test`,
          ])
        ).rowCount,
        0,
      );
      await login(page, email);
      await screenshot(page, "empty-drafts");
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
      const photo = await sharp({
        create: { width: 640, height: 480, channels: 3, background: "#c4f36b" },
      })
        .png()
        .toBuffer();
      const avatarUpload = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/profile/avatar") &&
          r.request().method() === "POST",
      );
      await page.getByLabel("Upload avatar", { exact: true }).setInputFiles({
        name: "profile.png",
        mimeType: "image/png",
        buffer: photo,
      });
      assert.equal((await avatarUpload).status(), 201);
      const avatarId = (await (await avatarUpload).json()).avatar;
      await page.getByText("Avatar updated.", { exact: true }).waitFor();
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
      await page.getByRole("alert").filter({ hasText: "Use a JPEG" }).waitFor();
      await screenshot(page, "avatar-upload-error");
      await page.getByRole("link", { name: "LastPeek home" }).click();
      await page
        .getByRole("button", { name: "New draft", exact: true })
        .click();
      await page.getByLabel("Post 1 text", { exact: true }).waitFor();
      await page.waitForLoadState("networkidle");
      const id = page.url().split("/").at(-1)!;
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
        await page.getByRole("region", { name: "AI second look" }).count(),
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
        await page.getByRole("region", { name: "AI second look" }).count(),
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
        await page.getByRole("region", { name: "AI second look" }).count(),
        0,
      );
      const access = await featureAccess(email);
      assert.equal(access.features["ai-review"], false);
      assert.deepEqual(
        access.history.map((entry) => [entry.enabled, entry.reason]),
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
          await page.getByRole("region", { name: "AI second look" }).count(),
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
        await page.getByRole("button", { name: "Dismiss message" }).click();
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
      await reviewer.goto(link);
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

      await reviewer.getByLabel("Your name", { exact: true }).fill("Sam");
      await reviewer
        .getByLabel("Your feedback", { exact: true })
        .fill("The question is a great opener. Try making it more direct.");
      await reviewer
        .getByText("Suggest different wording", { exact: false })
        .click();
      const suggestion =
        "A good post starts with a second pair of eyes.\n\nMind taking a quick look? 👀";
      await reviewer
        .getByRole("textbox", { name: "Suggested wording" })
        .fill(suggestion);
      await reviewer.getByRole("button", { name: "Send feedback" }).click();
      await reviewer
        .getByText("Your feedback is in. Thank you!", { exact: true })
        .waitFor();
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

      // Private edits are invisible until explicit publication, including uploaded metadata.
      const newVersion = await edited(page, () =>
        page
          .getByLabel("Post 1 text", { exact: true })
          .fill("PRIVATE UNSHARED WORDING"),
      );
      await reviewer.reload();
      assert.ok(
        !(await reviewer.locator("body").innerText()).includes(
          "PRIVATE UNSHARED WORDING",
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
      await page.getByRole("button", { name: "Refresh feedback" }).click();
      await page.getByRole("button", { name: "Use suggestion" }).waitFor();
      await edited(page, () =>
        page.getByRole("button", { name: "Use suggestion" }).click(),
      );
      assert.equal(
        await page.getByLabel("Post 1 text", { exact: true }).inputValue(),
        suggestion,
      );
      const publish2 = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/drafts/${id}`) &&
          r.request().postDataJSON()?.action === "publish",
      );
      await page.getByRole("button", { name: "Update shared version" }).click();
      assert.equal((await (await publish2).json()).revision, 2);
      await reviewer.goto(link);
      await reviewer
        .getByText("v1 · Earlier version", { exact: true })
        .waitFor();
      assert.equal(
        await reviewer
          .getByRole("article", { name: "Post 1", exact: true })
          .locator(".post-text")
          .innerText(),
        suggestion,
      );
      await screenshot(reviewer, "review-earlier-feedback");
      await reviewer.getByLabel("Review version").selectOption("1");
      await reviewer
        .getByText("You’re looking at an earlier version.", { exact: false })
        .waitFor();
      assert.equal(
        await reviewer
          .getByRole("article", { name: "Post 1", exact: true })
          .locator(".post-text")
          .innerText(),
        initial,
      );
      await screenshot(reviewer, "review-history");
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
      assert.ok(latestVersion > newVersion);
      assert.equal(
        (
          await action(owner.request, id, {
            action: "publish",
            version: latestVersion,
          })
        ).revision,
        2,
      );
      await page.getByRole("button", { name: "Resolve", exact: true }).click();
      await page.getByRole("button", { name: "Reopen", exact: true }).waitFor();
      await screenshot(page, "author-shared");
      await page
        .getByRole("button", { name: "Revoke link", exact: true })
        .click();
      await page
        .getByText("Link revoked. Your feedback is still here.", {
          exact: true,
        })
        .waitFor();
      assert.equal((await guest.request.get(link)).status(), 404);
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
      assert.equal(renewed.revision, 2);

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
      const replacementUpload = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/profile/avatar") &&
          r.request().method() === "POST",
      );
      await page.getByLabel("Upload avatar", { exact: true }).setInputFiles({
        name: "replacement.png",
        mimeType: "image/png",
        buffer: replacementPhoto,
      });
      const replacementId = (await (await replacementUpload).json()).avatar;
      await page.getByText("Avatar updated.", { exact: true }).waitFor();
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
      await page.getByText("Shared version history", { exact: true }).click();
      await page.getByRole("button", { name: /^Version 1/ }).click();
      assert.equal(
        await page.getByLabel("Post 1 text", { exact: true }).count(),
        0,
      );
      await page.getByText("@alex", { exact: true }).first().waitFor();
      await screenshot(page, "author-history");
      await page.getByRole("button", { name: "Back to working draft" }).click();
      await page.getByLabel("Post 1 text", { exact: true }).waitFor();
      const updatedProfileShare = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/drafts/${id}`) &&
          r.request().postDataJSON()?.action === "publish",
      );
      await page.getByRole("button", { name: "Update shared version" }).click();
      assert.equal((await (await updatedProfileShare).json()).revision, 3);
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
      await reviewer.getByLabel("Review version").selectOption("1");
      await reviewer
        .getByText("You’re looking at an earlier version.", { exact: false })
        .waitFor();
      assert.equal(
        await reviewer.getByText("Alex", { exact: true }).count(),
        2,
      );

      // Invitations actually create a new author, are single-use, and grant no admin power.
      await page.goto(`${baseURL}/settings`);
      await screenshot(page, "settings");
      await page.getByRole("button", { name: "Create invitation" }).click();
      const invite = page.getByLabel("Invitation link", { exact: true });
      await invite.waitFor();
      const inviteURL = await invite.inputValue();
      const invited = await browser.newContext();
      const joining = await invited.newPage();
      await joining.goto(inviteURL);
      await joining.waitForLoadState("networkidle");
      await screenshot(joining, "join");
      await joining
        .getByLabel("Your name", { exact: true })
        .fill("Invited friend");
      const invitedEmail = `test-invited-${userId}@example.test`;
      await joining.getByLabel("Email", { exact: true }).fill(invitedEmail);
      await joining.getByLabel(/^Password/).fill(password);
      await joining.getByRole("button", { name: "Create account" }).click();
      await joining.getByRole("heading", { name: "Your drafts." }).waitFor();
      await joining.goto(`${baseURL}/settings`);
      assert.equal(
        await joining
          .getByRole("button", { name: "Create invitation" })
          .count(),
        0,
      );
      assert.equal((await guest.request.get(inviteURL)).status(), 404);
      await invited.close();
      await page.getByRole("button", { name: "Remove photo" }).click();
      await page.getByText("Avatar removed.", { exact: true }).waitFor();
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
        .getByRole("button", { name: "Delete draft", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "Delete this draft?" })
        .getByRole("button", { name: "Delete draft", exact: true })
        .click();
      await page.getByRole("heading", { name: "Your drafts." }).waitFor();
      assert.equal(
        (await guest.request.get(`${baseURL}/r/${renewed.token}`)).status(),
        404,
      );
      assert.equal(
        (await guest.request.get(`${avatarURL}?key=${renewed.token}`)).status(),
        404,
      );
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
