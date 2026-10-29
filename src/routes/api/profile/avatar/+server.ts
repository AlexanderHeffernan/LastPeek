import { error, json } from "@sveltejs/kit";
import { requireUser, sameOrigin, rateLimit } from "$lib/server/auth";
import { avatarLimit, storeAvatar } from "$lib/server/avatars";
import { readBody } from "$lib/server/request";
import { db } from "$lib/server/db";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  await rateLimit(`avatar:${user.id}`, 20, 3600);
  if (Number(event.request.headers.get("content-length")) > avatarLimit)
    error(413, "Choose an avatar smaller than 5 MB.");
  const bytes = await readBody(event.request, avatarLimit);
  return json({ avatar: await storeAvatar(bytes, user.id) }, { status: 201 });
};

export const DELETE: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  await db.query("UPDATE users SET avatar_id=NULL WHERE id=$1", [user.id]);
  return json({ ok: true });
};
