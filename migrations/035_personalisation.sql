ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'auto'
  CHECK (theme IN ('auto', 'dark', 'light'));
