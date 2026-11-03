import { error } from "@sveltejs/kit";
import { z } from "zod";
import { transaction } from "./db";
import { notify } from "./notifications";
import { ownedDraft, sharedDraft, snapshotDraft } from "./drafts";

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

async function writeComment(
  draftId: string,
  userId: string | undefined,
  input: z.infer<typeof feedbackSchema>,
  access: { token: string } | { version: number },
  connectionId?: string,
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
    if (input.parentId) {
      const parent = (
        await client.query(
          "SELECT id,parent_id FROM comments WHERE id=$1 AND draft_id=$2",
          [input.parentId, draftId],
        )
      ).rows[0];
      if (!parent) error(400, "That conversation is unavailable.");
      parentId = parent.parent_id ?? parent.id;
      await client.query(
        "UPDATE comments SET resolved=false WHERE id=$1 AND draft_id=$2",
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
      "INSERT INTO comments(id,draft_id,revision,post_id,name,body,quote,user_id,parent_id,media_id,media_time,agent_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
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
      ],
    );
    const participants = parentId
      ? (
          await client.query(
            `SELECT DISTINCT c.user_id FROM comments c WHERE c.draft_id=$1 AND (c.id=$2 OR c.parent_id=$2)
       AND c.user_id IS NOT NULL AND ( $3::text IS NOT NULL OR EXISTS (
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
    if (userId)
      await client.query(
        `INSERT INTO discussion_reads(user_id,comment_id) VALUES($1,$2)
       ON CONFLICT(user_id,comment_id) DO UPDATE SET read_at=now()`,
        [userId, parentId ?? id],
      );
    return { id, revision };
  });
}
