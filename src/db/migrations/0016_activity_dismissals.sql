CREATE TABLE activity_dismissals (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  blog_identifier TEXT NOT NULL,
  post_id TEXT NOT NULL,
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, blog_identifier, post_id)
);
