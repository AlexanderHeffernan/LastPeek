-- Opaque management IDs must never expose legacy bearer-token hashes.
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX sessions_id ON sessions(id);
-- Existing sessions have unknown creation times; only new sessions get a timestamp.
ALTER TABLE sessions ADD COLUMN created_at timestamptz;
ALTER TABLE sessions ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE sessions ADD COLUMN user_agent text;
ALTER TABLE sessions ADD COLUMN last_used_at timestamptz;
ALTER TABLE auth_sessions ADD COLUMN last_used_at timestamptz;
