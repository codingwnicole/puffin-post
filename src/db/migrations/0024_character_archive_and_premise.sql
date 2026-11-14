ALTER TABLE starters ADD COLUMN premise TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX starters_workspace_thread_identity
ON starters (workspace_id, thread_root_blog_id, thread_root_id)
WHERE thread_root_blog_id IS NOT NULL AND thread_root_id IS NOT NULL;

CREATE TABLE characters_rebuild (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  icon_object_key TEXT,
  color TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'hiatus', 'archived')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, id)
);

INSERT INTO characters_rebuild (id, workspace_id, name, icon_object_key, color, state, notes, created_at)
SELECT id, workspace_id, name, icon_object_key, color, state, notes, created_at FROM characters;

DROP TABLE characters;

ALTER TABLE characters_rebuild RENAME TO characters;
