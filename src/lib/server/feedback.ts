import { error, type Cookies } from "@sveltejs/kit";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "./db";
import { token, hash } from "./auth";
import { notify } from "./notifications";
import { ownedDraft, sharedDraft, snapshotDraft } from "./drafts";
import { replyThread } from "../discussions";

export function guestCommenter(
  cookies: Cookies,
  secure: boolean,
  create = false,
) {
  let credential = cookies.get("lastpeek_commenter");
  if (!credential && create) {
    credential = token();
    cookies.set("lastpeek_commenter", credential, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
    });
  }
  return credential ? hash(credential) : undefined;
}

export const feedbackSchema = z.object({
  name: z.string().trim().max(80),
  body: z.string().trim().min(1).max(2000),
  revision: z.coerce.number().int().positive(),
  postId: z.union([z.uuid(), z.literal("")]).default(""),
  quote: z.string().max(25000).default(""),
  parentId: z.union([z.uuid(), z.literal("")]).default(""),
  mediaId: z.union([z.uuid(), z.literal("")]).default(""),
  mediaTime: z.coerce
    .number()
    .finite()
    .min(0)
    .max(86400)
    .nullable()
    .default(null),
});

export async function sendFeedback(
  reviewToken: string,
  userId: string | undefined,
  input: z.input<typeof feedbackSchema>,
  connectionId?: string,
  guestHash?: string,
) {
  const draft = await sharedDraft(reviewToken, userId);
  return writeComment(
    draft.id,
    userId,
    feedbackSchema.parse(input),
    {
      token: reviewToken,
    },
    connectionId,
    guestHash,
  );
}

export async function sendOwnerFeedback(
  id: string,
  userId: string,
  input: z.infer<typeof feedbackSchema>,
  version: number,
) {
  return writeComment(id, userId, input, { version });
}

export async function resolveConversation(
  draftId: string,
  userId: string,
  commentId: string,
  resolved: boolean,
) {
  return transaction(async (client) => {
    await ownedDraft(draftId, userId, client);
    await client.query("SELECT id FROM drafts WHERE id=$1 FOR UPDATE", [
      draftId,
    ]);
    const result = await client.query(
      `WITH RECURSIVE ancestors AS (
      SELECT id,parent_id FROM comments WHERE id=$2 AND draft_id=$3
      UNION ALL SELECT c.id,c.parent_id FROM comments c JOIN ancestors a ON c.id=a.parent_id
    ), conversation AS (
      SELECT id FROM ancestors WHERE parent_id IS NULL
      UNION ALL SELECT c.id FROM comments c JOIN conversation p ON c.parent_id=p.id
    ) UPDATE comments SET resolved=$1 WHERE id IN (SELECT id FROM conversation) RETURNING id,resolved`,
      [resolved, commentId, draftId],
    );
    if (!result.rowCount) error(404, "Feedback not found.");
    return { id: commentId, resolved };
  });
}

