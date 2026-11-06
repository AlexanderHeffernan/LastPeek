import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import sharp from "sharp";
import { db } from "../src/lib/server/db";
import { hash, passwordHash, token } from "../src/lib/server/auth";
import { publishDraft } from "../src/lib/server/drafts";
import { blankContent } from "../src/lib/contracts";
import { mediaPath } from "../src/lib/server/media";

// Permanent browser coverage is deliberately limited to five product workflows
// and one privacy exception. Feature-specific verification belongs in temporary
// checks, not in additional branches of these tests. See AGENTS.md.
const baseURL = process.env.TEST_BASE_URL!;
assert.ok(baseURL && process.env.DATABASE_URL, "Use the isolated verifier");
const engine = process.env.TEST_BROWSER === "webkit" ? webkit : chromium;
const password = `test-only-${randomUUID()}`;
let browser: Browser;
let credentials: string;
before(async () => {
  [browser, credentials] = await Promise.all([
    engine.launch(),
    passwordHash(password),
  ]);
});
after(async () => {
  try {
    await browser?.close();
  } finally {
    await db.end();
  }
});

type Fixture = {
  id: string;
  email: string;
  emails: string[];
  context: BrowserContext;
  page: Page;
  guest: () => Promise<Page>;
  draft: (
    text: string,
  ) => Promise<{ id: string; content: ReturnType<typeof blankContent> }>;
  files: string[];
};

function workflow(
  name: string,
  work: (fixture: Fixture) => Promise<void>,
  options: { authenticated?: boolean; serviceWorkers?: "allow" | "block" } = {},
) {
  test(name, { timeout: 30000 }, async () => {
    const id = randomUUID();
    const email = `core-${id}@example.test`;
    const emails = [email],
      files: string[] = [],
      contexts: BrowserContext[] = [];
    const errors: string[] = [];
    async function context() {
      const client = await browser.newContext({
        ...(engine === webkit
          ? {
              viewport: { width: 390, height: 844 },
              isMobile: true,
              hasTouch: true,
              deviceScaleFactor: 2,
            }
          : { viewport: { width: 1280, height: 900 } }),
        serviceWorkers: options.serviceWorkers ?? "block",
      });
      contexts.push(client);
      client.on("page", (page) =>
        page.on("pageerror", (error) => errors.push(error.message)),
      );
      return client;
    }
    try {
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Core author',$3)",
        [id, email, credentials],
      );
      const client = await context();
      if (options.authenticated !== false) {
        const session = token();
        await db.query(
          "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
          [hash(session), id],
        );
        await client.addCookies([
          { name: "lastpeek_session", value: session, url: baseURL },
        ]);
      }
      await work({
        id,
        email,
        emails,
        context: client,
        page: await client.newPage(),
        files,
        guest: async () => (await context()).newPage(),
        draft: async (text) => {
          const draft = randomUUID(),
            content = blankContent("Core author");
          content.posts[0].text = text;
          await db.query(
            "INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)",
            [draft, id, content],
          );
          return { id: draft, content };
        },
      });
      assert.deepEqual(errors, [], "no browser exceptions");
    } catch (error) {
      // Synthetic fixtures only; never capture cookies, request headers or bodies.
      // This directory is outside the disposable build and survives its cleanup.
      if (process.env.TEST_ARTIFACTS_DIR) {
        try {
          const directory = resolve(
            process.env.TEST_ARTIFACTS_DIR,
            name.replace(/[^a-z0-9]+/gi, "-"),
          );
          await mkdir(directory, { recursive: true });
          await writeFile(
            `${directory}/failure.json`,
            JSON.stringify(
              {
                test: name,
                engine: engine.name(),
                error: String(error),
                browserErrors: errors,
              },
              null,
              2,
            ),
          );
          for (const [index, page] of contexts
            .flatMap((client) => client.pages())
            .entries())
            await page.screenshot({
              path: `${directory}/page-${index}.png`,
              timeout: 3000,
            });
        } catch (captureError) {
          console.error(
            "Failure capture unavailable:",
            (captureError as Error).name,
          );
        }
      }
      throw error;
    } finally {
      try {
        await Promise.all(contexts.map((client) => client.close()));
      } finally {
        await db.query(
          "DELETE FROM drafts WHERE owner_id IN (SELECT id FROM users WHERE email=ANY($1::text[]))",
          [emails],
        );
        await db.query("DELETE FROM invites WHERE created_by=$1", [id]);
        await db.query("DELETE FROM users WHERE email=ANY($1::text[])", [
          emails,
        ]);
        await Promise.all(files.map((path) => rm(path, { force: true })));
      }
    }
  });
}

