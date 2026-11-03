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

test("review viewers are draft-scoped, expire, leave independently and lose revoked access", async (t) => {
  const owner = randomUUID(),
    reviewer = randomUUID(),
    draft = randomUUID(),
    other = randomUUID();
  const share = token(),
    ownerSession = token(),
    reviewerSession = token();
  const ownerClient = await request.newContext({
    extraHTTPHeaders: {
      Origin: origin,
      Cookie: `lastpeek_session=${ownerSession}`,
    },
  });
  const reviewerClient = await request.newContext({
    extraHTTPHeaders: {
      Origin: origin,
      Cookie: `lastpeek_session=${reviewerSession}`,
    },
  });
  const guest = await request.newContext({
    extraHTTPHeaders: { Origin: origin },
  });
  const ownerConnection = randomUUID(),
    reviewerConnection = randomUUID(),
    secondConnection = randomUUID(),
    guestConnection = randomUUID();
  let avatar: string | undefined;
  t.after(async () => {
    await Promise.all([
      ownerClient.dispose(),
      reviewerClient.dispose(),
      guest.dispose(),
    ]);
    await db.query("DELETE FROM drafts WHERE id=ANY($1::uuid[])", [
      [draft, other],
    ]);
    await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
      [owner, reviewer],
    ]);
    if (avatar) await rm(avatarPath(avatar), { force: true });
  });
  for (const [id, name, session] of [
    [owner, "Writer", ownerSession],
    [reviewer, "Reader", reviewerSession],
  ]) {
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'unused')",
      [id, `${id}@example.test`, name],
    );
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [hash(session), id],
    );
  }
  const content = blankContent("Writer");
  await db.query(
    "INSERT INTO drafts(id,owner_id,content,share_token,shared_revision) VALUES($1,$2,$3,$4,1),($5,$2,$3,NULL,NULL)",
    [draft, owner, content, share, other],
  );
  await db.query(
    "INSERT INTO revisions(draft_id,number,content) VALUES($1,1,$2)",
    [draft, content],
  );
  const photo = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#705080" },
  })
    .png()
    .toBuffer();
  const upload = await reviewerClient.post(`${baseURL}/api/profile/avatar`, {
    data: photo,
    headers: { "Content-Type": "image/png" },
  });
  assert.equal(upload.status(), 201, await upload.text());
  avatar = (await upload.json()).avatar;
  const endpoint = `${baseURL}/api/review-presence`;
  const watch = async (client: typeof guest, data: object) => {
    const response = await client.post(endpoint, { data });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const ownerInput = { draftId: draft, connection: ownerConnection };
  const reviewInput = {
    token: share,
    connection: reviewerConnection,
    name: "Spoofed name",
  };
  assert.equal(
    (await guest.post(endpoint, { data: ownerInput })).status(),
    404,
  );
  assert.equal(
    (await reviewerClient.post(endpoint, { data: ownerInput })).status(),
    404,
  );
  assert.equal(
    (
      await guest.post(endpoint, {
        headers: { Origin: "https://elsewhere.example" },
        data: reviewInput,
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await guest.post(endpoint, { data: { ...reviewInput, userId: owner } })
    ).status(),
    400,
  );
  const initial = await watch(ownerClient, ownerInput);
  assert.deepEqual(initial.viewers, []);
  await watch(reviewerClient, reviewInput);
  await watch(reviewerClient, { ...reviewInput, connection: secondConnection });
  const visible = await watch(ownerClient, ownerInput);
  assert.deepEqual(visible.viewers, [
    { id: reviewer, name: "Reader", avatar_id: avatar, guest: false },
  ]);
  assert.equal(
    (await ownerClient.get(`${baseURL}/avatars/${avatar}`)).status(),
    200,
  );
  assert.equal((await guest.get(`${baseURL}/avatars/${avatar}`)).status(), 404);
  assert.equal(
    (await guest.get(`${baseURL}/avatars/${avatar}?key=${share}`)).status(),
    200,
  );
  assert.deepEqual(
    (await watch(ownerClient, { draftId: other, connection: ownerConnection }))
      .viewers,
    [],
  );
  assert.deepEqual(
    (await watch(reviewerClient, reviewInput)).viewers.map(
      (v: { id: string }) => v.id,
    ),
    [owner],
  );
  await watch(reviewerClient, { ...reviewInput, leave: true });
  assert.equal(
    (await watch(ownerClient, ownerInput)).viewers.length,
    1,
    "leaving one tab does not hide another tab",
  );
  await watch(guest, {
    token: share,
    connection: guestConnection,
    name: "Taylor",
  });
  assert.equal(
    (await watch(ownerClient, ownerInput)).viewers.find(
      (v: { guest: boolean }) => v.guest,
    )?.name,
    "Taylor",
  );
  await watch(guest, {
    token: share,
    connection: guestConnection,
    leave: true,
  });
  await db.query(
    "UPDATE review_presence SET seen_at=now()-interval '15 seconds' WHERE user_id=$1",
    [reviewer],
  );
  assert.equal((await watch(ownerClient, ownerInput)).viewers.length, 1);
  await db.query(
    "UPDATE review_presence SET seen_at=now()-interval '25 seconds' WHERE user_id=$1",
    [reviewer],
  );
  assert.deepEqual((await watch(ownerClient, ownerInput)).viewers, []);
  await watch(reviewerClient, reviewInput);
  const comment = randomUUID();
  await db.query(
    "INSERT INTO comments(id,draft_id,revision,name,body) VALUES($1,$2,1,'Taylor','More specific please')",
    [comment, draft],
  );
  const added = await watch(ownerClient, ownerInput);
  assert.notEqual(added.activity, initial.activity);
  await db.query("UPDATE comments SET resolved=true WHERE id=$1", [comment]);
  assert.notEqual(
    (await watch(ownerClient, ownerInput)).activity,
    added.activity,
  );
  await db.query("UPDATE drafts SET share_token=NULL WHERE id=$1", [draft]);
  assert.deepEqual((await watch(ownerClient, ownerInput)).viewers, []);
  assert.equal(
    (await ownerClient.get(`${baseURL}/avatars/${avatar}`)).status(),
    404,
  );
  assert.equal(
    (await reviewerClient.post(endpoint, { data: reviewInput })).status(),
    404,
  );
  const friendship = randomUUID(),
    privateToken = token();
  await db.query(
    "INSERT INTO friendships(id,requester_id,recipient_id,accepted_at) VALUES($1,$2,$3,now())",
    [friendship, owner, reviewer],
  );
  await db.query("UPDATE drafts SET friend_token=$1 WHERE id=$2", [
    privateToken,
    draft,
  ]);
  await db.query(
    "INSERT INTO friend_reviews(draft_id,recipient_id,friendship_id) VALUES($1,$2,$3)",
    [draft, reviewer, friendship],
  );
  const privateInput = { ...reviewInput, token: privateToken };
  await watch(reviewerClient, privateInput);
  assert.equal((await watch(ownerClient, ownerInput)).viewers.length, 1);
  assert.equal(
    (await guest.post(endpoint, { data: privateInput })).status(),
    404,
  );
  await db.query("DELETE FROM friend_reviews WHERE draft_id=$1", [draft]);
  assert.deepEqual((await watch(ownerClient, ownerInput)).viewers, []);
  assert.equal(
    (await reviewerClient.post(endpoint, { data: privateInput })).status(),
    404,
  );
});

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
