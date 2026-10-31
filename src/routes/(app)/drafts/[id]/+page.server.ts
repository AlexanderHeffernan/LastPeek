import { requireUser } from "$lib/server/auth";
import { ownedDraft, draftMedia, draftComments } from "$lib/server/drafts";
import { aiEnabled } from "$lib/server/openai";
import { isPro } from "$lib/server/plans";
import { sourcePost } from "$lib/server/x-post";
import { xPublishing } from "$lib/server/x-publishing";
import { db } from "$lib/server/db";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals }) => {
  const draft = await ownedDraft(params.id, requireUser(locals).id);
  const [media, comments] = await Promise.all([
    draftMedia(draft.id),
    draftComments(draft.id),
  ]);
  return {
    xPublishing: await xPublishing(draft.owner_id, draft.id),
    sourcePost: await sourcePost(draft.owner_id, draft.content.source?.url),
    aiEnabled: aiEnabled() && (await isPro(draft.owner_id)),
    draft: {
      ...draft,
      posted_at: draft.posted_at?.toISOString() ?? null,
      updated_at: draft.updated_at.toISOString(),
    },
    media,
    comments,
    recipients: (
      await db.query<{ recipient_id: string }>(
        "SELECT recipient_id FROM friend_reviews WHERE draft_id=$1",
        [draft.id],
      )
    ).rows.map((r) => r.recipient_id),
    completedReviews: (
      await db.query<{ recipient_id: string }>(
        "SELECT recipient_id FROM friend_reviews WHERE draft_id=$1 AND completed_at IS NOT NULL",
        [draft.id],
      )
    ).rows.map((r) => r.recipient_id),
  };
};
