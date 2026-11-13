CREATE TABLE reply_draft_characters (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES reply_drafts(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, draft_id, character_id)
);

CREATE INDEX reply_draft_characters_draft ON reply_draft_characters(workspace_id, draft_id);

INSERT OR IGNORE INTO reply_draft_characters (workspace_id,draft_id,character_id)
SELECT workspace_id,id,character_id FROM reply_drafts WHERE character_id IS NOT NULL;
