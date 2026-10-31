import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { requireUser, sameOrigin, rateLimit } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { ownedDraft, sharedDraft } from "$lib/server/drafts";
import { changeFriendship, requestFriend } from "$lib/server/friends";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("email"),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
  }),
  z.object({
    action: z.literal("request"),
    userId: z.uuid(),
    draftId: z.uuid().optional(),
    token: z.string().max(43).optional(),
  }),
  z.object({ action: z.enum(["accept", "remove"]), id: z.uuid() }),
]);
export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  let raw;
  try {
    raw = JSON.parse((await readBody(event.request, 2048)).toString());
  } catch {
    error(400, "Send a valid friend request.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    error(400, "Enter a valid email address or friend request.");
  const body = parsed.data;
  await rateLimit(`friends:${user.id}`, 40, 3600);
  if (body.action === "email") {
    const target = (
      await db.query("SELECT id FROM users WHERE lower(email)=$1", [body.email])
    ).rows[0];
    if (!target) error(400, "No account found with that email address.");
    await requestFriend(user.id, target.id);
  } else if (body.action === "request") {
    const draft = body.token
      ? await sharedDraft(body.token, user.id)
      : body.draftId
        ? await ownedDraft(body.draftId, user.id)
        : null;
    if (!draft) error(404, "Profile unavailable.");
    const encountered =
      draft.owner_id === body.userId ||
      (
        await db.query(
          "SELECT 1 FROM comments WHERE draft_id=$1 AND user_id=$2",
          [draft.id, body.userId],
        )
      ).rowCount;
    if (!encountered) error(404, "Profile unavailable.");
    await requestFriend(user.id, body.userId);
  } else await changeFriendship(user.id, body.id, body.action);
  return json({ ok: true });
};
