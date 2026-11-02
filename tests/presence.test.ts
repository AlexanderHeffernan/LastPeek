import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "playwright";
import sharp from "sharp";
import { rm } from "node:fs/promises";
import { db } from "../src/lib/server/db";
import { token, hash } from "../src/lib/server/auth";
import { avatarPath } from "../src/lib/server/avatars";
import { blankContent } from "../src/lib/contracts";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:4173";
const origin = new URL(baseURL).origin;
after(() => db.end());

test("activity requires accepted friendship even with review access; notification photos stay recipient-only", async () => {
  const [owner, friend, pending, commenter, stranger] = Array.from(
    { length: 5 },
    () => randomUUID(),
  );
  const session = token();
  const signedIn = await request.newContext({
    extraHTTPHeaders: { Cookie: `lastpeek_session=${session}`, Origin: origin },
  });
  const guest = await request.newContext({
    extraHTTPHeaders: { Origin: origin },
  });
  const draft = randomUUID(),
    reviewToken = token();
  let avatar: string | undefined;
  try {
    for (const id of [owner, friend, pending, commenter, stranger])
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,last_seen_at) VALUES($1,$2,'Person','unused','2026-10-30T12:34:56Z')",
        [id, `${id}@example.test`],
      );
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(session), owner],
    );
    await db.query(
      "INSERT INTO friendships(id,requester_id,recipient_id,accepted_at) VALUES($1,$2,$3,now()),($4,$2,$5,NULL)",
      [randomUUID(), owner, friend, randomUUID(), pending],
    );
    const content = blankContent("Person");
    await db.query(
      "INSERT INTO drafts(id,owner_id,content,share_token,shared_revision) VALUES($1,$2,$3,$4,1)",
      [draft, stranger, JSON.stringify(content), reviewToken],
    );
    await db.query(
      "INSERT INTO revisions(draft_id,number,content) VALUES($1,1,$2)",
      [draft, JSON.stringify(content)],
    );
    await db.query(
      "INSERT INTO comments(id,draft_id,revision,user_id,name,body) VALUES($1,$2,1,$3,'Person','Feedback')",
      [randomUUID(), draft, commenter],
    );
    const ids = [friend, pending, commenter, stranger];
    const activity = async (body: object) => {
      const response = await signedIn.post(`${baseURL}/api/presence`, {
        data: body,
      });
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).sort(
        (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id),
      );
    };
    assert.deepEqual(await activity({ ids }), [
      { id: friend, last_seen_at: "2026-10-30T12:34:00.000Z" },
    ]);
    assert.deepEqual(
      (await activity({ ids, token: reviewToken }))
        .map((row: { id: string }) => row.id)
        .sort(),
      [friend],
    );
    assert.equal(
      (
        await guest.post(`${baseURL}/api/presence`, {
          data: { ids, token: reviewToken },
          maxRedirects: 0,
        })
      ).status(),
      303,
    );
    assert.equal(
      (
        await signedIn.post(`${baseURL}/api/presence`, {
          headers: { Origin: "https://unrelated.example" },
          data: { ids },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await signedIn.post(`${baseURL}/api/presence`, {
          data: { ids: Array(101).fill(friend) },
        })
      ).status(),
      400,
    );
    await db.query("UPDATE drafts SET share_token=NULL WHERE id=$1", [draft]);
    assert.deepEqual(
      (await activity({ ids, token: reviewToken })).map(
        (row: { id: string }) => row.id,
      ),
      [friend],
    );
    await db.query("UPDATE drafts SET owner_id=$1 WHERE id=$2", [owner, draft]);
    assert.deepEqual(
      (await activity({ ids })).map((row: { id: string }) => row.id).sort(),
      [friend],
    );
    // Acceptance, in either direction, is the only grant. Pending reviewers remain private.
    await db.query(
      "INSERT INTO friendships(id,requester_id,recipient_id,accepted_at) VALUES($1,$2,$3,now())",
      [randomUUID(), commenter, owner],
    );
    assert.deepEqual(
      (await activity({ ids: [...ids, owner] }))
        .map((row: { id: string }) => row.id)
        .sort(),
      [friend, commenter].sort(),
    );
    await db.query(
      "DELETE FROM friendships WHERE requester_id=$1 OR recipient_id=$1",
      [owner],
    );
    assert.deepEqual(await activity({ ids }), []);

    // A historical notification may outlive a friendship, but cannot expose activity.
    const actorSession = token();
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(actorSession), stranger],
    );
    const actor = await request.newContext({
      extraHTTPHeaders: {
        Cookie: `lastpeek_session=${actorSession}`,
        Origin: origin,
      },
    });
    try {
      const photo = await sharp({
        create: { width: 40, height: 40, channels: 3, background: "#706080" },
      })
        .png()
        .toBuffer();
      const upload = await actor.post(`${baseURL}/api/profile/avatar`, {
        data: photo,
        headers: { "Content-Type": "image/png" },
      });
      assert.equal(upload.status(), 201, await upload.text());
      avatar = (await upload.json()).avatar;
    } finally {
      await actor.dispose();
    }
    const notification = randomUUID();
    await db.query(
      "INSERT INTO notifications(id,user_id,kind,actor_id) VALUES($1,$2,'friend_accepted',$3)",
      [notification, owner, stranger],
    );
    assert.deepEqual(await activity({ ids: [stranger] }), []);
    assert.equal(
      (await signedIn.get(`${baseURL}/avatars/${avatar}`)).status(),
      200,
    );
    assert.equal(
      (await guest.get(`${baseURL}/avatars/${avatar}`)).status(),
      404,
    );
    await db.query("DELETE FROM notifications WHERE id=$1", [notification]);
    assert.equal(
      (await signedIn.get(`${baseURL}/avatars/${avatar}`)).status(),
      404,
    );
  } finally {
    await signedIn.dispose();
    await guest.dispose();
    await db.query("DELETE FROM drafts WHERE id=$1", [draft]);
    if (avatar) await db.query("DELETE FROM avatars WHERE id=$1", [avatar]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, friend, pending, commenter, stranger],
    ]);
    if (avatar) await rm(avatarPath(avatar), { force: true });
  }
});
