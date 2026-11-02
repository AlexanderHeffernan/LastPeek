-- Per-account searches must not expose another author's search history.
CREATE TABLE x_mention_cache (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('search','check')),
  query text NOT NULL,
  content jsonb,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id,kind,query)
);
