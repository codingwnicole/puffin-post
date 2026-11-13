CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  last_notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX push_subscriptions_workspace ON push_subscriptions(workspace_id, user_id);
