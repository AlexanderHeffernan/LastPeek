-- Names on older feedback are snapshots, not proof of account ownership.
-- Only newly authenticated feedback can be safely linked to an account.
ALTER TABLE comments ADD COLUMN user_id uuid REFERENCES users ON DELETE SET NULL;
CREATE INDEX comments_user ON comments(user_id) WHERE user_id IS NOT NULL;
