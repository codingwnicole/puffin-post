-- T9a: track when a refresh run hit Tumblr's app-wide 429 (rate_limited on
-- refresh_runs) and when the next run may start again after a Retry-After
-- (rate_limited_until on the scheduler row, checked before a run starts).
ALTER TABLE refresh_runs ADD COLUMN rate_limited INTEGER;
ALTER TABLE refresh_scheduler_state ADD COLUMN rate_limited_until TEXT;
