import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";

let browser, server, origin;
before(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (!/^\/(tests\/composer.html|extension\/(preview|capture|content).js)$/.test(path)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/html");
    response.end(await readFile(new URL(`..${path}`, import.meta.url)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = process.env.TEST_BROWSER === "webkit"
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ channel: "chrome", headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function fixture() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, colorScheme: "dark" });
  await page.addInitScript(() => {
    window.browser = { runtime: {
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === "share-draft") { window.sharedHTML = message.html; return { ok: true }; }
        throw new Error("Unexpected request in fixture");
      }
    } };
  });
  await page.goto(`${origin}/tests/composer.html`);
  await page.locator("[data-x-draft-share]").waitFor();
  return page;
}

test("share button exports only its composer, preserving paragraphs, emoji and media per post", async () => {
  const page = await fixture();
  try {
    const original = await page.locator("#composer").innerText();
    await page.getByRole("button", { name: "Share draft", exact: true }).click();
    await page.getByRole("button", { name: "Share via Messages", exact: true }).waitFor();
    if (process.env.SCREENSHOTS) {
      await mkdir(".amp/in/artifacts", { recursive: true });
      await page.screenshot({ path: ".amp/in/artifacts/extension-review.png" });
    }
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save HTML", exact: true }).click();
    const download = await downloading;
    assert.match(download.suggestedFilename(), /^x-draft-.*\.html$/);
    const downloadedHTML = await readFile(await download.path(), "utf8");
    await page.getByRole("button", { name: "Share via Messages", exact: true }).click();
    await page.waitForFunction(() => window.sharedHTML);
    const html = await page.evaluate(() => window.sharedHTML);
    assert.equal(downloadedHTML, html);
    assert(!html.includes("Do not include this other draft"));
    const preview = await browser.newPage();
    await preview.setContent(html);
    assert.equal(await preview.locator("article").count(), 2);
    assert.equal(await preview.locator("article").nth(0).locator(".text").textContent(), "A first post with an attachment.\n\nA separate paragraph — with an emoji 👩🏽‍💻.");
    assert.equal(await preview.locator("article").nth(1).locator(".text").textContent(), "This is the follow-up reply, not part of the first post.");
    assert.equal(await preview.locator("article").nth(0).locator(".media img").count(), 1);
    assert.equal(await preview.locator("article").nth(1).locator(".media img").count(), 0);
    assert.equal(await preview.locator(".media img").evaluate(image => image.complete && image.naturalWidth), 640);
    assert.equal(await preview.locator("script, link, img[src^='http'], video[src^='http']").count(), 0);
    if (process.env.SCREENSHOTS) {
      await preview.setViewportSize({ width: 390, height: 844 });
      for (const colorScheme of ["light", "dark"]) {
        await preview.emulateMedia({ colorScheme });
        await preview.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await preview.screenshot({ path: `.amp/in/artifacts/export-${colorScheme}.png`, fullPage: true });
      }
      await page.getByRole("button", { name: "Close preview" }).click();
      await page.screenshot({ path: ".amp/in/artifacts/extension-button.png" });
    } else { await page.getByRole("button", { name: "Close preview" }).click(); }
    assert.equal(await page.locator("#composer").innerText(), original);
    await preview.close();
  } finally { await page.close(); }
});

