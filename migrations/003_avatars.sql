CREATE TABLE avatars (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX avatars_owner ON avatars(owner_id);
ALTER TABLE users ADD COLUMN avatar_id uuid REFERENCES avatars ON DELETE SET NULL;
