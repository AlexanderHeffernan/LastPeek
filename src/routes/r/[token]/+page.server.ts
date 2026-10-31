import { error, fail } from "@sveltejs/kit";
import { z } from "zod";
import { db, transaction } from "$lib/server/db";
import { rateLimit } from "$lib/server/auth";
import { draftComments, draftMedia, sharedDraft } from "$lib/server/drafts";
import { mediaIds } from "$lib/contracts";
import { sourcePost } from "$lib/server/x-post";
import { notify } from "$lib/server/notifications";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const draft = await sharedDraft(params.token, locals.user?.id);
  const allowedIds = new Set(mediaIds(draft.content));
  const comments = await draftComments(draft.id);
  return {
    sourcePost: await sourcePost(draft.owner_id, draft.content.source?.url),
    token: params.token,
    ownerId: draft.owner_id,
    private: draft.private,
    review:
      locals.user && draft.private && draft.owner_id !== locals.user.id
        ? {
            completed: comments.some(
              (comment) =>
                comment.user_id === locals.user?.id &&
                comment.revision === draft.shared_revision,
            ),
          }
        : null,
    reviewURL: new URL(`/r/${params.token}`, url.origin).href,
    reviewer: locals.user
      ? {
          id: locals.user.id,
          name: locals.user.name,
          avatar_id: locals.user.avatar_id,
        }
      : null,
    content: draft.content,
    revision: draft.shared_revision,
    media: (await draftMedia(draft.id)).filter((m) => allowedIds.has(m.id)),
    comments,
  };
};
export const actions: Actions = {
  comment: async ({ request, params, locals, getClientAddress }) => {
    await rateLimit(`feedback:${getClientAddress()}`, 15, 600);
    const draft = await sharedDraft(params.token, locals.user?.id);
    const form = await request.formData();
    if (form.get("intent") === "looks-good") {
      form.set("body", "Looks good!");
      form.set("revision", String(form.get("currentRevision") ?? ""));
      form.set("postId", "");
      form.set("quote", "");
    }
    const parsed = z
      .object({
        name: z.string().trim().max(80),
        body: z.string().trim().min(1).max(2000),
        revision: z.coerce.number().int().positive(),
        postId: z.union([z.uuid(), z.literal("")]).default(""),
        quote: z.string().max(25000).default(""),
      })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success)
      return fail(400, {
        message: "Add your name and a comment (up to 2,000 characters).",
        success: false,
      });
    const { body, revision, postId, quote } = parsed.data;
    const name = locals.user?.name ?? parsed.data.name;
    if (!name)
      return fail(400, {
        message: "Enter a name to send your feedback.",
        success: false,
      });
    const snapshot = (
      await db.query(
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
      return fail(400, {
        message: "That post is not in this version. Refresh the page.",
        success: false,
      });
    await transaction(async (client) => {
      // A revocation and a comment serialize on the draft: a revoked capability cannot write.
      const active = await client.query(
        "SELECT id,owner_id,friend_token FROM drafts WHERE id=$1 AND (share_token=$2 OR friend_token=$2) FOR SHARE",
        [draft.id, params.token],
      );
      if (!active.rowCount) error(404, "This review link is unavailable.");
      if (
        active.rows[0].friend_token &&
        active.rows[0].owner_id !== locals.user?.id
      ) {
        const access = await client.query(
          `SELECT fr.draft_id FROM friend_reviews fr
          JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
          WHERE fr.draft_id=$1 AND fr.recipient_id=$2 FOR SHARE OF fr,f`,
          [draft.id, locals.user?.id ?? null],
        );
        if (!access.rowCount) error(404, "This review link is unavailable.");
      }
      const commentId = crypto.randomUUID();
      await client.query(
        "INSERT INTO comments(id,draft_id,revision,post_id,name,body,quote,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          commentId,
          draft.id,
          revision,
          postId || null,
          name,
          body,
          quote || null,
          locals.user?.id ?? null,
        ],
      );
      await notify(client, {
        userId: draft.owner_id,
        actorId: locals.user?.id,
        kind: "feedback",
        draftId: draft.id,
        commentId,
      });
    });
    return { message: "Your feedback is in. Thank you!", success: true };
  },
};
