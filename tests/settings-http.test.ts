import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "playwright";
import { db } from "../src/lib/server/db";
import { hash, token } from "../src/lib/server/auth";
import { blankContent } from "../src/lib/contracts";

const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
after(() => db.end());

// A stale manually entered handle and a forged form must never override the
// connected account. Disconnect changes working identity, not old revisions.
test("settings identity follows connected X without rewriting shared history", async (t) => {
  const user = randomUUID(),
    draft = randomUUID(),
    session = token();
  const author = await request.newContext({
    extraHTTPHeaders: {
      Cookie: `lastpeek_session=${session}`,
      Origin: origin,
    },
  });
  t.after(async () => {
    await author.dispose();
    await db.query("DELETE FROM drafts WHERE owner_id=$1", [user]);
    await db.query("DELETE FROM users WHERE id=$1", [user]);
  });
  await db.query(
    "INSERT INTO users(id,email,name,handle,password_hash) VALUES($1,$2,'Author','stale_handle','unused')",
    [user, `${user}@example.test`],
  );
  await db.query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [hash(session), user],
  );
  const content = blankContent("Author", "forged_handle");
  content.posts[0].text = "A real working draft";
  await db.query("INSERT INTO drafts(id,owner_id,content) VALUES($1,$2,$3)", [
    draft,
    user,
    content,
  ]);
  const save = async (version: number, handle: string) => {
    const response = await author.post(`${origin}/api/drafts/${draft}`, {
      data: { action: "save", version, content },
    });
    assert.equal(response.status(), 200);
    const saved = (
      await db.query("SELECT content FROM drafts WHERE id=$1", [draft])
    ).rows[0].content;
    assert.equal(saved.author.handle, handle);
    return saved;
  };
  await save(1, "");
  await db.query(
    "INSERT INTO x_accounts(user_id,x_id,access_token,expires_at,scope,profile) VALUES($1,$2,'unused',now()+interval '1 day','users.read',$3)",
    [
      user,
      randomUUID(),
      { id: "123", username: "connected_x", name: "X name" },
    ],
  );
  const profile = await author.post(`${origin}/settings?/profile`, {
    form: { name: "New name", handle: "forged_handle" },
  });
  assert.equal(profile.status(), 200);
  const connected = await save(2, "connected_x");
  assert.equal(connected.author.name, "New name");
  const published = await author.post(`${origin}/api/drafts/${draft}`, {
    data: { action: "publish", version: 3 },
  });
  assert.equal(published.status(), 200);
  const before = (
    await db.query(
      "SELECT content FROM revisions WHERE draft_id=$1 AND number=1",
      [draft],
    )
  ).rows[0].content;
  assert.equal(before.author.handle, "connected_x");
  assert.equal(
    (
      await author.post(`${origin}/settings?/disconnectX`, { form: {} })
    ).status(),
    200,
  );
  await save(3, "");
  const after = (
    await db.query(
      "SELECT content FROM revisions WHERE draft_id=$1 AND number=1",
      [draft],
    )
  ).rows[0].content;
  assert.deepEqual(after, before);
});
