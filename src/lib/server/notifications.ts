import type { PoolClient } from "pg";
import webpush from "web-push";
import { db, transaction } from "./db";
import {
  defaultNotificationPreferences,
  notificationMessage,
  type NotificationKind,
  type NotificationPreferences,
} from "../notifications";

export async function notificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const row = (
    await db.query(
      "SELECT friend_request,friend_accepted,feedback,shared_draft FROM notification_preferences WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
  return row ?? { ...defaultNotificationPreferences };
}

// Enqueue inside the domain transaction: rolled-back actions cannot notify.
export async function notify(
  client: PoolClient,
  event: {
    userId: string;
    kind: NotificationKind;
    actorId?: string;
    draftId?: string;
    commentId?: string;
  },
) {
  if (event.userId === event.actorId) return;
  const preferences = (
    await client.query(
      "SELECT * FROM notification_preferences WHERE user_id=$1",
      [event.userId],
    )
  ).rows[0];
  if (preferences?.[event.kind] === false) return;
  const id = crypto.randomUUID();
  await client.query(
    "INSERT INTO notifications(id,user_id,kind,actor_id,draft_id,comment_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      event.userId,
      event.kind,
      event.actorId ?? null,
      event.draftId ?? null,
      event.commentId ?? null,
    ],
  );
  await client.query(
    "INSERT INTO push_deliveries(notification_id,subscription_id) SELECT $1,id FROM push_subscriptions WHERE user_id=$2",
    [id, event.userId],
  );
}

export async function pushKeys() {
  const keys = webpush.generateVAPIDKeys();
  await db.query(
    "INSERT INTO push_keys(public_key,private_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [keys.publicKey, keys.privateKey],
  );
  const row = (
    await db.query(
      "SELECT public_key,private_key FROM push_keys WHERE singleton",
    )
  ).rows[0];
  return {
    publicKey: row.public_key as string,
    privateKey: row.private_key as string,
  };
}

export const activePushSession = `(
  EXISTS (SELECT 1 FROM sessions WHERE 'legacy:'||hash=s.session_id AND user_id=s.user_id AND expires_at>now())
  OR EXISTS (SELECT 1 FROM auth_sessions WHERE 'auth:'||id=s.session_id AND "userId"=s.user_id AND "expiresAt">now())
)`;

let sending = false;
export async function deliverPush() {
  if (sending) return;
  sending = true;
  try {
    const keys = await pushKeys();
    for (let count = 0; count < 20; count++) {
      const found = await transaction(async (client) => {
        const row = (
          await client.query(`SELECT q.*,n.user_id,n.kind,n.read_at,n.created_at,
          s.endpoint,s.p256dh,s.auth,${activePushSession} AS active,
          p.friend_request,p.friend_accepted,p.feedback,p.shared_draft
          FROM push_deliveries q JOIN notifications n ON n.id=q.notification_id
          JOIN push_subscriptions s ON s.id=q.subscription_id
          LEFT JOIN notification_preferences p ON p.user_id=n.user_id
          WHERE q.due_at<=now() ORDER BY q.due_at LIMIT 1 FOR UPDATE OF q SKIP LOCKED`)
        ).rows[0];
        if (!row) return false;
        let retry = false;
        if (
          row.active &&
          !row.read_at &&
          row[row.kind] !== false &&
          Date.now() - new Date(row.created_at).getTime() < 86400000
        ) {
          try {
            await webpush.sendNotification(
              {
                endpoint: row.endpoint,
                keys: { p256dh: row.p256dh, auth: row.auth },
              },
              JSON.stringify({
                title: "LastPeek",
                body: notificationMessage(row.kind),
                id: row.notification_id,
              }),
              {
                TTL: 3600,
                timeout: 5000,
                vapidDetails: {
                  ...keys,
                  subject: "https://lastpeek.alexheffernan.dev",
                },
              },
            );
          } catch (cause) {
            const status = (cause as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410)
              await client.query("DELETE FROM push_subscriptions WHERE id=$1", [
                row.subscription_id,
              ]);
            else
              retry =
                (!status || status === 429 || status >= 500) &&
                row.attempts < 5;
          }
        }
        if (retry)
          await client.query(
            "UPDATE push_deliveries SET attempts=attempts+1,due_at=now()+($3*interval '1 minute') WHERE notification_id=$1 AND subscription_id=$2",
            [row.notification_id, row.subscription_id, 2 ** row.attempts],
          );
        else
          await client.query(
            "DELETE FROM push_deliveries WHERE notification_id=$1 AND subscription_id=$2",
            [row.notification_id, row.subscription_id],
          );
        return true;
      });
      if (!found) break;
    }
  } finally {
    sending = false;
  }
}
