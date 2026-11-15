CREATE TABLE IF NOT EXISTS posted_linkedin_links (
  draft_id uuid PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
  url text NOT NULL
);
