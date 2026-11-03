import { json, error } from "@sveltejs/kit";
import { z } from "zod";
import { requireUser, sameOrigin } from "$lib/server/auth";
import { discussionDestination } from "$lib/server/discussions";
import { db } from "$lib/server/db";
import type { RequestHandler } from "./$types";
export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  if (!z.uuid().safeParse(event.params.id).success)
    error(400, "Choose a comment.");
  const conversation = await discussionDestination(user.id, event.params.id);
  await db.query(
    `INSERT INTO discussion_reads(user_id,comment_id,read_at)
    SELECT $1,$2,created_at FROM comments WHERE id=$3
    ON CONFLICT(user_id,comment_id) DO UPDATE SET read_at=GREATEST(discussion_reads.read_at,EXCLUDED.read_at)`,
    [user.id, conversation.root, event.params.id],
  );
  return json({ ok: true });
};
