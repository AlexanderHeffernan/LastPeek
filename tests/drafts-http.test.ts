import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { request } from "playwright";
import sharp from "sharp";
import { db } from "../src/lib/server/db";
import { hash, token } from "../src/lib/server/auth";
import { mediaPath } from "../src/lib/server/media";
import { blankContent } from "../src/lib/contracts";

const origin = process.env.TEST_BASE_URL!;
after(() => db.end());

// These used to run inside browser journeys. Exercise the real HTTP boundary
// once: forged ownership, lost concurrent edits and leaked/revoked media.
test("draft HTTP protects ownership, origin, concurrent edits and private media", async (t) => {
  const owner = randomUUID(),
    other = randomUUID(),
    draft = randomUUID(),
    media = randomUUID();
  const session = token(),
    foreign = token();
  const client = await request.newContext({
    extraHTTPHeaders: { Cookie: `lastpeek_session=${session}`, Origin: origin },
  });
  t.after(async () => {
    await client.dispose();
    await db.query("DELETE FROM drafts WHERE id=$1", [draft]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, other],
    ]);
    await rm(mediaPath(media), { force: true });
  });
  for (const [user, value] of [
    [owner, session],
    [other, foreign],
  ]) {
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Author','unused')",
      [user, `${user}@example.test`],
    );
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(value), user],
    );
  }
  const content = blankContent("Author");
  content.posts[0].text = "Original private draft";
  content.posts[0].media = [media];
  await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
    draft,
    owner,
    content,
  ]);
  const bytes = await sharp({
    create: { width: 9, height: 7, channels: 3, background: "#704080" },
  })
    .png()
    .toBuffer();
  await mkdir(dirname(mediaPath(media)), { recursive: true });
  await writeFile(mediaPath(media), bytes);
  await db.query(
    "INSERT INTO media(id,draft_id,owner_id,mime,bytes,filename) VALUES($1,$2,$3,'image/png',$4,'private.png')",
    [media, draft, owner, bytes.length],
  );
  const endpoint = `${origin}/api/drafts/${draft}`;
  const save = { action: "save", version: 1, content };
  for (const invalid of ["", "null", "https://evil.example"]) {
    assert.equal(
      (
        await client.post(endpoint, {
          headers: { Origin: invalid },
          data: save,
        })
      ).status(),
      403,
    );
  }
  assert.equal(
    (
      await client.post(endpoint, {
        headers: { Cookie: `lastpeek_session=${foreign}` },
        data: save,
      })
    ).status(),
    404,
  );
  assert.equal(
    (
      await client.get(`${origin}/drafts/${draft}`, {
        headers: { Cookie: `lastpeek_session=${foreign}` },
      })
    ).status(),
    404,
  );
  const edits = ["The winner has 17 chairs.", "The other edit has 12 tables."];
  const results = await Promise.all(
    edits.map((text) =>
      client.post(endpoint, {
        data: {
          ...save,
          content: { ...content, posts: [{ ...content.posts[0], text }] },
        },
      }),
    ),
  );
  assert.deepEqual(
    results.map((response) => response.status()).sort(),
    [200, 409],
  );
  const winner =
    edits[results.findIndex((response) => response.status() === 200)];
  const stored = (
    await db.query("SELECT content,edit_version FROM drafts WHERE id=$1", [
      draft,
    ])
  ).rows[0];
  assert.equal(stored.edit_version, 2);
  assert.equal(stored.content.posts[0].text, winner);
  assert.equal(
    (
      await client.post(endpoint, { data: { action: "publish", version: 1 } })
    ).status(),
    409,
  );
  const published = await client.post(endpoint, {
    data: { action: "publish", version: 2 },
  });
  assert.equal(published.status(), 200);
  const shared = await published.json();
  const url = `${origin}/media/${media}`;
  assert.equal(
    (await client.get(url, { headers: { Cookie: "" } })).status(),
    404,
  );
  assert.equal(
    (
      await client.get(url, {
        headers: { Cookie: `lastpeek_session=${foreign}` },
      })
    ).status(),
    404,
  );
  const attachment = await client.get(`${url}?key=${shared.token}`, {
    headers: { Cookie: "" },
  });
  assert.equal(attachment.status(), 200);
  assert.match(attachment.headers()["cache-control"], /private.*no-store/);
  assert.deepEqual(await attachment.body(), bytes);
  const range = await client.get(`${url}?key=${shared.token}`, {
    headers: { Cookie: "", Range: "bytes=3-11" },
  });
  assert.equal(range.status(), 206);
  assert.equal(range.headers()["content-range"], `bytes 3-11/${bytes.length}`);
  assert.deepEqual(await range.body(), bytes.subarray(3, 12));
  assert.equal(
    (
      await client.get(url, { headers: { Range: `bytes=${bytes.length}-` } })
    ).status(),
    416,
  );
  assert.equal(
    (await client.post(endpoint, { data: { action: "revoke" } })).status(),
    200,
  );
  assert.equal(
    (
      await client.get(`${url}?key=${shared.token}`, {
        headers: { Cookie: "" },
      })
    ).status(),
    404,
  );
  assert.equal(
    (
      await client.get(`${origin}/r/${shared.token}`, {
        headers: { Cookie: "" },
      })
    ).status(),
    404,
  );
  assert.equal(
    (await client.get(url)).status(),
    200,
    "revocation does not lock out the owner",
  );
});
