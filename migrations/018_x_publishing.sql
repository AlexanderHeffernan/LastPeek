ALTER TABLE x_oauth_flows ADD COLUMN publish_draft uuid REFERENCES drafts ON DELETE CASCADE;
CREATE TABLE x_publications (
  draft_id uuid PRIMARY KEY REFERENCES drafts ON DELETE CASCADE,
  edit_version integer NOT NULL,
  x_id text NOT NULL,
  text text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','posted','failed','unknown')),
  post_id text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz
);
