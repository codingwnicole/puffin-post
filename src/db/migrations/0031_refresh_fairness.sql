-- Refresh fairness (T8f): one scheduler cursor now tracks the last workspace
-- handled, not the last character blog, so round-robin can skip already-seen
-- workspaces and hand each new workspace its single stalest target. The old
-- per-blog cursor is dropped: staleness is derived from refresh_cursors per
-- target at selection time instead.
ALTER TABLE refresh_scheduler_state DROP COLUMN last_character_blog_id;
ALTER TABLE refresh_scheduler_state ADD COLUMN last_workspace_id TEXT;
-- Per-run accounting: how many workspaces had at least one due target (due) and
-- how many targets this run actually refreshed (refreshed). Lets the owner see
-- starvation at a glance in the runs table without re-deriving it from cursors.
ALTER TABLE refresh_runs ADD COLUMN due INTEGER;
ALTER TABLE refresh_runs ADD COLUMN refreshed INTEGER;
