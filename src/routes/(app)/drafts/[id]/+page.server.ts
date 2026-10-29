import { requireUser } from "$lib/server/auth";
import { ownedDraft, draftMedia, draftComments } from "$lib/server/drafts";
import { db } from "$lib/server/db";
import { aiEnabled } from "$lib/server/openai";
import { hasFeature } from "$lib/server/features";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals }) => {
  const draft = await ownedDraft(params.id, requireUser(locals).id);
  const [media, comments, revisions] = await Promise.all([
    draftMedia(draft.id),
    draftComments(draft.id),
    db.query(
      "SELECT number,content,created_at FROM revisions WHERE draft_id=$1 ORDER BY number DESC",
      [draft.id],
    ),
  ]);
  return {
    aiEnabled: aiEnabled() && (await hasFeature(draft.owner_id, "ai-review")),
    draft: { ...draft, updated_at: draft.updated_at.toISOString() },
    media,
    comments,
    revisions: revisions.rows.map((r) => ({
      ...r,
      created_at: r.created_at.toISOString(),
    })),
  };
};
