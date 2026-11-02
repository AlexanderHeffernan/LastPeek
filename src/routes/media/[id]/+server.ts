import { error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { mediaIds } from "$lib/contracts";
import { mediaResponse } from "$lib/server/media";
import { sharedDraft } from "$lib/server/drafts";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ params, locals, url, request }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id))
    error(404, "Attachment unavailable.");
  const row = (
    await db.query(
      `SELECT m.*,d.share_token,d.shared_revision FROM media m JOIN drafts d ON d.id=m.draft_id WHERE m.id=$1`,
      [params.id],
    )
  ).rows[0];
  if (!row) error(404, "Attachment unavailable.");
  if (locals.user?.id !== row.owner_id) {
    const key = url.searchParams.get("key");
    if (!key) error(404, "Attachment unavailable.");
    const draft = await sharedDraft(key, locals.user?.id);
    if (draft.id !== row.draft_id) error(404, "Attachment unavailable.");
    const revisions = await db.query(
      "SELECT content FROM revisions WHERE draft_id=$1",
      [row.draft_id],
    );
    if (!revisions.rows.some((r) => mediaIds(r.content).includes(row.id)))
      error(404, "Attachment unavailable.");
  }
  return mediaResponse(row, request);
};
