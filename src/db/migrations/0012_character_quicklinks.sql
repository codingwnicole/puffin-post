CREATE TABLE character_quicklinks (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  character_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id, character_id) REFERENCES characters(workspace_id, id)
);
CREATE INDEX character_quicklinks_character ON character_quicklinks(workspace_id, character_id);
