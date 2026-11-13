ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE reply_branches ADD COLUMN next_check_at TEXT;
CREATE INDEX branches_next_check ON reply_branches(workspace_id, next_check_at);