test("video controls play in the review and the downloaded standalone HTML", async () => {
  const page = await fixture();
  let standalone;
  try {
    const videoData = `data:video/mp4;base64,${(await readFile(new URL("./fixtures/video.mp4", import.meta.url))).toString("base64")}`;
    await page.locator("#first-image").evaluate((image, src) => {
      const video = document.createElement("video");
      video.src = src;
      video.controls = true;
      image.replaceWith(video);
    }, videoData);
    await page.getByRole("button", { name: "Share draft", exact: true }).click();
    const video = page.frameLocator("iframe").locator("video");
    await video.waitFor();
    // Exercise WebKit's broken centre Play button; Chromium's native controls
    // use keyboard activation because their play button isn't in the centre.
    if (process.env.TEST_BROWSER === "webkit") await video.click();
    else await video.press("Space");
    let playback;
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(100);
      playback = await video.evaluate(v => ({ time: v.currentTime, paused: v.paused, width: v.videoWidth, error: v.error?.message }));
      if (playback.time > 0.1) break;
    }
    if (process.env.SCREENSHOTS) await video.screenshot({ path: ".amp/in/artifacts/video-preview.png" });
    assert.equal(playback.error, undefined);
    assert.equal(playback.width, 320);
    assert.equal(playback.paused, false);
    assert(playback.time > 0.1, "Clicking the native play control must advance the video");
    const isolation = await video.evaluate(v => {
      const script = document.createElement("script");
      script.textContent = "window.xDraftUnexpectedScript = true";
      v.after(script);
      script.remove();
      let canAccessParent = false;
      try { canAccessParent = !!parent.document.body; } catch {}
      return { scriptRan: window.xDraftUnexpectedScript === true, canAccessParent };
    });
    assert.deepEqual(isolation, { scriptRan: false, canAccessParent: false });
    await video.evaluate(v => v.pause());
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save HTML", exact: true }).click();
    const html = await readFile(await (await downloading).path(), "utf8");
    standalone = await browser.newPage();
    await standalone.setContent(html);
    assert.equal(await standalone.locator("script").count(), 0);
    assert.equal(await standalone.locator("video").getAttribute("src"), videoData);
    await standalone.locator("video").click();
    await standalone.waitForFunction(() => document.querySelector("video").currentTime > 0.1);
    assert.equal(await standalone.locator("video").evaluate(v => v.paused), false);
  } finally { await standalone?.close(); await page.close(); }
});

test("export escapes draft text and author metadata instead of interpreting HTML", async () => {
  const page = await fixture();
  try {
    const html = await page.evaluate(() => XDraftPreview.render({
      author: { name: '<img src=x onerror="alert(1)">', handle: "@name&more" },
      posts: [{ text: '<script>alert(1)</script> & "quoted"\nnext line', media: [] }],
      capturedAt: "2026-10-29T09:00:00Z"
    }));
    assert(!html.includes("<script>"));
    await page.setContent(html);
    assert.equal(await page.locator(".text").textContent(), '<script>alert(1)</script> & "quoted"\nnext line');
    assert.equal(await page.locator(".author strong").textContent(), '<img src=x onerror="alert(1)">');
    assert.equal(await page.locator("script, img").count(), 0);
  } finally { await page.close(); }
});

test("capture refuses changed drafts, unavailable media, and unsupported polls rather than exporting partial content", async () => {
  const page = await fixture();
  try {
    const results = await page.evaluate(async () => {
      const root = document.querySelector("#composer");
      const errors = [];
      try { await XDraftCapture.capture(root, async () => { throw new Error("Missing attachment"); }); } catch (error) { errors.push(error.message); }
      try { await XDraftCapture.capture(root, async () => {
        root.querySelector('[data-block="true"]').textContent = "Changed while loading";
        return { data: "data:image/png;base64,AA==", bytes: 1 };
      }); } catch (error) { errors.push(error.message); }
      const poll = document.createElement("div"); poll.dataset.testid = "pollOption"; root.append(poll);
      try { await XDraftCapture.capture(root, async () => { throw new Error("Should not read media"); }); } catch (error) { errors.push(error.message); }
      return errors;
    });
    assert.match(results[0], /Missing attachment/);
    assert.match(results[1], /draft changed/);
    assert.match(results[2], /polls aren’t supported/);
  } finally { await page.close(); }
});

test("only active media upload indicators block capture, not completed or hidden ones", async () => {
  const page = await fixture();
  try {
    const results = await page.evaluate(async () => {
      const root = document.querySelector("#composer");
      const progress = document.createElement("div");
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", "99");
      root.querySelector('[data-testid="attachments"]').append(progress);
      const results = [];
      for (const state of ["uploading", "complete", "hidden", "removed", "indeterminate"]) {
        progress.setAttribute("aria-valuenow", state === "complete" ? "100" : "99");
        progress.style.visibility = state === "hidden" ? "hidden" : "visible";
        progress.style.display = state === "removed" ? "none" : "block";
        if (state === "indeterminate") {
          progress.dataset.testid = "mediaUploadProgress";
          progress.removeAttribute("aria-valuenow");
          root.append(progress);
        }
        try {
          const draft = await XDraftCapture.capture(root, async src => ({ data: src, bytes: 1 }));
          results.push(draft.posts.map(post => post.media.length));
        } catch (error) { results.push(error.message); }
      }
      return results;
    });
    assert.match(results[0], /attachment is still uploading/);
    assert.deepEqual(results.slice(1, 4), [[1, 0], [1, 0], [1, 0]]);
    assert.match(results[4], /attachment is still uploading/);
  } finally { await page.close(); }
});

