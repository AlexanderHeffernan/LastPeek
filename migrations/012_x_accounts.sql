-- Optional X identities never match or merge by email or handle.
ALTER TABLE users ADD COLUMN has_password boolean NOT NULL DEFAULT true;
-- Recovery and preceding-image password writes also enable local sign-in.
CREATE FUNCTION mark_local_password() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.has_password := true;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mark_local_password BEFORE UPDATE OF password_hash ON users
  FOR EACH ROW EXECUTE FUNCTION mark_local_password();
CREATE TABLE x_accounts (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  x_id text NOT NULL UNIQUE,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz NOT NULL,
  scope text NOT NULL,
  profile jsonb NOT NULL,
  import_pending boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE x_oauth_flows (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  verifier text NOT NULL,
  origin text NOT NULL,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  invite_hash text,
  email text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
