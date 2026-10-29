import { error, fail } from "@sveltejs/kit";
import { z } from "zod";
import { db, transaction } from "$lib/server/db";
import { rateLimit } from "$lib/server/auth";
import { draftComments, draftMedia } from "$lib/server/drafts";
import { mediaIds } from "$lib/contracts";
import type { Actions, PageServerLoad } from "./$types";
async function sharedDraft(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    error(404, "This review link is unavailable. It may have been revoked.");
  const draft = (
    await db.query(
      "SELECT id,shared_revision FROM drafts WHERE share_token=$1 AND shared_revision IS NOT NULL",
      [token],
    )
  ).rows[0];
  if (!draft)
    error(404, "This review link is unavailable. It may have been revoked.");
  return draft;
}
export const load: PageServerLoad = async ({ params, url }) => {
  const draft = await sharedDraft(params.token);
  const revisions = (
    await db.query(
      "SELECT number,content,created_at FROM revisions WHERE draft_id=$1 ORDER BY number DESC",
      [draft.id],
    )
  ).rows;
  const requested = url.searchParams.get("v");
  const selected = requested ? Number(requested) : draft.shared_revision;
  const revision = revisions.find((r) => r.number === selected);
  if (!revision) error(404, "This version is unavailable.");
  const allowedIds = new Set(revisions.flatMap((r) => mediaIds(r.content)));
  return {
    token: params.token,
    content: revision.content,
    revision: selected,
    latest: draft.shared_revision,
    revisions: revisions.map((r) => ({
      number: r.number,
      created_at: r.created_at.toISOString(),
    })),
    media: (await draftMedia(draft.id)).filter((m) => allowedIds.has(m.id)),
    comments: await draftComments(draft.id),
  };
};
export const actions: Actions = {
  comment: async ({ request, params, getClientAddress }) => {
    await rateLimit(`feedback:${getClientAddress()}`, 15, 600);
    const draft = await sharedDraft(params.token);
    const form = await request.formData();
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80),
        body: z.string().trim().min(1).max(2000),
        suggestion: z.string().max(25000).optional(),
        revision: z.coerce.number().int().positive(),
        postId: z.uuid(),
      })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success)
      return fail(400, {
        message: "Add your name and a comment (up to 2,000 characters).",
        success: false,
      });
    const { name, body, suggestion, revision, postId } = parsed.data;
    const snapshot = (
      await db.query(
        "SELECT content FROM revisions WHERE draft_id=$1 AND number=$2",
        [draft.id, revision],
      )
    ).rows[0];
    if (!snapshot?.content.posts.some((p: { id: string }) => p.id === postId))
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
        "INSERT INTO comments(id,draft_id,revision,post_id,name,body,suggestion) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          crypto.randomUUID(),
          draft.id,
          revision,
          postId,
          name,
          body,
          suggestion?.trim() || null,
        ],
      );
    });
    return { message: "Your feedback is in. Thank you!", success: true };
  },
};
