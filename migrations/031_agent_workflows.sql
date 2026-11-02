ALTER TABLE comments ADD COLUMN agent_name text;

CREATE TABLE agent_requests (
  connection_id uuid NOT NULL REFERENCES agent_connections ON DELETE CASCADE,
  request_id text NOT NULL,
  operation text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb,
  draft_id uuid REFERENCES drafts ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, request_id)
);

CREATE TABLE agent_transfers (
  hash text PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES agent_connections ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES drafts ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('upload','download')),
  filename text,
  sha256 text,
  media_id uuid REFERENCES media ON DELETE CASCADE,
  review_hash text,
  uploading boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE INDEX agent_transfers_expiry ON agent_transfers(expires_at);

CREATE TABLE agent_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES agent_connections ON DELETE CASCADE,
  operation text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_activity_connection ON agent_activity(connection_id,created_at DESC);
