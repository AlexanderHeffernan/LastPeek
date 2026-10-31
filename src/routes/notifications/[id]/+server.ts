import { error, redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { requireUser } from "$lib/server/auth";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ locals, params }) => {
  const user = requireUser(locals);
  if (!/^[0-9a-f-]{36}$/i.test(params.id))
    error(404, "Notification unavailable.");
  const row = (
    await db.query(
      `SELECT n.*,d.friend_token FROM notifications n
    LEFT JOIN drafts d ON d.id=n.draft_id WHERE n.id=$1 AND n.user_id=$2`,
      [params.id, user.id],
    )
  ).rows[0];
  if (!row) error(404, "Notification unavailable.");
  if (row.kind === "friend_request" || row.kind === "friend_accepted")
    redirect(303, "/friends");
  if (row.kind === "feedback")
    redirect(303, `/drafts/${row.draft_id}#feedback-${row.comment_id}`);
  const access = await db.query(
    `SELECT 1 FROM friend_reviews fr JOIN friendships f ON f.id=fr.friendship_id
    WHERE fr.draft_id=$1 AND fr.recipient_id=$2 AND f.accepted_at IS NOT NULL`,
    [row.draft_id, user.id],
  );
  if (!row.friend_token || !access.rowCount)
    error(404, "Access to this shared draft has been removed.");
  redirect(303, `/r/${row.friend_token}`);
};
