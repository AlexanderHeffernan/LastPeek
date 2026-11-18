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

test("LinkedIn drafts preserve review history and never use X matching without requiring a grant", async (t) => {
  const owner = randomUUID(),
    session = token(),
    draft = randomUUID();
  const client = await request.newContext({
    extraHTTPHeaders: { Cookie: `lastpeek_session=${session}`, Origin: origin },
  });
  t.after(async () => {
    await client.dispose();
    await db.query("DELETE FROM drafts WHERE owner_id=$1", [owner]);
    await db.query("DELETE FROM users WHERE id=$1", [owner]);
  });
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'LinkedIn author','unused')",
    [owner, `${owner}@example.test`],
  );
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [hash(session), owner],
  );
  const content = {
    ...blankContent("LinkedIn author"),
    platform: "linkedin" as const,
  };
  content.posts[0].text = "A detailed LinkedIn update. " + "a".repeat(310);
  const endpoint = `${origin}/api/drafts/${draft}`;
  const action = (data: object) => client.post(endpoint, { data });
  assert.equal(
    (
      await client.post(`${origin}/?/create`, {
        headers: { Accept: "text/html" },
        form: { platform: "linkedin" },
        maxRedirects: 0,
      })
    ).status(),
    303,
  );
  assert.equal(
    (await action({ action: "save", content, version: 0 })).status(),
    200,
  );
  assert.equal(
    (
      await action({
        action: "save",
        content: { ...content, platform: "x" },
        version: 1,
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await action({
        action: "save",
        content: {
          ...content,
          posts: [...content.posts, { ...content.posts[0], id: randomUUID() }],
        },
        version: 1,
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await client.post(`${endpoint}/post-to-x`, {
        data: { version: 1, xId: "123" },
      })
    ).status(),
    400,
  );
  const shared = await (await action({ action: "publish", version: 1 })).json();
  content.posts[0].text += "\n\nA new ending.";
  assert.equal(
    (await action({ action: "save", content, version: 1 })).status(),
    200,
  );
  const revisions = (
    await db.query(
      "SELECT content FROM revisions WHERE draft_id=$1 ORDER BY number",
      [draft],
    )
  ).rows;
  assert.equal(revisions.length, 2);
  assert.ok(!revisions[0].content.posts[0].text.includes("new ending"));
  assert.equal(revisions[1].content.platform, "linkedin");
  assert.equal(
    (
      await action({ action: "complete", completed: true, version: 1 })
    ).status(),
    409,
  );
  assert.equal(
    (
      await action({ action: "complete", completed: true, version: 2 })
    ).status(),
    200,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM posted_x_links WHERE draft_id=$1", [draft]))
      .rowCount,
    0,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM api_usage WHERE user_id=$1", [owner]))
      .rowCount,
    0,
  );
  for (const url of [
    "https://x.com/a/status/123",
    "https://www.linkedin.com.evil.test/posts/a-activity-123-abcd",
  ]) {
    assert.equal(
      (await action({ action: "posted-link", choice: "url", url })).status(),
      400,
    );
  }
  const url = "https://www.linkedin.com/feed/update/urn:li:activity:123456789/";
  assert.equal(
    (
      await action({
        action: "posted-link",
        choice: "url",
        url: `${url}?utm_source=copy`,
      })
    ).status(),
    200,
  );
  assert.equal(
    (
      await db.query(
        "SELECT url FROM posted_linkedin_links WHERE draft_id=$1",
        [draft],
      )
    ).rows[0].url,
    url,
  );
  assert.equal(
    (
      await client.get(`${origin}/r/${shared.token}`, {
        headers: { Cookie: "" },
      })
    ).status(),
    200,
  );
  // Simultaneous clicks must create one independent version, not orphan drafts.
  const versions = await Promise.all([
    action({ action: "create-version" }),
    action({ action: "create-version" }),
  ]);
  assert.deepEqual(versions.map((r) => r.status()).sort(), [200, 409]);
  const pairedId = (await versions.find((r) => r.status() === 200)!.json()).id;
  const paired = (
    await db.query("SELECT * FROM drafts WHERE id=$1", [pairedId])
  ).rows[0];
  assert.equal(paired.content.platform ?? "x", "x");
  assert.equal(paired.content.posts[0].text, "");
  assert.deepEqual(paired.content.posts[0].media, []);
  assert.equal(paired.share_token, null);
  assert.equal(paired.posted_at, null);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM drafts WHERE owner_id=$1",
        [owner],
      )
    ).rows[0].n,
    3,
  );
  const otherContent = blankContent("LinkedIn author");
  otherContent.posts[0].text = "A much shorter X version.";
  assert.equal(
    (
      await client.post(`${origin}/api/drafts/${pairedId}`, {
        data: { action: "save", content: otherContent, version: 1 },
      })
    ).status(),
    200,
  );
  assert.equal(
    (await db.query("SELECT content FROM drafts WHERE id=$1", [draft])).rows[0]
      .content.posts[0].text,
    content.posts[0].text,
  );
  const pairShare = await action({ action: "publish", version: 2 });
  assert.equal(pairShare.status(), 200);
  const linked = (
    await db.query("SELECT share_token FROM drafts WHERE id=$1", [pairedId])
  ).rows[0].share_token;
  const review = await client.get(`${origin}/r/${shared.token}`, {
    headers: { Cookie: "" },
  });
  assert.equal(review.status(), 200);
  assert.ok((await review.text()).includes(`/r/${linked}`));
  assert.equal(
    (
      await client.get(`${origin}/r/${linked}`, { headers: { Cookie: "" } })
    ).status(),
    200,
  );
  // A stale completion must not mark either version. One valid action marks both.
  await db.query("UPDATE drafts SET posted_at=NULL WHERE id=ANY($1::uuid[])", [
    [draft, pairedId],
  ]);
  assert.equal(
    (
      await action({ action: "complete", completed: true, version: 1 })
    ).status(),
    409,
  );
  assert.equal(
    (
      await db.query(
        "SELECT id FROM drafts WHERE id=ANY($1::uuid[]) AND posted_at IS NOT NULL",
        [[draft, pairedId]],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await action({ action: "complete", completed: true, version: 2 })
    ).status(),
    200,
  );
  assert.equal(
    (
      await db.query(
        "SELECT id FROM drafts WHERE id=ANY($1::uuid[]) AND posted_at IS NOT NULL",
        [[draft, pairedId]],
      )
    ).rowCount,
    2,
  );
  // Revocation from either version closes both bearer URLs.
  assert.equal(
    (
      await client.post(`${origin}/api/drafts/${pairedId}`, {
        data: { action: "revoke" },
      })
    ).status(),
    200,
  );
  for (const key of [shared.token, linked])
    assert.equal(
      (
        await client.get(`${origin}/r/${key}`, { headers: { Cookie: "" } })
      ).status(),
      404,
    );
  const reshared = await (
    await action({ action: "publish", version: 2 })
  ).json();
  assert.equal(
    (
      await client.post(`${origin}/api/drafts/${pairedId}`, {
        data: { action: "create-version" },
      })
    ).status(),
    409,
  );
  assert.equal(
    (await client.get(`${origin}/drafts/${pairedId}`)).status(),
    200,
  );
  assert.equal(
    (
      await client.post(`${origin}/api/drafts/${pairedId}`, {
        data: { action: "delete" },
      })
    ).status(),
    200,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM drafts WHERE id=$1", [draft])).rowCount,
    1,
  );
  assert.equal((await client.get(`${origin}/drafts/${draft}`)).status(), 200);
  assert.equal(
    (
      await action({ action: "complete", completed: true, version: 2 })
    ).status(),
    200,
  );
  assert.equal(
    (
      await client.get(`${origin}/r/${reshared.token}`, {
        headers: { Cookie: "" },
      })
    ).status(),
    200,
  );
});

