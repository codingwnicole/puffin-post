ALTER TABLE reply_branches ADD COLUMN status_before_archive TEXT
  CHECK (status_before_archive IS NULL OR status_before_archive IN ('your_turn', 'their_turn', 'queued'));

-- Older archived rows predate status restoration metadata. Preserve an extant
-- turn state. Rows that only retain status='archived' return to the neutral queue.
UPDATE reply_branches
SET status_before_archive = CASE
  WHEN status IN ('your_turn', 'their_turn', 'queued') THEN status
  ELSE 'queued'
END
WHERE (status = 'archived' OR archived_at IS NOT NULL) AND status_before_archive IS NULL;
