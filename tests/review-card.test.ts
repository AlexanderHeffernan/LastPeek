import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { request } from "playwright";
import sharp from "sharp";
import { db } from "../src/lib/server/db";
import { token, hash } from "../src/lib/server/auth";
import { mediaPath } from "../src/lib/server/media";
import type { Content } from "../src/lib/contracts";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
const origin = new URL(baseURL).origin;
after(() => db.end());

// These are server-rendered PNGs, not browser rendering. Check the real HTTP
// upload/share/revocation boundary once, without launching either browser.
test(
  "review cards keep emoji inline and show MP4/WebM thumbnails",
  { timeout: 60000 },
  async () => {
    const session = token();
    // A fixture session keeps authentication out of a PNG contract test.
    const authenticated = await request.newContext({
      extraHTTPHeaders: { Cookie: `lastpeek_session=${session}` },
    });
    const guest = await request.newContext();
    const author = randomUUID(),
      draft = randomUUID();
    const files: string[] = [];
    try {
      await db.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Preview author','unused')",
        [author, `preview-${author}@example.test`],
      );
      await db.query(
        "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [hash(session), author],
      );
      const content: Content = {
        title: "",
        author: { name: "Preview author", handle: "preview" },
        posts: [
          { id: randomUUID(), text: "Hello world from LastPeek 👋", media: [] },
        ],
      };
      await db.query(
        "INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)",
        [draft, author, JSON.stringify(content)],
      );
      const save = async (body: object) => {
        const response = await authenticated.post(
          `${baseURL}/api/drafts/${draft}`,
          { data: body, headers: { Origin: origin } },
        );
        assert.equal(response.status(), 200, await response.text());
        return response.json();
      };
      const webm = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        "tests/fixtures/video.mp4",
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-c:v",
        "libvpx-vp9",
        "-f",
        "webm",
        "pipe:1",
      ]);
      assert.equal(webm.status, 0, webm.stderr.toString());
      let version = 1;
      for (const [mime, buffer] of [
        ["video/mp4", await readFile("tests/fixtures/video.mp4")],
        ["video/webm", webm.stdout],
      ] as const) {
        const upload = await authenticated.post(
          `${baseURL}/api/drafts/${draft}/media`,
          {
            headers: { Origin: origin },
            multipart: {
              file: { name: "preview-video", mimeType: mime, buffer },
            },
          },
        );
        assert.equal(upload.status(), 201, await upload.text());
        const media = await upload.json();
        files.push(media.id);
        content.posts[0].media = [media.id];
        version = (await save({ action: "save", version, content })).version;
        const shared = await save({ action: "publish", version });
        const url = `${baseURL}/r/${shared.token}/preview.png`;
        const response = await guest.get(url);
        assert.equal(response.status(), 200);
        const bytes = await response.body();
        // The fixture's centre is navy. Text-only fallback would leave this black.
        const pixel = await sharp(bytes)
          .extract({ left: 1000, top: 350, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer();
        assert.ok(
          pixel[2] > 70 && pixel[2] < 110 && pixel[0] < 40,
          `missing ${mime} thumbnail: ${[...pixel]}`,
        );
        // The yellow wave must be inline, not the font's native 128px bitmap.
        const body = await sharp(bytes)
          .extract({ left: 56, top: 162, width: 680, height: 380 })
          .removeAlpha()
          .raw()
          .toBuffer();
        const rows: number[] = [];
        for (let y = 0; y < 380; y++)
          for (let x = 0; x < 680; x++) {
            const i = (y * 680 + x) * 3;
            if (body[i] > 180 && body[i + 1] > 100 && body[i + 2] < 100)
              rows.push(y);
          }
        assert.ok(rows.length > 0, "the wave must render in color");
        assert.ok(
          Math.max(...rows) - Math.min(...rows) < 52,
          "emoji must scale with the 38px text",
        );
        content.posts[0].text = "";
        version = (await save({ action: "save", version, content })).version;
        const videoOnly = await guest.get(`${url}?v=1`);
        assert.equal(videoOnly.status(), 200);
        const widePixel = await sharp(await videoOnly.body())
          .extract({ left: 700, top: 350, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer();
        assert.ok(
          widePixel[2] > 70 && widePixel[0] < 40,
          "video-only cards use the wide media layout, even with an old revision hint",
        );
        await writeFile(mediaPath(media.id), "damaged video");
        const fallback = await guest.get(url);
        assert.equal(
          fallback.status(),
          200,
          "a broken video must not break the card",
        );
        assert.notDeepEqual(await fallback.body(), await videoOnly.body());
        await save({ action: "revoke" });
        assert.equal((await guest.get(url)).status(), 404);
        assert.equal((await authenticated.get(url)).status(), 404);
        content.posts[0].text = "Hello world from LastPeek 👋";
      }
    } finally {
      await authenticated.dispose();
      await guest.dispose();
      await db.query("DELETE FROM drafts WHERE id=$1", [draft]);
      await db.query("DELETE FROM users WHERE id=$1", [author]);
      for (const id of files) await rm(mediaPath(id), { force: true });
    }
  },
);
