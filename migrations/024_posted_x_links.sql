-- Manual reconciliation does not overwrite native X publication state.
CREATE TABLE posted_x_links (
  draft_id uuid PRIMARY KEY REFERENCES drafts ON DELETE CASCADE,
  edit_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('searching','candidate','linked','unmatched')),
  url text
);
