import { requireUser } from "$lib/server/auth";
import { ownedDraft, draftMedia, draftComments } from "$lib/server/drafts";
import { aiEnabled } from "$lib/server/openai";
import { isPro } from "$lib/server/plans";
import { sourcePost } from "$lib/server/x-post";
import { xPublishing } from "$lib/server/x-publishing";
import { db } from "$lib/server/db";
import { blankContent } from "$lib/contracts";
import { draftReviews } from "$lib/server/ai-review";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const user = requireUser(locals);
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) error(404, "Draft not found.");
  const fresh =
    url.searchParams.has("new") &&
    !(await db.query("SELECT id FROM drafts WHERE id=$1", [params.id]))
      .rowCount;
  const draft = fresh
    ? {
        id: params.id,
        owner_id: user.id,
        content: blankContent(user.name, user.handle, user.avatar_id),
        edit_version: 0,
        share_token: null,
        friend_token: null,
        shared_revision: null,
        posted_at: null,
        updated_at: new Date(),
      }
    : await ownedDraft(params.id, user.id);
  const [media, comments] = await Promise.all([
    fresh ? [] : draftMedia(draft.id),
    fresh ? [] : draftComments(draft.id, user.id),
  ]);
  return {
    postedLink:
      (
        await db.query<{ status: string; url: string | null }>(
          "SELECT status,url FROM posted_x_links WHERE draft_id=$1",
          [draft.id],
        )
      ).rows[0] ?? null,
    xPublishing: await xPublishing(
      draft.owner_id,
      fresh ? undefined : draft.id,
    ),
    mentionsEnabled: await isPro(draft.owner_id),
    sourcePost: await sourcePost(draft.owner_id, draft.content.source?.url),
    aiEnabled: aiEnabled() && (await isPro(draft.owner_id)),
    aiReviews: fresh ? [] : await draftReviews(draft.id, user.id),
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
  };
};
