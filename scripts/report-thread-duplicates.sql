-- Read-only: lists tracked threads that are duplicates of an older starter in the same workspace.
-- Nothing is changed. Output has ids, dates and counts only (no titles or writing).
--
-- Two starters are the same Tumblr thread when one's post id appears in the other's thread
-- (its root, its own post, or a branch's latest reply). Tumblr post ids are globally unique,
-- so this is the same rule the app uses when adding a thread (findTrackedThread). It also
-- catches duplicates that scripts/repair-thread-duplicates.ts misses: starters created by
-- converting a Parking Lot draft never got a thread_root_id.
--
-- keep_id is the oldest starter; duplicate_id is the newer copy to merge into it.
--
-- Run against production (read-only, needs the owner's OK):
--   npx wrangler d1 execute DB --remote --config wrangler.production.jsonc --file scripts/report-thread-duplicates.sql --json
SELECT d.workspace_id,
  k.id AS keep_id, k.created_at AS keep_created_at,
  d.id AS duplicate_id, d.created_at AS duplicate_created_at,
  d.root_post_id AS matched_post_id,
  k.character_id = d.character_id AS same_character,
  (SELECT COUNT(*) FROM reply_branches b WHERE b.workspace_id = d.workspace_id AND b.starter_id = d.id) AS duplicate_branches,
  (SELECT COUNT(*) FROM reply_drafts r WHERE r.workspace_id = d.workspace_id AND r.converted_starter_id = d.id) AS duplicate_converted_drafts
FROM starters d
JOIN starters k ON k.workspace_id = d.workspace_id AND k.id <> d.id
  AND (k.created_at < d.created_at OR (k.created_at = d.created_at AND k.id < d.id))
WHERE d.root_blog_id <> 'manual' AND k.root_blog_id <> 'manual'
  AND (d.root_post_id IN (k.thread_root_id, k.root_post_id)
    OR d.thread_root_id IN (k.thread_root_id, k.root_post_id)
    OR k.root_post_id = d.thread_root_id
    OR EXISTS (SELECT 1 FROM reply_branches b WHERE b.workspace_id = k.workspace_id AND b.starter_id = k.id AND b.latest_post_id = d.root_post_id))
  -- Report each duplicate once, against its oldest match.
  AND k.id = (SELECT k2.id FROM starters k2 WHERE k2.workspace_id = d.workspace_id AND k2.id <> d.id AND k2.root_blog_id <> 'manual'
    AND (k2.created_at < d.created_at OR (k2.created_at = d.created_at AND k2.id < d.id))
    AND (d.root_post_id IN (k2.thread_root_id, k2.root_post_id) OR d.thread_root_id IN (k2.thread_root_id, k2.root_post_id) OR k2.root_post_id = d.thread_root_id
      OR EXISTS (SELECT 1 FROM reply_branches b WHERE b.workspace_id = k2.workspace_id AND b.starter_id = k2.id AND b.latest_post_id = d.root_post_id))
    ORDER BY k2.created_at, k2.id LIMIT 1)
ORDER BY d.workspace_id, k.created_at, d.created_at
