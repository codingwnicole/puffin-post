-- Persist aggregate sprint results only; reply prose stays in the writer's browser.
CREATE TABLE writing_sprints (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('solo', 'room')),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0 AND duration_seconds <= 21600),
  words_credited INTEGER NOT NULL CHECK (words_credited >= 0),
  replies_completed INTEGER NOT NULL CHECK (replies_completed >= 0),
  goal_words INTEGER CHECK (goal_words IS NULL OR goal_words > 0),
  participant_count INTEGER NOT NULL DEFAULT 1 CHECK (participant_count >= 1 AND participant_count <= 32),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX writing_sprints_workspace_ended ON writing_sprints(workspace_id, ended_at DESC);
