import { fail, isHttpError } from "@sveltejs/kit";
import { rateLimit } from "$lib/server/auth";
import { draftComments, draftMedia, sharedDraft } from "$lib/server/drafts";
import { mediaIds } from "$lib/contracts";
import { sourcePost } from "$lib/server/x-post";
import { feedbackSchema, sendFeedback } from "$lib/server/feedback";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const draft = await sharedDraft(params.token, locals.user?.id);
  const allowedIds = new Set(mediaIds(draft.content));
  const comments = await draftComments(draft.id);
  for (const comment of comments)
    if (comment.media_id) allowedIds.add(comment.media_id);
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
    await sharedDraft(params.token, locals.user?.id);
    const form = await request.formData();
    if (form.get("intent") === "looks-good") {
      form.set("body", "Looks good!");
      form.set("revision", String(form.get("currentRevision") ?? ""));
      form.set("postId", "");
      form.set("quote", "");
      form.set("parentId", "");
      form.set("mediaId", "");
      form.delete("mediaTime");
    }
    const parsed = feedbackSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success)
      return fail(400, {
        message: "Add your name and a comment (up to 2,000 characters).",
        success: false,
      });
    try {
      await sendFeedback(params.token, locals.user?.id, parsed.data);
    } catch (cause) {
      if (isHttpError(cause) && cause.status === 400)
        return fail(400, { message: cause.body.message, success: false });
      throw cause;
    }
    return { message: "Your feedback is in. Thank you!", success: true };
  },
};
