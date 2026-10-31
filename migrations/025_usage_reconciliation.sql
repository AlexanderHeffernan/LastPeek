-- Audited decisions overlay the original ledger; never rewrite provider evidence.
CREATE TABLE usage_reconciliations (
  id uuid PRIMARY KEY,
  actor text NOT NULL,
  reason text NOT NULL,
  evidence text NOT NULL,
  thread text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE usage_resolutions (
  usage_id uuid PRIMARY KEY REFERENCES api_usage ON DELETE RESTRICT,
  reconciliation_id uuid NOT NULL REFERENCES usage_reconciliations,
  decision text NOT NULL CHECK (decision IN ('confirmed','non_billable')),
  usd numeric(20,10),
  CHECK ((decision='confirmed' AND usd IS NOT NULL AND usd>=0)
    OR (decision='non_billable' AND usd IS NULL))
);
ALTER TABLE x_credit_snapshots ADD COLUMN resolutions bigint NOT NULL DEFAULT 0;
CREATE TABLE x_credit_checkpoints (
  snapshot_id bigint PRIMARY KEY REFERENCES x_credit_snapshots,
  reconciliation_id uuid NOT NULL REFERENCES usage_reconciliations
);
