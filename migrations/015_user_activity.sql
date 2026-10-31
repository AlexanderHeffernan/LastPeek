-- No backfill: account creation and session renewal are not proof of activity.
ALTER TABLE users ADD COLUMN last_seen_at timestamptz;
