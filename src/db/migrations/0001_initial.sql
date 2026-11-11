CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  auth_identity TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  invite_only INTEGER NOT NULL DEFAULT 1 CHECK (invite_only IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id, workspace_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX invites_workspace ON invites(workspace_id, email);

CREATE TABLE tumblr_connections (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  token_encrypted TEXT NOT NULL,
  token_secret_encrypted TEXT NOT NULL,
  account_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(account_metadata_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'error')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, id)
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  icon_object_key TEXT,
  color TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'hiatus')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, id)
);

CREATE TABLE character_blogs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  character_id TEXT NOT NULL,
  tumblr_connection_id TEXT NOT NULL,
  blog_identifier TEXT NOT NULL,
  display_label TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, character_id, blog_identifier),
  FOREIGN KEY (workspace_id, character_id) REFERENCES characters(workspace_id, id),
  FOREIGN KEY (workspace_id, tumblr_connection_id) REFERENCES tumblr_connections(workspace_id, id)
);
CREATE INDEX character_blogs_connection ON character_blogs(workspace_id, tumblr_connection_id);

CREATE TABLE partners (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  blog_identifier TEXT NOT NULL,
  display_label TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, blog_identifier)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  normalized_label TEXT NOT NULL,
  display_label TEXT NOT NULL,
  color TEXT,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, normalized_label)
);

CREATE TABLE starters (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  character_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'tumblr' CHECK (source = 'tumblr'),
  root_post_id TEXT NOT NULL,
  root_blog_id TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, character_id) REFERENCES characters(workspace_id, id)
);
CREATE INDEX starters_character ON starters(workspace_id, character_id);
CREATE INDEX starters_tumblr_root ON starters(workspace_id, root_blog_id, root_post_id);

CREATE TABLE reply_branches (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  starter_id TEXT NOT NULL,
  partner_id TEXT,
  status TEXT NOT NULL DEFAULT 'your_turn' CHECK (status IN ('your_turn', 'their_turn', 'queued', 'archived')),
  notes TEXT NOT NULL DEFAULT '',
  latest_post_id TEXT,
  last_poster TEXT,
  last_activity_at TEXT,
  last_refresh_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, starter_id, id),
  CHECK ((status = 'archived' AND archived_at IS NOT NULL) OR (status <> 'archived' AND archived_at IS NULL)),
  FOREIGN KEY (workspace_id, starter_id) REFERENCES starters(workspace_id, id),
  FOREIGN KEY (workspace_id, partner_id) REFERENCES partners(workspace_id, id)
);
CREATE INDEX branches_inbox ON reply_branches(workspace_id, status, archived_at);
CREATE INDEX branches_starter ON reply_branches(workspace_id, starter_id);
CREATE INDEX branches_partner ON reply_branches(workspace_id, partner_id);
CREATE INDEX branches_tumblr_last_post ON reply_branches(workspace_id, latest_post_id);

CREATE TABLE starter_tags (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  starter_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (workspace_id, starter_id, tag_id),
  FOREIGN KEY (workspace_id, starter_id) REFERENCES starters(workspace_id, id),
  FOREIGN KEY (workspace_id, tag_id) REFERENCES tags(workspace_id, id)
);
CREATE INDEX starter_tags_tag ON starter_tags(workspace_id, tag_id);

CREATE TABLE activities (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  starter_id TEXT NOT NULL,
  reply_branch_id TEXT,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id, starter_id) REFERENCES starters(workspace_id, id),
  FOREIGN KEY (workspace_id, starter_id, reply_branch_id) REFERENCES reply_branches(workspace_id, starter_id, id)
);
CREATE INDEX activities_starter ON activities(workspace_id, starter_id, created_at);
CREATE INDEX activities_branch ON activities(workspace_id, reply_branch_id, created_at);

CREATE TABLE refresh_cursors (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  character_blog_id TEXT NOT NULL,
  newest_post_timestamp INTEGER,
  newest_post_id TEXT,
  last_successful_refresh_at TEXT,
  last_attempt_at TEXT,
  next_retry_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_error TEXT,
  PRIMARY KEY (workspace_id, character_blog_id),
  FOREIGN KEY (workspace_id, character_blog_id) REFERENCES character_blogs(workspace_id, id)
);
CREATE INDEX refresh_cursors_schedule ON refresh_cursors(next_retry_at, last_attempt_at);
