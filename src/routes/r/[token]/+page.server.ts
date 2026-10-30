import { error, fail } from "@sveltejs/kit";
import { z } from "zod";
import { db, transaction } from "$lib/server/db";
import { rateLimit } from "$lib/server/auth";
import { draftComments, draftMedia, sharedDraft } from "$lib/server/drafts";
import { mediaIds } from "$lib/contracts";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const draft = await sharedDraft(params.token);
  const allowedIds = new Set(mediaIds(draft.content));
  return {
    token: params.token,
    reviewURL: new URL(`/r/${params.token}`, url.origin).href,
    reviewerName: locals.user?.name ?? null,
    content: draft.content,
    revision: draft.shared_revision,
    media: (await draftMedia(draft.id)).filter((m) => allowedIds.has(m.id)),
    comments: await draftComments(draft.id),
  };
};
export const actions: Actions = {
  comment: async ({ request, params, locals, getClientAddress }) => {
    await rateLimit(`feedback:${getClientAddress()}`, 15, 600);
    const draft = await sharedDraft(params.token);
    const form = await request.formData();
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
        "SELECT id FROM drafts WHERE id=$1 AND share_token=$2 FOR SHARE",
        [draft.id, params.token],
      );
      if (!active.rowCount) error(404, "This review link is unavailable.");
      await client.query(
        "INSERT INTO comments(id,draft_id,revision,post_id,name,body,quote) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          crypto.randomUUID(),
          draft.id,
          revision,
          postId || null,
          name,
          body,
          quote || null,
        ],
      );
    });
    return { message: "Your feedback is in. Thank you!", success: true };
  },
};
