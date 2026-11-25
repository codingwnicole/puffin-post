-- Store who authored the original Tumblr starter separately from the author
-- of the linked reply. Legacy records stay unresolved until reliable evidence
-- is available; they are never backfilled from the clicked post's author.
ALTER TABLE starters ADD COLUMN starter_author_status TEXT NOT NULL DEFAULT 'unresolved'
  CHECK (starter_author_status IN ('user', 'partner', 'unresolved'));
ALTER TABLE starters ADD COLUMN starter_author_blog_id TEXT;
ALTER TABLE starters ADD COLUMN starter_author_blog_uuid TEXT;
ALTER TABLE starters ADD COLUMN starter_author_source TEXT NOT NULL DEFAULT 'unresolved';
ALTER TABLE starters ADD COLUMN starter_author_confidence TEXT NOT NULL DEFAULT 'none'
  CHECK (starter_author_confidence IN ('high', 'none'));
ALTER TABLE starters ADD COLUMN starter_author_evidence TEXT NOT NULL DEFAULT '';
ALTER TABLE starters ADD COLUMN starter_author_checked_at TEXT;
ALTER TABLE starters ADD COLUMN thread_root_resolved INTEGER NOT NULL DEFAULT 0
  CHECK (thread_root_resolved IN (0, 1));

CREATE INDEX starters_author_attribution ON starters(workspace_id, starter_author_status);
