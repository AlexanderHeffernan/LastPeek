ALTER TABLE comments ADD COLUMN guest_hash text;
ALTER TABLE comments ADD COLUMN deleted_at timestamptz;
ALTER TABLE comments ADD COLUMN edited_at timestamptz;
ALTER TABLE comments ADD COLUMN edit_version integer NOT NULL DEFAULT 1;