async function writeComment(
  draftId: string,
  userId: string | undefined,
  input: z.infer<typeof feedbackSchema>,
  access: { token: string } | { version: number },
  connectionId?: string,
  guestHash?: string,
) {
  const { body, postId, quote, mediaId, mediaTime } = input;
  return transaction(async (client) => {
    const ownerWrite = "version" in access;
    const active = await client.query(
      `SELECT * FROM drafts WHERE id=$1 AND ${ownerWrite ? "owner_id=$2" : "(share_token=$2 OR friend_token=$2)"} FOR UPDATE`,
      [draftId, ownerWrite ? userId : access.token],
    );
    const draft = active.rows[0];
    if (!draft) error(404, "This discussion is unavailable.");
    let revision = input.revision;
    if (ownerWrite) {
      await ownedDraft(draftId, userId!, client);
      if (draft.edit_version !== access.version)
        error(409, "The draft changed. Save your edits before commenting.");
      revision = await snapshotDraft(client, draft);
    }
    if (draft.friend_token && draft.owner_id !== userId) {
      const access = await client.query(
        `SELECT fr.draft_id FROM friend_reviews fr
        JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
        WHERE fr.draft_id=$1 AND fr.recipient_id=$2 FOR SHARE OF fr,f`,
        [draftId, userId ?? null],
      );
      if (!access.rowCount) error(404, "This review link is unavailable.");
    }
    const snapshot = (
      await client.query(
        "SELECT content FROM revisions WHERE draft_id=$1 AND number=$2",
        [draftId, revision],
      )
    ).rows[0];
    const post = snapshot?.content.posts.find(
      (p: { id: string }) => p.id === postId,
    );
    if (
      !snapshot ||
      (postId && !post) ||
      (quote && (!post || !post.text.includes(quote))) ||
      (mediaId && (!post || !post.media.includes(mediaId))) ||
      (mediaTime !== null && !mediaId)
    )
      error(400, "That post is not in this version. Refresh the page.");
    if (mediaTime !== null) {
      const file = await client.query(
        "SELECT mime FROM media WHERE id=$1 AND draft_id=$2",
        [mediaId, draftId],
      );
      if (!file.rows[0]?.mime.startsWith("video/"))
        error(400, "A timestamp must refer to a video.");
    }
    let parentId: string | null = null;
    let threadParentId: string | null = null;
    if (input.parentId) {
      const comments = (
        await client.query(
          "SELECT id,parent_id,thread_parent_id,deleted_at FROM comments WHERE draft_id=$1 ORDER BY created_at DESC,id DESC",
          [draftId],
        )
      ).rows;
      const parent = comments.find((comment) => comment.id === input.parentId);
      if (!parent) error(400, "That conversation is unavailable.");
      parentId = parent.id;
      threadParentId = replyThread(comments, parent);
      await client.query(
        `WITH RECURSIVE ancestors AS (
          SELECT id,parent_id FROM comments WHERE id=$1 AND draft_id=$2
          UNION ALL SELECT c.id,c.parent_id FROM comments c JOIN ancestors a ON c.id=a.parent_id WHERE c.draft_id=$2
        ), conversation AS (
          SELECT id FROM ancestors WHERE parent_id IS NULL
          UNION ALL SELECT c.id FROM comments c JOIN conversation p ON c.parent_id=p.id
        ) UPDATE comments SET resolved=false WHERE id IN (SELECT id FROM conversation)`,
        [parentId, draftId],
      );
    }
    const name = userId
      ? (await client.query("SELECT name FROM users WHERE id=$1", [userId]))
          .rows[0]?.name
      : input.name;
    if (!name) error(400, "Enter a name to send your feedback.");
    const agentName = connectionId
      ? (
          await client.query(
            "SELECT c.name FROM agent_connections a JOIN agent_clients c ON c.id=a.client_id WHERE a.id=$1 AND a.user_id=$2",
            [connectionId, userId],
          )
        ).rows[0]?.name
      : null;
    const id = crypto.randomUUID();
    await client.query(
      "INSERT INTO comments(id,draft_id,revision,post_id,name,body,quote,user_id,parent_id,media_id,media_time,agent_name,guest_hash,thread_parent_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        id,
        draftId,
        revision,
        postId || null,
        name,
        body,
        quote || null,
        userId ?? null,
        parentId,
        mediaId || null,
        mediaTime,
        agentName ?? null,
        userId ? null : (guestHash ?? null),
        threadParentId,
      ],
    );
    const participants = parentId
      ? (
          await client.query(
            `WITH RECURSIVE ancestors AS (
              SELECT id,parent_id FROM comments WHERE id=$2 AND draft_id=$1
              UNION ALL SELECT c.id,c.parent_id FROM comments c JOIN ancestors a ON c.id=a.parent_id
            ), conversation AS (
              SELECT c.id,c.user_id FROM comments c JOIN ancestors a ON c.id=a.id WHERE a.parent_id IS NULL
              UNION ALL SELECT c.id,c.user_id FROM comments c JOIN conversation p ON c.parent_id=p.id
            ) SELECT DISTINCT c.user_id FROM conversation c WHERE
       c.user_id IS NOT NULL AND ( $3::text IS NOT NULL OR EXISTS (
         SELECT 1 FROM friend_reviews fr JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
         WHERE fr.draft_id=$1 AND fr.recipient_id=c.user_id))`,
            [draftId, parentId, draft.share_token],
          )
        ).rows.map((row) => row.user_id as string)
      : [];
    for (const recipient of new Set([
      draft.owner_id as string,
      ...participants,
    ]))
      await notify(client, {
        userId: recipient,
        actorId: userId,
        kind: "feedback",
        draftId,
        commentId: id,
      });
    return { id, revision };
  });
}