test("paired friend reviews preserve audience privacy and revoke both versions", async (t) => {
  const owner = randomUUID(),
    friend = randomUUID(),
    stranger = randomUUID();
  const ids = [owner, friend, stranger];
  const sessions = ids.map(() => token());
  const clients = await Promise.all(
    sessions.map((session) =>
      request.newContext({
        extraHTTPHeaders: {
          Cookie: `lastpeek_session=${session}`,
          Origin: origin,
        },
      }),
    ),
  );
  t.after(async () => {
    await Promise.all(clients.map((client) => client.dispose()));
    await db.query("DELETE FROM drafts WHERE owner_id=ANY($1::uuid[])", [ids]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  });
  for (const [index, id] of ids.entries()) {
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Pair author','unused')",
      [id, `${id}@example.test`],
    );
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(sessions[index]), id],
    );
  }
  await db.query(
    "INSERT INTO friendships(id,requester_id,recipient_id,accepted_at) VALUES($1,$2,$3,now())",
    [randomUUID(), owner, friend],
  );
  const x = randomUUID();
  const content = blankContent("Pair author");
  content.posts[0].text = "Short X version";
  const action = (id: string, data: object) =>
    clients[0].post(`${origin}/api/drafts/${id}`, { data });
  assert.equal(
    (await action(x, { action: "save", content, version: 0 })).status(),
    200,
  );
  const li = (await (await action(x, { action: "create-version" })).json()).id;
  const linkedin = { ...blankContent("Pair author"), platform: "linkedin" };
  linkedin.posts[0].text = "Longer LinkedIn version for colleagues";
  assert.equal(
    (
      await action(li, { action: "save", content: linkedin, version: 1 })
    ).status(),
    200,
  );
  const publicLink = await (
    await action(x, { action: "publish", version: 1 })
  ).json();
  const invite = await (
    await action(li, { action: "friend", version: 2, userId: friend })
  ).json();
  const pair = (
    await db.query(
      "SELECT id,share_token,friend_token FROM drafts WHERE id=ANY($1::uuid[])",
      [[x, li]],
    )
  ).rows;
  const xRow = pair.find((row) => row.id === x)!;
  const liRow = pair.find((row) => row.id === li)!;
  assert.equal(
    (await clients[2].get(`${origin}/r/${invite.token}`)).status(),
    404,
  );
  const privatePage = await clients[1].get(`${origin}/r/${invite.token}`);
  assert.equal(privatePage.status(), 200);
  const html = await privatePage.text();
  assert.ok(html.includes(`/r/${xRow.friend_token}`));
  assert.ok(!html.includes(xRow.share_token));
  assert.ok(!html.includes(liRow.share_token));
  // Removing just one legacy invitation must not expose its counterpart through the other.
  await db.query(
    "DELETE FROM friend_reviews WHERE draft_id=$1 AND recipient_id=$2",
    [x, friend],
  );
  assert.ok(
    !(
      await (await clients[1].get(`${origin}/r/${invite.token}`)).text()
    ).includes(`/r/${xRow.friend_token}`),
  );
  assert.equal(
    (
      await action(li, { action: "friend", version: 2, userId: friend })
    ).status(),
    200,
  );
  assert.equal((await action(x, { action: "revoke" })).status(), 200);
  for (const row of pair) {
    assert.equal(
      (await clients[1].get(`${origin}/r/${row.friend_token}`)).status(),
      200,
    );
    assert.equal(
      (await clients[1].get(`${origin}/r/${row.share_token}`)).status(),
      404,
    );
  }
  assert.equal(
    (await action(x, { action: "unshare-friend", userId: friend })).status(),
    200,
  );
  for (const row of pair)
    assert.equal(
      (await clients[1].get(`${origin}/r/${row.friend_token}`)).status(),
      404,
    );
  assert.equal(
    (await clients[0].get(`${origin}/r/${publicLink.token}`)).status(),
    404,
  );
  // Invoking completion from X also completes LinkedIn, without changing either text.
  assert.equal(
    (
      await action(x, { action: "complete", completed: true, version: 1 })
    ).status(),
    200,
  );
  assert.equal(
    (
      await db.query(
        "SELECT id FROM drafts WHERE id=ANY($1::uuid[]) AND posted_at IS NOT NULL",
        [[x, li]],
      )
    ).rowCount,
    2,
  );
});

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
