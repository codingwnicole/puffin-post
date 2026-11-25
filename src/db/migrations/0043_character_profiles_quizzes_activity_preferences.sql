-- Character profile drafts stay private on the character row. Publishing copies
-- an explicit snapshot to the share row, separate from the trading-card JSON.
ALTER TABLE characters ADD COLUMN profile_draft_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(profile_draft_json));
ALTER TABLE character_shares ADD COLUMN public_profile_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(public_profile_json));
ALTER TABLE character_shares ADD COLUMN public_profile_published_at TEXT;

CREATE TABLE character_quiz_sources (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, source_url)
);

CREATE TABLE character_quiz_results (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  quiz_source_id TEXT,
  result_title TEXT NOT NULL,
  result_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id, character_id) REFERENCES characters(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, quiz_source_id) REFERENCES character_quiz_sources(workspace_id, id)
);
CREATE INDEX character_quiz_results_character ON character_quiz_results(workspace_id, character_id, completed_at DESC);

-- Activity is scoped to one RP group and either the group, one character, or
-- one exact blog. Only Tumblr-confirmed user-authored replies count as verified.
CREATE TABLE rp_activity_requirements (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('group','character','blog')),
  character_id TEXT,
  blog_identifier TEXT,
  interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 90),
  reminder_before_hours INTEGER NOT NULL DEFAULT 24 CHECK (reminder_before_hours BETWEEN 0 AND 720),
  reminder_due INTEGER NOT NULL DEFAULT 1 CHECK (reminder_due IN (0,1)),
  reminder_overdue INTEGER NOT NULL DEFAULT 1 CHECK (reminder_overdue IN (0,1)),
  grace_hours INTEGER NOT NULL DEFAULT 0 CHECK (grace_hours BETWEEN 0 AND 720),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  allow_manual INTEGER NOT NULL DEFAULT 0 CHECK (allow_manual IN (0,1)),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, group_id) REFERENCES rp_groups(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, character_id) REFERENCES characters(workspace_id, id) ON DELETE CASCADE,
  CHECK ((scope='group' AND character_id IS NULL AND blog_identifier IS NULL) OR (scope='character' AND character_id IS NOT NULL AND blog_identifier IS NULL) OR (scope='blog' AND character_id IS NULL AND blog_identifier IS NOT NULL))
);
CREATE UNIQUE INDEX rp_activity_requirement_group ON rp_activity_requirements(workspace_id, group_id) WHERE scope='group';
CREATE UNIQUE INDEX rp_activity_requirement_character ON rp_activity_requirements(workspace_id, group_id, character_id) WHERE scope='character';
CREATE UNIQUE INDEX rp_activity_requirement_blog ON rp_activity_requirements(workspace_id, group_id, blog_identifier) WHERE scope='blog';

CREATE TABLE rp_activity_manual_logs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  activity_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id, requirement_id) REFERENCES rp_activity_requirements(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX rp_activity_manual_logs_latest ON rp_activity_manual_logs(workspace_id, requirement_id, activity_at DESC);

CREATE TABLE rp_activity_requirement_deliveries (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  reminder_kind TEXT NOT NULL CHECK (reminder_kind IN ('upcoming','due','overdue')),
  delivered_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, requirement_id, deadline_at, reminder_kind),
  FOREIGN KEY (workspace_id, requirement_id) REFERENCES rp_activity_requirements(workspace_id, id) ON DELETE CASCADE
);

ALTER TABLE notification_preferences ADD COLUMN global_muted INTEGER NOT NULL DEFAULT 0 CHECK (global_muted IN (0,1));
ALTER TABLE notification_preferences ADD COLUMN in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (in_app_enabled IN (0,1));
ALTER TABLE notification_preferences ADD COLUMN notify_activity INTEGER NOT NULL DEFAULT 1 CHECK (notify_activity IN (0,1));
ALTER TABLE notification_preferences ADD COLUMN notify_activity_requirements INTEGER NOT NULL DEFAULT 1 CHECK (notify_activity_requirements IN (0,1));
ALTER TABLE notification_preferences ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE notification_preferences ADD COLUMN quiet_start_local INTEGER CHECK (quiet_start_local BETWEEN 0 AND 23);
ALTER TABLE notification_preferences ADD COLUMN quiet_end_local INTEGER CHECK (quiet_end_local BETWEEN 0 AND 23);

-- Unread activity cues need per-member settings in a shared workspace.
CREATE TABLE user_activity_notifications (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seen_at TEXT,
  PRIMARY KEY (workspace_id,user_id,notification_key),
  FOREIGN KEY (workspace_id,user_id) REFERENCES memberships(workspace_id,user_id) ON DELETE CASCADE
);
CREATE INDEX user_activity_notifications_unread ON user_activity_notifications(workspace_id,user_id,seen_at);
INSERT OR IGNORE INTO user_activity_notifications (workspace_id,user_id,notification_key,created_at,seen_at)
  SELECT n.workspace_id,w.owner_user_id,n.notification_key,n.created_at,n.seen_at
  FROM activity_notification_deliveries n JOIN workspaces w ON w.id=n.workspace_id;

-- Sprint history belongs to the person who saved it, even in a shared workspace.
ALTER TABLE writing_sprints ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE writing_sprints SET user_id=(SELECT owner_user_id FROM workspaces WHERE workspaces.id=writing_sprints.workspace_id) WHERE user_id IS NULL;
CREATE INDEX writing_sprints_user_ended ON writing_sprints(workspace_id, user_id, ended_at DESC);
