import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { requireUser, sameOrigin, rateLimit } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";

const schema = z.object({
  ids: z.array(z.uuid()).max(100),
});

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  let raw;
  try {
    raw = JSON.parse((await readBody(event.request, 8192)).toString());
  } catch {
    error(400, "Invalid activity request.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) error(400, "Invalid activity request.");
  await rateLimit(`presence:${user.id}`, 240, 3600);
  const result = await db.query<{ id: string; last_seen_at: Date | null }>(
    `SELECT u.id,date_trunc('minute',u.last_seen_at) AS last_seen_at FROM users u
     WHERE u.id=ANY($2::uuid[]) AND EXISTS (
         SELECT 1 FROM friendships f WHERE f.accepted_at IS NOT NULL AND
         ((f.requester_id=$1 AND f.recipient_id=u.id) OR
          (f.recipient_id=$1 AND f.requester_id=u.id))
     )`,
    [user.id, parsed.data.ids],
  );
  return json(result.rows);
};
