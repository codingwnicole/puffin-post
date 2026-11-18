-- Per-invocation refresh lock so two overlapping scheduled refreshes for the
-- same workspace never double-fetch a blog. The runner inserts a row at the
-- start of a run (id = runId) and stamps finished_at when it completes. A
-- second run with the same id sees the live lock and bails out. Stale rows
-- (a run that crashed before stamping finished_at) age out via started_at.
CREATE TABLE refresh_runs (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX refresh_runs_started ON refresh_runs(started_at);
