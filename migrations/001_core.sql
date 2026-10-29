CREATE TABLE users (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
  password_hash text NOT NULL, is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE invites (
  id uuid PRIMARY KEY, hash text NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users,
  expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE drafts (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users,
  content jsonb NOT NULL, edit_version integer NOT NULL DEFAULT 1,
  share_token text UNIQUE, shared_revision integer,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drafts_owner_updated ON drafts(owner_id, updated_at DESC);
CREATE TABLE revisions (
  draft_id uuid NOT NULL REFERENCES drafts ON DELETE CASCADE, number integer NOT NULL,
  content jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, number)
);
CREATE TABLE media (
  id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES drafts ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users, mime text NOT NULL, bytes bigint NOT NULL,
  filename text NOT NULL, width integer, height integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner ON media(owner_id);
CREATE TABLE comments (
  id uuid PRIMARY KEY, draft_id uuid NOT NULL, revision integer NOT NULL, post_id uuid NOT NULL,
  name text NOT NULL, body text NOT NULL, suggestion text, resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (draft_id, revision) REFERENCES revisions ON DELETE CASCADE
);
CREATE INDEX comments_draft ON comments(draft_id, created_at);
CREATE TABLE rate_limits (key text PRIMARY KEY, window_at timestamptz NOT NULL, attempts integer NOT NULL);
