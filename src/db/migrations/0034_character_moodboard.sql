-- Moodboard items for a character: uploaded images and Pinterest pins, plus playlist/board links live on the card.
CREATE TABLE character_moodboard_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','pin')),
  object_key TEXT,
  pin_id TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX character_moodboard_items_idx ON character_moodboard_items (workspace_id, character_id, position);
