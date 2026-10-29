CREATE TABLE feature_grants (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  feature text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature)
);
CREATE TABLE feature_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users ON DELETE SET NULL,
  feature text NOT NULL,
  enabled boolean NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  thread text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feature_audit_user ON feature_audit(user_id, id DESC);
