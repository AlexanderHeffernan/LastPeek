CREATE TABLE IF NOT EXISTS draft_versions (
  x_draft_id uuid PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
  linkedin_draft_id uuid NOT NULL UNIQUE REFERENCES drafts(id) ON DELETE CASCADE,
  CHECK (x_draft_id <> linkedin_draft_id)
);
