ALTER TABLE reply_branches ADD COLUMN refresh_error TEXT;
ALTER TABLE reply_branches ADD COLUMN status_manual_override_at TEXT;

CREATE TABLE refresh_scheduler_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_character_blog_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
