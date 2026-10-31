ALTER TABLE drafts ADD COLUMN posted_at timestamptz;
ALTER TABLE friend_reviews ADD COLUMN completed_at timestamptz;

-- Only fully confirmed publications belong in the completed queue.
UPDATE drafts d SET posted_at=x.posted_at
FROM x_publications x WHERE x.draft_id=d.id AND x.status='posted';
