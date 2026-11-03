import { error } from "@sveltejs/kit";
import { db } from "./db";

// Participation never grants access after the review capability/grant is removed.
const accessible = `d.owner_id=$1 OR (
  EXISTS (SELECT 1 FROM conversation p WHERE p.user_id=$1)
  AND (d.share_token IS NOT NULL OR (d.friend_token IS NOT NULL AND EXISTS (
    SELECT 1 FROM friend_reviews fr JOIN friendships f ON f.id=fr.friendship_id AND f.accepted_at IS NOT NULL
    WHERE fr.draft_id=d.id AND fr.recipient_id=$1))))`;

export async function discussionDestination(userId: string, commentId: string) {
  const row = (
    await db.query(
      `WITH RECURSIVE ancestors AS (
       SELECT id,parent_id FROM comments WHERE id=$2
       UNION ALL SELECT c.id,c.parent_id FROM comments c JOIN ancestors a ON c.id=a.parent_id
     ), conversation AS (
       SELECT c.id,c.user_id FROM comments c JOIN ancestors a ON c.id=a.id WHERE a.parent_id IS NULL
       UNION ALL SELECT c.id,c.user_id FROM comments c JOIN conversation p ON c.parent_id=p.id
     ) SELECT d.id,d.owner_id,d.share_token,d.friend_token,(SELECT id FROM ancestors WHERE parent_id IS NULL) AS root
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
