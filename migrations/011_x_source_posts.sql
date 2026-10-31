CREATE TABLE x_source_posts (
  post_id text PRIMARY KEY,
  content jsonb,
  expires_at timestamptz NOT NULL
);

-- Conservative reservations, not an invoice: failed requests also consume budget.
CREATE TABLE x_api_budgets (
  month date PRIMARY KEY,
  reserved_cents integer NOT NULL CHECK (reserved_cents >= 0)
);
