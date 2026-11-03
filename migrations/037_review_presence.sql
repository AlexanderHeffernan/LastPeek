-- Ephemeral viewing state, separate from account-wide friend activity.
CREATE TABLE review_presence (
  draft_id uuid NOT NULL REFERENCES drafts ON DELETE CASCADE,
  viewer_hash text NOT NULL,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  guest_name text NOT NULL DEFAULT 'Guest',
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, viewer_hash)
);
CREATE INDEX review_presence_seen ON review_presence(seen_at);
