CREATE TABLE plan_allowances (
  plan text PRIMARY KEY CHECK (plan IN ('free','pro')),
  limits jsonb NOT NULL
);
INSERT INTO plan_allowances VALUES
  ('free','{"drafts":10,"storage_mb":250,"upload_mb":50,"ai_usd":0,"x_usd":0}'),
  ('pro','{"drafts":100,"storage_mb":2048,"upload_mb":50,"ai_usd":0.5,"x_usd":1.5}');
ALTER TABLE users ADD COLUMN plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro'));
ALTER TABLE users ADD COLUMN plan_anchor timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN period_start timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN period_end timestamptz NOT NULL DEFAULT now()+interval '1 month';
ALTER TABLE users ADD COLUMN pro_limits jsonb NOT NULL DEFAULT '{"drafts":100,"storage_mb":2048,"upload_mb":50,"ai_usd":0.5,"x_usd":1.5}';
ALTER TABLE users ADD COLUMN downgrade_at_end boolean NOT NULL DEFAULT false;
-- Existing trial authors keep all released capabilities. Future accounts default Free.
UPDATE users SET plan='pro';
ALTER TABLE invites ADD COLUMN email text;
ALTER TABLE invites ADD COLUMN plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro'));
-- Old bearer-only invitations cannot bypass email-bound registration.
UPDATE invites SET revoked_at=now() WHERE used_at IS NULL AND revoked_at IS NULL;
ALTER TABLE api_usage ADD COLUMN period_start timestamptz;
ALTER TABLE api_usage ADD COLUMN reserved_usd numeric;
CREATE INDEX api_usage_account_period ON api_usage(user_id,period_start,provider);
CREATE TABLE plan_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users ON DELETE SET NULL,
  user_id uuid REFERENCES users ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
DELETE FROM feature_grants WHERE feature IN ('ai-review','x-source-posts');
