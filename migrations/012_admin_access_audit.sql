CREATE TABLE admin_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users ON DELETE SET NULL,
  user_id uuid REFERENCES users ON DELETE SET NULL,
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
