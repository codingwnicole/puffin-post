CREATE TABLE support_comments (
  id TEXT PRIMARY KEY,
  support_item_id TEXT NOT NULL REFERENCES support_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX support_comments_item_created ON support_comments(support_item_id, created_at);
