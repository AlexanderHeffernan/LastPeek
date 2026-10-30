-- Additive: the preceding image can continue using users and legacy sessions.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN image text;

CREATE TABLE auth_accounts (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX auth_accounts_user ON auth_accounts("userId");

CREATE TABLE auth_sessions (
  id text PRIMARY KEY, token text NOT NULL UNIQUE,
  "userId" uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text, "userAgent" text
);
CREATE INDEX auth_sessions_user ON auth_sessions("userId");

CREATE TABLE auth_verifications (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier ON auth_verifications(identifier);

-- The invite, seed and local recovery flows remain the only credential writers.
-- Keep old-image writes coherent during deployment and preserve existing hashes.
CREATE FUNCTION sync_auth_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth_accounts(id,"accountId","providerId","userId",password)
    VALUES(NEW.id::text,NEW.id::text,'credential',NEW.id,NEW.password_hash)
    ON CONFLICT ("providerId","accountId") DO UPDATE
      SET password=EXCLUDED.password,"updatedAt"=now();
  IF TG_OP = 'UPDATE' AND OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    DELETE FROM auth_sessions WHERE "userId"=NEW.id;
    DELETE FROM sessions WHERE user_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_auth_credentials AFTER INSERT OR UPDATE OF password_hash ON users
  FOR EACH ROW EXECUTE FUNCTION sync_auth_credentials();

INSERT INTO auth_accounts(id,"accountId","providerId","userId",password)
  SELECT id::text,id::text,'credential',id,password_hash FROM users;
