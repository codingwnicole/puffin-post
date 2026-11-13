ALTER TABLE reply_branches ADD COLUMN last_seen_at TEXT;
ALTER TABLE partners ADD COLUMN notes TEXT NOT NULL DEFAULT '';
CREATE TABLE starter_templates (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, title)
);
CREATE TABLE notification_preferences (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  notify_replies INTEGER NOT NULL DEFAULT 1 CHECK (notify_replies IN (0,1)),
  notify_reminders INTEGER NOT NULL DEFAULT 1 CHECK (notify_reminders IN (0,1)),
  digest_hour_utc INTEGER CHECK (digest_hour_utc BETWEEN 0 AND 23),
  quiet_start_utc INTEGER CHECK (quiet_start_utc BETWEEN 0 AND 23),
  quiet_end_utc INTEGER CHECK (quiet_end_utc BETWEEN 0 AND 23),
  PRIMARY KEY (workspace_id,user_id),
  FOREIGN KEY (workspace_id,user_id) REFERENCES memberships(workspace_id,user_id)
);
