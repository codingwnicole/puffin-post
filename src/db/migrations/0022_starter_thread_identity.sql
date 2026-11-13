ALTER TABLE starters ADD COLUMN thread_root_id TEXT;
ALTER TABLE starters ADD COLUMN thread_root_blog_id TEXT;

UPDATE starters
SET thread_root_id = root_post_id,
    thread_root_blog_id = root_blog_id
WHERE thread_root_id IS NULL;

CREATE INDEX starters_workspace_thread_root ON starters(workspace_id, thread_root_id);