export async function changeComment(
  id: string,
  userId: string | undefined,
  guestHash: string | undefined,
  input: { token?: string; version: number; body?: string; remove?: boolean },
) {
  if (!z.uuid().safeParse(id).success || !Number.isInteger(input.version))
    error(400, "Choose a message and its current version.");
  const parsed = z.string().trim().min(1).max(2000).safeParse(input.body);
  if (!input.remove && !parsed.success)
    error(400, "Write a message of up to 2,000 characters.");
  const body = parsed.success ? parsed.data : "";
  return transaction(async (client) => {
    await commentAccess(client, id, userId, input.token);
    const comment = (
      await client.query("SELECT * FROM comments WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!comment) error(404, "Message unavailable.");
    if (
      comment.deleted_at ||
      !(
        (userId && comment.user_id === userId) ||
        (!comment.user_id && guestHash && comment.guest_hash === guestHash)
      )
    )
      error(403, "You can only change your own messages.");
    if (comment.edit_version !== input.version)
      error(409, "This message changed. Refresh before trying again.");
    if (!input.remove) {
      await client.query(
        "UPDATE comments SET body=$1,edited_at=now(),edit_version=edit_version+1 WHERE id=$2",
        [body, id],
      );
    } else {
      const children = await client.query(
        "SELECT id FROM comments WHERE parent_id=$1 LIMIT 1",
        [id],
      );
      if (children.rowCount) {
        await client.query(
          "DELETE FROM comment_reactions WHERE comment_id=$1",
          [id],
        );
        await client.query(
          "UPDATE comments SET deleted_at=now(),edit_version=edit_version+1,name='',body='',user_id=NULL,guest_hash=NULL,agent_name=NULL,quote=NULL,suggestion=NULL,post_id=NULL,media_id=NULL,media_time=NULL WHERE id=$1",
          [id],
        );
      } else {
        await client.query("DELETE FROM comments WHERE id=$1", [id]);
        let parent = comment.parent_id;
        while (parent) {
          const pruned = await client.query(
            "DELETE FROM comments c WHERE id=$1 AND deleted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM comments child WHERE child.parent_id=c.id) RETURNING parent_id",
            [parent],
          );
          parent = pruned.rows[0]?.parent_id;
        }
      }
    }
    return { ok: true };
  });
}

async function commentAccess(
  client: PoolClient,
  id: string,
  userId?: string,
  reviewToken?: string,
) {
  const found = (
    await client.query("SELECT draft_id FROM comments WHERE id=$1", [id])
  ).rows[0];
  if (!found) error(404, "Message unavailable.");
  const draft = (
    await client.query("SELECT * FROM drafts WHERE id=$1 FOR UPDATE", [
      found.draft_id,
    ])
  ).rows[0];
  if (!draft) error(404, "Message unavailable.");
  if (draft.owner_id === userId) return;
  const shared = await sharedDraft(reviewToken ?? "", userId);
  if (shared.id !== draft.id) error(404, "Message unavailable.");
  if (reviewToken === draft.friend_token) {
    const grant = await client.query(
      `SELECT fr.draft_id FROM friend_reviews fr JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL WHERE fr.draft_id=$1 AND fr.recipient_id=$2 FOR SHARE OF fr,f`,
      [draft.id, userId ?? null],
    );
    if (!grant.rowCount) error(404, "Message unavailable.");
  }
}

export async function reactToComment(
  id: string,
  userId: string | undefined,
  guestHash: string | undefined,
  input: { token?: string; emoji: string; active: boolean },
) {
  if (
    !z.uuid().safeParse(id).success ||
    !["👍", "❤️", "🎉"].includes(input.emoji) ||
    typeof input.active !== "boolean"
  )
    error(400, "Choose a supported reaction.");
  if (!userId && !guestHash) error(403, "Open the review to react.");
  return transaction(async (client) => {
    await commentAccess(client, id, userId, input.token);
    const comment = (
      await client.query(
        "SELECT deleted_at FROM comments WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!comment || comment.deleted_at) error(404, "Message unavailable.");
    const identity = [
      id,
      userId ?? null,
      userId ? null : guestHash,
      input.emoji,
    ];
    const changed = input.active
      ? await client.query(
          "INSERT INTO comment_reactions(comment_id,user_id,guest_hash,emoji) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          identity,
        )
      : await client.query(
          "DELETE FROM comment_reactions WHERE comment_id=$1 AND ((user_id=$2) OR (user_id IS NULL AND guest_hash=$3)) AND emoji=$4",
          identity,
        );
    if (changed.rowCount)
      await client.query(
        "UPDATE comments SET reactions_version=reactions_version+1 WHERE id=$1",
        [id],
      );
    return { ok: true };
  });
}
