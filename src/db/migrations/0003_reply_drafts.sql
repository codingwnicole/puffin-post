CREATE TABLE reply_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  character_id TEXT,
  partner_id TEXT,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  reminder_at TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'converted', 'archived')),
  converted_starter_id TEXT,
  converted_branch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((state = 'converted' AND converted_starter_id IS NOT NULL AND converted_branch_id IS NOT NULL)
    OR (state <> 'converted' AND converted_starter_id IS NULL AND converted_branch_id IS NULL)),
  FOREIGN KEY (workspace_id, character_id) REFERENCES characters(workspace_id, id),
  FOREIGN KEY (workspace_id, partner_id) REFERENCES partners(workspace_id, id),
  FOREIGN KEY (workspace_id, converted_starter_id, converted_branch_id) REFERENCES reply_branches(workspace_id, starter_id, id)
);
CREATE INDEX drafts_open_reminders ON reply_drafts(workspace_id, state, reminder_at);
