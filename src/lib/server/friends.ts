import { error } from "@sveltejs/kit";
import { db, transaction } from "./db";
import { notify } from "./notifications";
import type { FriendConnection } from "../contracts";

export async function connections(userId: string) {
  return (
    await db.query<FriendConnection>(
      `SELECT f.id,u.id AS user_id,u.name,u.handle,u.avatar_id,
      f.accepted_at IS NOT NULL AS accepted,f.recipient_id=$1 AS incoming,
      COALESCE(f.accepted_at IS NOT NULL AND u.last_seen_at > now()-interval '5 minutes',false) AS active
      FROM friendships f JOIN users u
      ON u.id=CASE WHEN f.requester_id=$1 THEN f.recipient_id ELSE f.requester_id END
      WHERE f.requester_id=$1 OR f.recipient_id=$1 ORDER BY lower(u.name),f.id`,
      [userId],
    )
  ).rows;
}

export async function changeFriendship(
  userId: string,
  id: string,
  action: string,
) {
  if (action === "accept") {
    await transaction(async (client) => {
      const result = await client.query(
        `UPDATE friendships SET accepted_at=now() WHERE id=$1 AND recipient_id=$2
       AND accepted_at IS NULL RETURNING requester_id`,
        [id, userId],
      );
      if (!result.rowCount) error(404, "Friend request unavailable.");
      await notify(client, {
        userId: result.rows[0].requester_id,
        actorId: userId,
        kind: "friend_accepted",
      });
    });
  } else {
    const result = await db.query(
      `DELETE FROM friendships WHERE id=$1 AND (requester_id=$2 OR recipient_id=$2) RETURNING id`,
      [id, userId],
    );
    if (!result.rowCount) error(404, "Friendship unavailable.");
  }
}

export async function requestFriend(userId: string, targetId: string) {
  if (userId === targetId) error(400, "You can’t add yourself.");
  // Opposite requests stay pending until one is explicitly accepted.
  await transaction(async (client) => {
    const added = await client.query(
      `INSERT INTO friendships(id,requester_id,recipient_id)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
      [crypto.randomUUID(), userId, targetId],
    );
    if (added.rowCount)
      await notify(client, {
        userId: targetId,
        actorId: userId,
        kind: "friend_request",
      });
  });
}
