import { error, json } from "@sveltejs/kit";
import { z } from "zod";
import { requireUser, sameOrigin, rateLimit } from "$lib/server/auth";
import { db, transaction } from "$lib/server/db";
import { pushKeys } from "$lib/server/notifications";
import { readBody } from "$lib/server/request";
import type { RequestHandler } from "./$types";

const endpoint = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ([
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(url.hostname) ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  }, "This push service isn’t supported.");
const subscription = z.object({
  endpoint,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export const GET: RequestHandler = async ({ locals }) => {
  const user = requireUser(locals);
  const enabled = Boolean(
    (
      await db.query(
        "SELECT 1 FROM push_subscriptions WHERE user_id=$1 AND session_id=$2",
        [user.id, locals.pushSession ?? ""],
      )
    ).rowCount,
  );
  return json({ publicKey: (await pushKeys()).publicKey, enabled });
};
export const POST: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  if (!event.locals.pushSession)
    error(401, "Sign in again to enable notifications.");
  await rateLimit(`push:${user.id}`, 60, 3600);
  let body;
  try {
    body = JSON.parse((await readBody(event.request, 4096)).toString());
  } catch {
    error(400, "Send a valid push subscription.");
  }
  const parsed = subscription.safeParse(body);
  if (!parsed.success)
    error(400, "This push subscription isn’t supported. Try another browser.");
  const value = parsed.data;
  await transaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      user.id,
    ]);
    const count = Number(
      (
        await client.query(
          "SELECT count(*) FROM push_subscriptions WHERE user_id=$1 AND endpoint<>$2",
          [user.id, value.endpoint],
        )
      ).rows[0].count,
    );
    if (count >= 10)
      error(400, "Disable notifications on another device first.");
    // Rebinding after sign-in drops the previous account's queued deliveries.
    await client.query("DELETE FROM push_subscriptions WHERE endpoint=$1", [
      value.endpoint,
    ]);
    await client.query(
      "INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth) VALUES($1,$2,$3,$4,$5,$6)",
      [
        crypto.randomUUID(),
        user.id,
        event.locals.pushSession,
        value.endpoint,
        value.keys.p256dh,
        value.keys.auth,
      ],
    );
  });
  return json({ enabled: true });
};
export const DELETE: RequestHandler = async (event) => {
  sameOrigin(event);
  const user = requireUser(event.locals);
  let value;
  try {
    value = JSON.parse((await readBody(event.request, 4096)).toString());
  } catch {
    error(400, "Send a valid push subscription.");
  }
  const parsed = z.object({ endpoint }).safeParse(value);
  if (!parsed.success) error(400, "Send a valid push subscription.");
  await db.query(
    "DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2",
    [user.id, parsed.data.endpoint],
  );
  return json({ enabled: false });
};
