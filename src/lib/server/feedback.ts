import { error } from "@sveltejs/kit";
import { z } from "zod";
import { transaction } from "./db";
import { notify } from "./notifications";
import { sharedDraft } from "./drafts";

export const feedbackSchema = z.object({
  name: z.string().trim().max(80),
  body: z.string().trim().min(1).max(2000),
  revision: z.coerce.number().int().positive(),
  postId: z.union([z.uuid(), z.literal("")]).default(""),
  quote: z.string().max(25000).default(""),
});

export async function sendFeedback(
  reviewToken: string,
  userId: string | undefined,
  input: z.infer<typeof feedbackSchema>,
) {
  const draft = await sharedDraft(reviewToken, userId);
  const { body, revision, postId, quote } = input;
  return transaction(async (client) => {
    const active = await client.query(
      "SELECT id,owner_id,friend_token FROM drafts WHERE id=$1 AND (share_token=$2 OR friend_token=$2) FOR SHARE",
      [draft.id, reviewToken],
    );
    if (!active.rowCount) error(404, "This review link is unavailable.");
    if (active.rows[0].friend_token && active.rows[0].owner_id !== userId) {
      const access = await client.query(
        `SELECT fr.draft_id FROM friend_reviews fr
        JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
        WHERE fr.draft_id=$1 AND fr.recipient_id=$2 FOR SHARE OF fr,f`,
        [draft.id, userId ?? null],
      );
      if (!access.rowCount) error(404, "This review link is unavailable.");
    }
    const snapshot = (
      await client.query(
        "SELECT content FROM revisions WHERE draft_id=$1 AND number=$2",
        [draft.id, revision],
      )
    ).rows[0];
    const post = snapshot?.content.posts.find(
      (p: { id: string }) => p.id === postId,
    );
    if (
      !snapshot ||
      (postId && !post) ||
      (quote && (!post || !post.text.includes(quote)))
    )
      error(400, "That post is not in this version. Refresh the page.");
    const name = userId
      ? (await client.query("SELECT name FROM users WHERE id=$1", [userId]))
          .rows[0]?.name
      : input.name;
    if (!name) error(400, "Enter a name to send your feedback.");
    const id = crypto.randomUUID();
    await client.query(
      "INSERT INTO comments(id,draft_id,revision,post_id,name,body,quote,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        draft.id,
        revision,
        postId || null,
        name,
        body,
        quote || null,
        userId ?? null,
      ],
    );
    await notify(client, {
      userId: draft.owner_id,
      actorId: userId,
      kind: "feedback",
      draftId: draft.id,
      commentId: id,
    });
    return { id, revision };
  });
}
