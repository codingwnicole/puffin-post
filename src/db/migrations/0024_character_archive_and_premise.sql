ALTER TABLE starters ADD COLUMN premise TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX starters_workspace_thread_identity
ON starters (workspace_id, thread_root_blog_id, thread_root_id)
WHERE thread_root_blog_id IS NOT NULL AND thread_root_id IS NOT NULL;

-- Rebuild characters to allow state='archived'. Live D1 enforces foreign keys, and six tables
-- reference characters. Defer FK checks to commit, and re-insert the rows only AFTER the new table
-- exists under its final name, so every child row is re-satisfied before commit (rehearsed on a
-- copy of the live database). reply_draft_characters is ON DELETE CASCADE, which still fires on
-- DROP, so its rows are backed up and restored.
PRAGMA defer_foreign_keys = true;

CREATE TABLE reply_draft_characters_backup AS SELECT * FROM reply_draft_characters;

CREATE TABLE characters_backup AS SELECT * FROM characters;

DROP TABLE characters;

CREATE TABLE characters (
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

INSERT INTO characters (id, workspace_id, name, icon_object_key, color, state, notes, created_at)
SELECT id, workspace_id, name, icon_object_key, color, state, notes, created_at FROM characters_backup;

INSERT OR IGNORE INTO reply_draft_characters SELECT * FROM reply_draft_characters_backup;

DROP TABLE characters_backup;

DROP TABLE reply_draft_characters_backup;