test("image-only drafts and media in follow-up posts retain their own attachment order", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const root = document.querySelector("#composer");
      root.querySelector('[contenteditable="true"]').textContent = "";
      const second = root.querySelectorAll(".body")[1];
      for (const alt of ["Second post image A", "Second post image B"]) {
        const image = root.querySelector("img").cloneNode(); image.alt = alt; second.append(image);
      }
      return XDraftCapture.capture(root, async src => ({ data: src, bytes: 1 }));
    });
    assert.equal(result.posts[0].text, "");
    assert.deepEqual(result.posts.map(post => post.media.map(media => media.alt)), [["A blue sample attachment"], ["Second post image A", "Second post image B"]]);
  } finally { await page.close(); }
});

test("single-post capture includes attachments outside the editor wrapper", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const root = document.querySelector("#composer");
      const editor = root.querySelector('[contenteditable="true"]');
      const image = root.querySelector("img");
      root.replaceChildren(editor, image);
      return XDraftCapture.capture(root, async src => ({ data: src, bytes: 1 }));
    });
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0].media.length, 1);
    assert.equal(result.posts[0].media[0].alt, "A blue sample attachment");
  } finally { await page.close(); }
});

test("native handoff errors keep the HTML download available and do not claim success", async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { browser.runtime.sendMessage = async () => { throw new Error("Native app unavailable"); }; });
    await page.getByRole("button", { name: "Share draft", exact: true }).click();
    await page.getByRole("button", { name: "Share via Messages", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#x-draft-dialog").shadowRoot.querySelector("#status").textContent.includes("Native app unavailable"));
    assert.match(await page.getByRole("status").textContent(), /Save HTML/);
    assert.equal(await page.getByRole("button", { name: "Save HTML", exact: true }).isEnabled(), true);
    if (process.env.SCREENSHOTS) await page.screenshot({ path: ".amp/in/artifacts/extension-error.png" });
  } finally { await page.close(); }
});

test("share stays visible when hidden scroll controls precede the media icons", async () => {
  const page = await fixture();
  try {
    await page.locator('[data-testid="toolBar"]').evaluate(toolbar => {
      toolbar.innerHTML = `<nav>
        <div hidden data-testid="ScrollSnap-prevButtonWrapper"><button disabled aria-label="Previous">←</button></div>
        <div data-testid="ScrollSnap-SwipeableList"><div class="tools" role="tablist" data-testid="ScrollSnap-List">
          <div role="presentation"><div><button aria-label="Add photos or video">▧</button><input hidden type="file" data-testid="fileInput"></div></div>
          <div role="presentation"><button aria-label="Add a GIF">GIF</button></div>
          <div role="presentation"><button aria-label="Add emoji">☺</button></div>
        </div></div>
      </nav><button data-testid="tweetButton">Post all</button>`;
    });
    const share = page.getByRole("button", { name: "Share draft", exact: true, includeHidden: true });
    await share.waitFor({ state: "attached" });
    assert.equal(await share.isVisible(), true);
    if (process.env.SCREENSHOTS) await page.screenshot({ path: ".amp/in/artifacts/extension-scroll-button.png" });
    const media = page.getByRole("button", { name: "Add photos or video", exact: true });
    const mediaBox = await media.boundingBox(), shareBox = await share.boundingBox();
    assert.deepEqual([shareBox.width, shareBox.height], [mediaBox.width, mediaBox.height]);
    await media.hover();
    await page.waitForTimeout(250);
    const nativeHover = await media.evaluate(button => getComputedStyle(button).backgroundColor);
    await share.hover();
    await page.waitForTimeout(250);
    assert.equal(await share.evaluate(button => getComputedStyle(button).backgroundColor), nativeHover);
    await share.click();
    await page.getByRole("button", { name: "Share via Messages", exact: true }).waitFor();
  } finally { await page.close(); }
});