workflow(
  "core / invitation creates an account",
  async ({ id, emails, page, context }) => {
    const invite = token(),
      email = `invited-${id}@example.test`;
    emails.push(email);
    await db.query(
      "INSERT INTO invites(id,hash,created_by,email,plan,expires_at) VALUES($1,$2,$3,$4,'free',now()+interval '1 day')",
      [randomUUID(), hash(invite), id, email],
    );
    await page.goto(`${baseURL}/join/${invite}`);
    await page.getByLabel("Your name", { exact: true }).fill("New author");
    await page.getByLabel(/^Password/).fill(password);
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
    assert.equal(
      (
        await context.request.get(`${baseURL}/settings`, { maxRedirects: 0 })
      ).status(),
      200,
    );
    assert.equal(
      (await db.query("SELECT email FROM users WHERE email=$1", [email]))
        .rows[0]?.email,
      email,
    );
  },
  { authenticated: false },
);

workflow(
  "core / sign in and sign out",
  async ({ email, page, context }) => {
    await page.goto(`${baseURL}/login`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("main", { name: "Drafts", exact: true }).waitFor();
    await page.goto(`${baseURL}/settings`);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    const denied = await context.request.get(`${baseURL}/settings`, {
      maxRedirects: 0,
    });
    assert.equal(denied.status(), 303);
    assert.equal(
      new URL(denied.headers().location, baseURL).pathname,
      "/login",
    );
  },
  { authenticated: false },
);

workflow("core / create and edit a persisted post", async ({ page }) => {
  await page.goto(baseURL);
  await page
    .getByRole("button", { name: "Write your first post", exact: true })
    .click();
  await page.waitForURL(/\/drafts\/[0-9a-f-]+/);
  const url = page.url().split("?")[0];
  const initial = "A fresh thought 👀\nNot the final wording.";
  const revised = "The edited thought: 17 chairs, not 12.";
  async function edit(target: Page, text: string) {
    const saved = target.waitForResponse(
      (response) =>
        response.url().includes("/api/drafts/") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.action === "save",
    );
    // Surface an edit failure rather than a second rejection during cleanup.
    void saved.catch(() => {});
    const input = target.getByLabel("Post 1 text", { exact: true });
    await input.click();
    await input.fill(text);
    assert.equal(await input.inputValue(), text);
    assert.equal((await saved).status(), 200);
    await target.getByText("All changes saved", { exact: true }).waitFor();
  }
  await edit(page, initial);
  await page.goto(url);
  assert.equal(
    await page.getByLabel("Post 1 text", { exact: true }).inputValue(),
    initial,
  );
  await edit(page, revised);
  await page.goto(url);
  assert.equal(
    await page.getByLabel("Post 1 text", { exact: true }).inputValue(),
    revised,
  );
});

workflow(
  "core / share a post with a separate reviewer",
  async ({ page, draft, guest }) => {
    const text = "Please review the blue room, not the green room.";
    const seeded = await draft(text);
    await page.goto(`${baseURL}/drafts/${seeded.id}`);
    await page
      .getByRole("button", { name: "Share draft", exact: true })
      .click();
    const published = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/drafts/${seeded.id}`) &&
        response.request().postDataJSON()?.action === "publish",
    );
    await page
      .getByRole("button", { name: "Create review link", exact: true })
      .click();
    const response = await published;
    assert.equal(response.status(), 200);
    const shared = await response.json();
    const reviewer = await guest();
    await reviewer.goto(`${baseURL}/r/${shared.token}`);
    await reviewer
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await reviewer
      .getByRole("region", { name: "Post for review" })
      .getByText(text, { exact: true })
      .waitFor();
  },
);

workflow(
  "core / reviewer sends feedback and author receives it",
  async ({ id, page, draft, guest }) => {
    const seeded = await draft("Would you keep the opening question?");
    const shared = await publishDraft(seeded.id, id, 1);
    const reviewer = await guest();
    await reviewer.goto(`${baseURL}/r/${shared.token}`);
    await reviewer.getByLabel("Your name", { exact: true }).fill("Jules");
    await reviewer
      .getByRole("button", { name: "Continue as guest", exact: true })
      .click();
    const feedback = "Keep the question; remove the second sentence.";
    await reviewer.getByLabel("Your feedback", { exact: true }).fill(feedback);
    const sent = reviewer.waitForResponse(
      (response) =>
        response.url().includes(`/r/${shared.token}`) &&
        response.request().method() === "POST",
    );
    await reviewer
      .getByRole("button", { name: "Send feedback", exact: true })
      .click();
    assert.equal((await sent).status(), 200);
    await reviewer.getByText(feedback, { exact: true }).waitFor();
    await page.goto(`${baseURL}/drafts/${seeded.id}`);
    await page.getByText(feedback, { exact: true }).waitFor();
  },
);

// Explicit exception: a server test cannot establish what a service worker
// stores or serves offline. No push, install artwork or playback checks here.
workflow(
  "privacy / service worker never caches private content",
  async ({ id, page, context, draft, files }) => {
    const text = "Private cache canary: 83 violet chairs.";
    const seeded = await draft(text);
    const media = randomUUID();
    const bytes = await sharp({
      create: { width: 8, height: 6, channels: 3, background: "#704080" },
    })
      .png()
      .toBuffer();
    files.push(mediaPath(media));
    await mkdir(resolve(mediaPath(media), ".."), { recursive: true });
    await writeFile(mediaPath(media), bytes);
    await db.query(
      "INSERT INTO media(id,draft_id,owner_id,mime,bytes,filename) VALUES($1,$2,$3,'image/png',$4,'private.png')",
      [media, seeded.id, id, bytes.length],
    );
    seeded.content.posts[0].media = [media];
    await db.query("UPDATE drafts SET content=$1 WHERE id=$2", [
      seeded.content,
      seeded.id,
    ]);
    const shared = await publishDraft(seeded.id, id, 1);
    await page.goto(`${baseURL}/drafts/${seeded.id}`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.goto(`${baseURL}/r/${shared.token}`);
    await page.getByText(text, { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        async (url) => (await fetch(url)).status,
        `/media/${media}?key=${shared.token}`,
      ),
      200,
    );
    const cached = await page.evaluate(async () =>
      (
        await Promise.all(
          (await caches.keys()).map(async (key) =>
            (await (await caches.open(key)).keys()).map(
              (request) => new URL(request.url).pathname,
            ),
          ),
        )
      ).flat(),
    );
    assert.deepEqual(
      cached,
      ["/offline.html"],
      "private pages, capabilities and media must not enter Cache Storage",
    );
    await context.setOffline(true);
    await page.reload();
    await page
      .getByRole("heading", { name: "You’re offline.", exact: true })
      .waitFor();
    assert.equal(await page.getByText(text, { exact: true }).count(), 0);
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
      "offline writes must not pretend to be queued saves",
    );
    await context.setOffline(false);
    await page.reload();
    await page.getByText(text, { exact: true }).waitFor();
  },
  { serviceWorkers: "allow" },
);
