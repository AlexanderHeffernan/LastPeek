import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";
export const GET: RequestHandler = async ({ locals }) => {
  const user = requireUser(locals);
  const row = (
    await db.query(
      `SELECT
    (SELECT count(*)::int FROM friendships WHERE recipient_id=$1 AND accepted_at IS NULL) AS requests,
    (SELECT count(*)::int FROM notifications WHERE user_id=$1 AND read_at IS NULL) AS unread`,
      [user.id],
    )
  ).rows[0];
  return json(row);
};
export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  let value;
  try {
    value = JSON.parse((await readBody(event.request, 512)).toString());
  } catch {
    error(400, "Send a notification ID.");
  }
  const parsed = z.object({ id: z.uuid() }).safeParse(value);
  if (!parsed.success) error(400, "Send a notification ID.");
  const result = await db.query(
    "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id",
    [parsed.data.id, user.id],
  );
  if (!result.rowCount) error(404, "Notification unavailable.");
  return json({ read: true });
};
