-- LinkedIn is an optional sign-in identity, never an email-based account merge.
-- Authentication does not retain access tokens or grant publishing permission.
CREATE TABLE linkedin_accounts (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  subject text NOT NULL UNIQUE,
  name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE linkedin_oauth_flows (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  nonce_hash text NOT NULL,
  origin text NOT NULL,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  invite_hash text,
  email text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
