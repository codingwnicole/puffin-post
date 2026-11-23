CREATE TABLE site_roadmap_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 4 AND 160),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 3000),
  status TEXT NOT NULL CHECK (status IN ('considering', 'planned', 'in_progress', 'complete')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX site_roadmap_order ON site_roadmap_items(status, sort_order, created_at);
