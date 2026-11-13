ALTER TABLE reply_drafts ADD COLUMN purpose TEXT NOT NULL DEFAULT 'reply'
  CHECK (purpose IN ('reply','plotting','starter_idea','note'));
