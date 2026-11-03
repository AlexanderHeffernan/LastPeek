import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

test("discussions preserve nested anchors, session ownership and revoked access", async (t) => {
  const original = process.env.DATABASE_URL!;
  const schema = `discussions_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: original });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(original);
  connection.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = connection.href;
  const { db } = await import("../src/lib/server/db");
  const {
    sendOwnerFeedback,
    sendFeedback,
    feedbackSchema,
    changeComment,
    resolveConversation,
  } = await import("../src/lib/server/feedback");
  const { createDraft, publishDraft, saveDraft, draftComments } =
    await import("../src/lib/server/drafts");
  const { discussionDestination } =
    await import("../src/lib/server/discussions");
  const { blankContent } = await import("../src/lib/contracts");
  t.after(async () => {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.env.DATABASE_URL = original;
  });
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.query(await readFile(`migrations/${name}`, "utf8"));
  const [owner, reviewer, outsider, draft, other, video, image] = Array.from(
    { length: 7 },
    () => randomUUID(),
  );
  for (const id of [owner, reviewer, outsider])
    await db.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,'unused')",
      [id, `${id}@example.test`, id === owner ? "Writer" : "Reader"],
    );
  const content = blankContent("Writer");
  content.posts[0].text = "A focused opening, followed by a specific question.";
  await createDraft(draft, owner, content);
  await createDraft(other, outsider, blankContent("Other"));
  await db.query(
    "INSERT INTO media(id,draft_id,owner_id,mime,bytes,filename) VALUES($1,$2,$3,'video/mp4',10,'clip.mp4'),($4,$2,$3,'image/png',10,'image.png')",
    [video, draft, owner, image],
  );
  content.posts[0].media = [video];
  await saveDraft(draft, owner, content, 1);
  const input = (body: string, extra: object = {}) =>
    feedbackSchema.parse({ name: "", body, revision: 1, ...extra });
  const question = await sendOwnerFeedback(
    draft,
    owner,
    input("Is the opening specific enough?"),
    2,
  );
  assert.equal(
    (await draftComments(draft)).length,
    1,
    "author can ask before sharing",
  );
  await assert.rejects(
    sendOwnerFeedback(draft, outsider, input("Intrusion"), 2),
    { status: 404 },
  );
  await assert.rejects(sendOwnerFeedback(draft, owner, input("Stale"), 1), {
    status: 409,
  });
  const shared = await publishDraft(draft, owner, 2);
  await db.query("UPDATE comments SET resolved=true WHERE id=$1", [
    question.id,
  ]);
  const reply = await sendFeedback(
    shared.token,
    reviewer,
    input("Yes, especially the specific question.", {
      parentId: question.id,
      postId: content.posts[0].id,
      quote: "specific question",
    }),
  );
  const follow = await sendOwnerFeedback(
    draft,
    owner,
    input("Thanks. What about this frame?", {
      parentId: reply.id,
      postId: content.posts[0].id,
      mediaId: video,
      mediaTime: 3.25,
    }),
    2,
  );
  const comments = await draftComments(draft);
  assert.equal(
    comments.find((c) => c.id === question.id)?.resolved,
    false,
    "a new reply reopens its resolved conversation",
  );
  assert.equal(comments.find((c) => c.id === follow.id)?.parent_id, reply.id);
  assert.equal(comments.find((c) => c.id === follow.id)?.media_time, 3.25);
  assert.ok(
    (await discussionDestination(reviewer, follow.id)).href.startsWith(
      `/r/${shared.token}`,
    ),
  );
  await assert.rejects(discussionDestination(outsider, question.id), {
    status: 404,
  });
  await assert.rejects(
    sendOwnerFeedback(
      other,
      outsider,
      input("Wrong draft", { parentId: question.id }),
      1,
    ),
    { status: 400 },
  );
  await assert.rejects(
    sendFeedback(
      shared.token,
      reviewer,
      input("Not attached", { postId: content.posts[0].id, mediaId: image }),
    ),
    { status: 400 },
  );
  content.posts[0].text = "A new opening without the old phrase.";
  await saveDraft(draft, owner, content, 2);
  assert.equal(
    (await draftComments(draft)).find((c) => c.id === reply.id)?.original_post
      ?.text,
    "A focused opening, followed by a specific question.",
  );
  await sendFeedback(
    shared.token,
    reviewer,
    input("Late but still anchored", {
      postId: content.posts[0].id,
      quote: "specific question",
    }),
  );
  const guestHash = "test-session-hash";
  const guest = await sendFeedback(
    shared.token,
    undefined,
    input("Guest question", { name: "Jules" }),
    undefined,
    guestHash,
  );
  const child = await sendFeedback(
    shared.token,
    reviewer,
    input("First answer", { parentId: guest.id }),
  );
  const grandchild = await sendFeedback(
    shared.token,
    undefined,
    input("More detail", { name: "Jules", parentId: child.id }),
    undefined,
    guestHash,
  );
  assert.equal(
    (await discussionDestination(reviewer, grandchild.id)).root,
    guest.id,
  );
  assert.equal(
    (await draftComments(draft, undefined, guestHash)).find(
      (c) => c.id === guest.id,
    )?.can_manage,
    true,
  );
  assert.equal(
    (await draftComments(draft, undefined, "different-session")).find(
      (c) => c.id === guest.id,
    )?.can_manage,
    false,
  );
  await assert.rejects(
    changeComment(guest.id, undefined, "different-session", {
      token: shared.token,
      version: 1,
      body: "Impersonated",
    }),
    { status: 403 },
  );
  await assert.rejects(
    changeComment(child.id, owner, undefined, { version: 1, remove: true }),
    { status: 403 },
    "authors cannot delete somebody else's feedback",
  );
  await changeComment(guest.id, undefined, guestHash, {
    token: shared.token,
    version: 1,
    body: "Guest clarification",
  });
  await assert.rejects(
    changeComment(guest.id, undefined, guestHash, {
      token: shared.token,
      version: 1,
      body: "Stale edit",
    }),
    { status: 409 },
  );
  await resolveConversation(draft, owner, grandchild.id, true);
  assert.equal(
    (await draftComments(draft))
      .filter((c) =>
        [guest.id, child.id, grandchild.id].some((id) => id === c.id),
      )
      .every((c) => c.resolved),
    true,
  );
  const sibling = await sendFeedback(
    shared.token,
    reviewer,
    input("One more question", { parentId: child.id }),
  );
  assert.equal(
    (await draftComments(draft))
      .filter((c) =>
        [guest.id, child.id, grandchild.id, sibling.id].some(
          (id) => id === c.id,
        ),
      )
      .every((c) => !c.resolved),
    true,
    "a nested reply reopens the whole conversation",
  );
  await changeComment(guest.id, undefined, guestHash, {
    token: shared.token,
    version: 2,
    remove: true,
  });
  const tombstone = (await draftComments(draft, undefined, guestHash)).find(
    (c) => c.id === guest.id,
  )!;
  assert.ok(tombstone.deleted_at);
  assert.equal(tombstone.name, "");
  assert.equal(tombstone.body, "");
  assert.equal(tombstone.can_manage, false);
  await changeComment(grandchild.id, undefined, guestHash, {
    token: shared.token,
    version: 1,
    remove: true,
  });
  await changeComment(sibling.id, reviewer, undefined, {
    token: shared.token,
    version: 1,
    remove: true,
  });
  await changeComment(child.id, reviewer, undefined, {
    token: shared.token,
    version: 1,
    remove: true,
  });
  assert.equal(
    (await draftComments(draft)).some((c) => c.id === guest.id),
    false,
    "removing the last descendant prunes its empty tombstone",
  );
  await db.query("UPDATE drafts SET share_token=NULL WHERE id=$1", [draft]);
  await assert.rejects(discussionDestination(reviewer, follow.id), {
    status: 404,
  });
  await assert.rejects(
    changeComment(reply.id, reviewer, undefined, {
      token: shared.token,
      version: 1,
      body: "Edit through revoked access",
    }),
    { status: 404 },
  );
  await assert.rejects(sendFeedback(shared.token, reviewer, input("Revoked")), {
    status: 404,
  });
  assert.equal(
    (await draftComments(draft)).length,
    4,
    "revocation preserves author discussion history",
  );
  const existingReply = blankContent("Other");
  existingReply.source = {
    kind: "reply",
    url: "https://x.com/example/status/123456",
  };
  await db.query("UPDATE drafts SET content=$1,posted_at=now() WHERE id=$2", [
    JSON.stringify(existingReply),
    other,
  ]);
  existingReply.posts[0].text = "Editing a published reply after a downgrade.";
  await saveDraft(other, outsider, existingReply, 1);
  assert.equal(
    (
      await db.query(
        "SELECT content->'source'->>'kind' AS kind FROM drafts WHERE id=$1",
        [other],
      )
    ).rows[0].kind,
    "reply",
  );
  delete existingReply.source;
  await assert.rejects(
    saveDraft(other, outsider, existingReply, 2),
    { status: 409 },
    "published drafts cannot switch their source, but unchanged relationships remain editable",
  );
});
