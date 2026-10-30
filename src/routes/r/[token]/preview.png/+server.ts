import { draftMedia, sharedDraft } from "$lib/server/drafts";
import { reviewPreview } from "$lib/server/review-preview";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params }) => {
  const draft = await sharedDraft(params.token);
  const image = await reviewPreview(draft.content, await draftMedia(draft.id));
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
    },
  });
};
