CREATE TABLE agent_clients (
  id text PRIMARY KEY, name text NOT NULL, redirect_uris jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_connections (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES agent_clients,
  scopes text[] NOT NULL, approved_scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days', revoked_at timestamptz
);
CREATE INDEX agent_connections_user ON agent_connections(user_id,created_at DESC);
CREATE TABLE agent_codes (
  hash text PRIMARY KEY, connection_id uuid NOT NULL REFERENCES agent_connections ON DELETE CASCADE,
  redirect_uri text NOT NULL, challenge text NOT NULL, resource text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE TABLE agent_tokens (
  hash text PRIMARY KEY, connection_id uuid NOT NULL REFERENCES agent_connections ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('access','refresh')), scopes text[] NOT NULL,
  resource text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX agent_tokens_connection ON agent_tokens(connection_id);
