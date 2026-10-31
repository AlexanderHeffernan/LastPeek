-- Metadata only. Never store prompts, responses, draft IDs or X post URLs.
CREATE TABLE api_usage (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('openai','x')),
  model text NOT NULL,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','success','error','incomplete','unusable')),
  input_tokens bigint CHECK (input_tokens >= 0),
  cached_input_tokens bigint CHECK (cached_input_tokens >= 0 AND cached_input_tokens <= input_tokens),
  cache_write_tokens bigint CHECK (cache_write_tokens >= 0 AND cache_write_tokens + cached_input_tokens <= input_tokens),
  output_tokens bigint CHECK (output_tokens >= 0),
  input_usd numeric(12,6),
  cached_input_usd numeric(12,6),
  output_usd numeric(12,6),
  estimated_usd numeric(20,10) CHECK (estimated_usd >= 0),
  reserved_cents integer NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  http_status smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX api_usage_user_date ON api_usage(user_id, created_at);
CREATE INDEX api_usage_date ON api_usage(created_at);
