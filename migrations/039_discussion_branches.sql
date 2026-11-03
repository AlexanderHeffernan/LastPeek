ALTER TABLE comments ADD COLUMN thread_parent_id uuid REFERENCES comments(id) ON DELETE CASCADE;
UPDATE comments SET thread_parent_id=parent_id;
CREATE INDEX comments_thread_parent ON comments(thread_parent_id);
