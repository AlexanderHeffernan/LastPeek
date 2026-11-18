import { fail, isHttpError } from "@sveltejs/kit";
import { rateLimit } from "$lib/server/auth";
import { draftComments, draftMedia, sharedDraft } from "$lib/server/drafts";
import { mediaIds } from "$lib/contracts";
import { sourcePost } from "$lib/server/x-post";
import { db } from "$lib/server/db";
import {
  feedbackSchema,
  sendFeedback,
  guestCommenter,
} from "$lib/server/feedback";
import type { Actions, PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({
  params,
  locals,
  url,
  cookies,
}) => {
  const draft = await sharedDraft(params.token, locals.user?.id);
  const allowedIds = new Set(mediaIds(draft.content));
  const comments = await draftComments(
    draft.id,
    locals.user?.id,
    guestCommenter(cookies, url.protocol === "https:", !locals.user),
  );
  for (const comment of comments)
    if (comment.media_id) allowedIds.add(comment.media_id);
  // A relationship alone never grants access. Only expose the matching audience's
  // current capability, and recheck private recipient access before returning it.
  const relatedVersion =
    (
      await db.query<{ platform: "x" | "linkedin"; token: string }>(
        `SELECT COALESCE(other.content->>'platform','x') AS platform,
       CASE WHEN $3 THEN other.friend_token ELSE other.share_token END AS token
       FROM draft_versions v JOIN drafts other ON other.id=CASE
         WHEN v.x_draft_id=$1 THEN v.linkedin_draft_id ELSE v.x_draft_id END
       WHERE (v.x_draft_id=$1 OR v.linkedin_draft_id=$1) AND other.owner_id=$2
       AND other.shared_revision IS NOT NULL AND
       (CASE WHEN $3 THEN other.friend_token IS NOT NULL AND
         (other.owner_id=$4 OR EXISTS(SELECT 1 FROM friend_reviews fr
           JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
           WHERE fr.draft_id=other.id AND fr.recipient_id=$4))
        ELSE other.share_token IS NOT NULL END)`,
        [draft.id, draft.owner_id, draft.private, locals.user?.id ?? null],
      )
    ).rows[0] ?? null;
  return {
    relatedVersion,
    sourcePost: await sourcePost(draft.owner_id, draft.content.source?.url),
    token: params.token,
    ownerId: draft.owner_id,
    private: draft.private,
    postedURL: draft.posted_url,
    review:
      locals.user && draft.private && draft.owner_id !== locals.user.id
        ? {
            completed:
              !!draft.posted_at ||
              comments.some(
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
  comment: async ({
    request,
    params,
    locals,
    getClientAddress,
    cookies,
    url,
  }) => {
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
      await sendFeedback(
        params.token,
        locals.user?.id,
        parsed.data,
        undefined,
        guestCommenter(cookies, url.protocol === "https:", !locals.user),
      );
    } catch (cause) {
      if (isHttpError(cause) && cause.status === 400)
        return fail(400, { message: cause.body.message, success: false });
      throw cause;
    }
    return { message: "Your feedback is in. Thank you!", success: true };
  },
};
