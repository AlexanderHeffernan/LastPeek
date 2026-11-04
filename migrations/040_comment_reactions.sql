CREATE TABLE comment_reactions (
  comment_id uuid NOT NULL REFERENCES comments ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  guest_hash text,
  emoji text NOT NULL CHECK (emoji IN ('👍','❤️','🎉')),
  CHECK (num_nonnulls(user_id,guest_hash)=1)
);
CREATE UNIQUE INDEX comment_reactions_user ON comment_reactions(comment_id,user_id,emoji) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX comment_reactions_guest ON comment_reactions(comment_id,guest_hash,emoji) WHERE guest_hash IS NOT NULL;
ALTER TABLE comments ADD COLUMN reactions_version integer NOT NULL DEFAULT 0;
