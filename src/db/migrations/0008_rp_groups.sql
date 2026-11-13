CREATE TABLE rp_groups (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name)
);
CREATE TABLE rp_group_characters (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  group_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, group_id, character_id),
  FOREIGN KEY (workspace_id, group_id) REFERENCES rp_groups(workspace_id, id),
  FOREIGN KEY (workspace_id, character_id) REFERENCES characters(workspace_id, id)
);
ALTER TABLE starters ADD COLUMN rp_group_id TEXT;
CREATE INDEX starters_rp_group ON starters(workspace_id, rp_group_id);
