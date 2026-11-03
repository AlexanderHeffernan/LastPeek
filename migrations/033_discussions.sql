ALTER TABLE comments ADD COLUMN parent_id uuid REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN media_id uuid REFERENCES media(id);
ALTER TABLE comments ADD COLUMN media_time double precision CHECK (media_time >= 0 AND media_time <= 86400);
CREATE INDEX comments_parent ON comments(parent_id);
CREATE TABLE discussion_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, comment_id)
);
