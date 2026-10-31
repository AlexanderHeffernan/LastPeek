-- Keep safety reservations separate from provider costs. Snapshot tariffs before HTTP.
ALTER TABLE api_usage ADD COLUMN x_unit_usd numeric(12,6);
ALTER TABLE api_usage ADD COLUMN x_pricing_basis text;
ALTER TABLE api_usage ADD COLUMN x_read_rates jsonb;

-- Content-free daily provider deduplication, shared by all users of this app.
CREATE TABLE x_read_charges (
  day date NOT NULL,
  resource_hash text NOT NULL,
  usage_id uuid NOT NULL REFERENCES api_usage ON DELETE CASCADE,
  usd numeric(12,6) NOT NULL CHECK (usd >= 0),
  PRIMARY KEY(day,resource_hash)
);

CREATE TABLE x_credit_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  observed_at timestamptz NOT NULL DEFAULT now(),
  prepaid_usd numeric NOT NULL,
  free_usd numeric NOT NULL,
  grants_hash text NOT NULL,
  ledger_usd numeric NOT NULL,
  requests bigint NOT NULL,
  unresolved bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('baseline','matched','review'))
);
