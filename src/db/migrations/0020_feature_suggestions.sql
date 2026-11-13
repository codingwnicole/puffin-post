CREATE TABLE feature_suggestions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX feature_suggestions_workspace_created ON feature_suggestions(workspace_id, created_at DESC);
