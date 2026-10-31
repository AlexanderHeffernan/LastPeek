CREATE TABLE friendships (
  id uuid PRIMARY KEY,
  requester_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> recipient_id)
);
CREATE UNIQUE INDEX friendships_pair ON friendships
  (LEAST(requester_id, recipient_id), GREATEST(requester_id, recipient_id));
CREATE INDEX friendships_recipient ON friendships(recipient_id);
CREATE INDEX friendships_requester ON friendships(requester_id);

-- Separate from bearer capabilities: the preceding image cannot resolve these URLs.
ALTER TABLE drafts ADD COLUMN friend_token text UNIQUE;
ALTER TABLE drafts ADD CONSTRAINT drafts_one_audience
  CHECK (share_token IS NULL OR friend_token IS NULL);
CREATE TABLE friend_reviews (
  draft_id uuid NOT NULL REFERENCES drafts ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  friendship_id uuid NOT NULL REFERENCES friendships ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, recipient_id)
);
CREATE INDEX friend_reviews_recipient ON friend_reviews(recipient_id);
