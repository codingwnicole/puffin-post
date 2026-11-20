CREATE TABLE character_shares (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  character_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  style TEXT NOT NULL CHECK (style IN ('card','stats')),
  show_moodboard INTEGER NOT NULL DEFAULT 0,
  show_playlist INTEGER NOT NULL DEFAULT 0,
  show_stats INTEGER NOT NULL DEFAULT 0,
  indexable INTEGER NOT NULL DEFAULT 0,
  preview_object_key TEXT,
  disabled_by_moderator INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE share_reports (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
