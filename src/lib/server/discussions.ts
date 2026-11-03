import { error } from "@sveltejs/kit";
import { db } from "./db";

// Participation never grants access after the review capability/grant is removed.
const accessible = `d.owner_id=$1 OR (
  EXISTS (SELECT 1 FROM comments p WHERE p.draft_id=d.id AND p.user_id=$1
    AND (p.id=COALESCE(c.parent_id,c.id) OR p.parent_id=COALESCE(c.parent_id,c.id)))
  AND (d.share_token IS NOT NULL OR (d.friend_token IS NOT NULL AND EXISTS (
    SELECT 1 FROM friend_reviews fr JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
    WHERE fr.draft_id=d.id AND fr.recipient_id=$1))))`;

export async function discussionDestination(userId: string, commentId: string) {
  const row = (
    await db.query(
      `SELECT d.id,d.owner_id,d.share_token,d.friend_token,COALESCE(c.parent_id,c.id) AS root
     FROM comments c JOIN drafts d ON d.id=c.draft_id WHERE c.id=$2 AND (${accessible})`,
      [userId, commentId],
    )
  ).rows[0];
  if (!row) error(404, "This conversation is unavailable.");
  return {
    root: row.root as string,
    href: `${row.owner_id === userId ? `/drafts/${row.id}` : `/r/${row.share_token ?? row.friend_token}`}#feedback-${commentId}`,
  };
}

export async function discussionInbox(userId: string) {
  const rows = (
    await db.query<{
      id: string;
      body: string;
      draft_text: string;
      latest_body: string;
      name: string;
      replies: number;
      unread: boolean;
      updated_at: Date;
      own: boolean;
    }>(
      `SELECT c.id,c.body,d.content->'posts'->0->>'text' AS draft_text,
     latest.body AS latest_body,COALESCE(u.name,latest.name) AS name,
     (SELECT count(*)::int FROM comments p WHERE p.parent_id=c.id) AS replies,
     EXISTS(SELECT 1 FROM comments p WHERE (p.id=c.id OR p.parent_id=c.id)
       AND p.user_id IS DISTINCT FROM $1::uuid AND p.created_at>COALESCE(r.read_at,'epoch')) AS unread,
     latest.created_at AS updated_at,d.owner_id=$1 AS own
     FROM comments c JOIN drafts d ON d.id=c.draft_id
     JOIN LATERAL (SELECT body,name,user_id,created_at FROM comments p WHERE p.id=c.id OR p.parent_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) latest ON true
     LEFT JOIN users u ON u.id=latest.user_id
     LEFT JOIN discussion_reads r ON r.comment_id=c.id AND r.user_id=$1
     WHERE c.parent_id IS NULL AND (${accessible})
     ORDER BY latest.created_at DESC,c.id DESC LIMIT 100`,
      [userId],
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    updated_at: row.updated_at.toISOString(),
  }));
}
