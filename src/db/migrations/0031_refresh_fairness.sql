-- Refresh fairness (T8f): per-run accounting. due = eligible blogs across all workspaces
-- when the run started, refreshed = blogs this run actually refreshed.
ALTER TABLE refresh_runs ADD COLUMN due INTEGER;
ALTER TABLE refresh_runs ADD COLUMN refreshed INTEGER;
