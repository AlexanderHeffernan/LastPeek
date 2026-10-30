-- Existing active links should start on the latest saved draft too.
WITH snapshots AS (
  INSERT INTO revisions (draft_id, number, content)
  SELECT d.id, COALESCE(last.number, 0) + 1, d.content
  FROM drafts d
  LEFT JOIN LATERAL (
    SELECT number, content FROM revisions
    WHERE draft_id = d.id ORDER BY number DESC LIMIT 1
  ) last ON true
  WHERE d.share_token IS NOT NULL AND last.content IS DISTINCT FROM d.content
  RETURNING draft_id, number
)
UPDATE drafts d SET shared_revision = snapshots.number
FROM snapshots WHERE d.id = snapshots.draft_id;
