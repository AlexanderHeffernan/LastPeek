import { requireUser } from "$lib/server/auth";
import { ownedDraft, draftMedia, draftComments } from "$lib/server/drafts";
import { aiEnabled } from "$lib/server/openai";
import { hasFeature } from "$lib/server/features";
import { sourcePost } from "$lib/server/x-post";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals }) => {
  const draft = await ownedDraft(params.id, requireUser(locals).id);
  const [media, comments] = await Promise.all([
    draftMedia(draft.id),
    draftComments(draft.id),
  ]);
  return {
    sourcePost: await sourcePost(draft.owner_id, draft.content.source?.url),
    aiEnabled: aiEnabled() && (await hasFeature(draft.owner_id, "ai-review")),
    draft: { ...draft, updated_at: draft.updated_at.toISOString() },
    media,
    comments,
  };
};
