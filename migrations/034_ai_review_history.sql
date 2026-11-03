CREATE TABLE ai_reviews (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('quick','proofread','clarity','tighten','tone','flow')),
  posts jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_reviews_draft_created ON ai_reviews(draft_id, created_at DESC);
