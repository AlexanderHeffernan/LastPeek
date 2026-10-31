CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  friend_request boolean NOT NULL DEFAULT true,
  friend_accepted boolean NOT NULL DEFAULT true,
  feedback boolean NOT NULL DEFAULT true,
  shared_draft boolean NOT NULL DEFAULT true
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('friend_request','friend_accepted','feedback','shared_draft')),
  actor_id uuid REFERENCES users ON DELETE SET NULL,
  draft_id uuid REFERENCES drafts ON DELETE CASCADE,
  comment_id uuid REFERENCES comments ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX notifications_inbox ON notifications(user_id,created_at DESC);
CREATE TABLE push_keys (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  public_key text NOT NULL,
  private_key text NOT NULL
);
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  session_id text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
CREATE TABLE push_deliveries (
  notification_id uuid NOT NULL REFERENCES notifications ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(notification_id,subscription_id)
);
CREATE INDEX push_deliveries_due ON push_deliveries(due_at);
