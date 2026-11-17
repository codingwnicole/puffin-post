# Repair plan — 2026-11-16 (DRY RUN)

**Nothing has been run. Needs the owner's approval.**

Merge semantics come from `scripts/repair-thread-duplicates.ts`
(B10): per group, survivor = oldest row (created_at, then id); reply branches
re-point (on partner conflict the duplicate's branch is dropped, its activities
moved to the survivor's branch); tags re-point (INSERT OR IGNORE); activities
and drafts re-point; then the duplicate starter row is deleted. All statements
run in one atomic D1 batch.

## Case 1 — "Tagged starter from emerald0ceans" duplicates "ilyas x dimas"

The user's reblog of emerald0ceans' post is already tracked under
"ilyas x dimas" (root `starsashore.tumblr.com/831839486139842560`). The tag
starter (root `emerald0ceans.tumblr.com/831849840660054016`) tracks the same
thread via a different root. Two rows, one thread — collapse to one.

Look up the rows first:

```sql
SELECT id, workspace_id, created_at, title FROM starters
WHERE thread_root_blog_id = 'emerald0ceans.tumblr.com'
  AND thread_root_id = '831849840660054016';
-- call the result row: dup
SELECT id, workspace_id, created_at, title FROM starters
WHERE thread_root_blog_id = 'starsashore.tumblr.com'
  AND thread_root_id = '831839486139842560';
-- call the result row: keep
```

What happens: the newer of the two is deleted; its reply branches, tags,
activities, and converted drafts re-point to the older one. Whichever row is
newer is the one that disappears — its title/tags are the ones folded in.
Keep = the "ilyas x dimas" row (the one you named), whichever is older; the
"Tagged starter" row is `dup`. The two rows have different roots, so the B10
script will NOT pick this pair up on its own; it is a hand repair. Verify the two rows really are the same thread
before running (same characters, same replies); if the "Tagged starter" has
replies the other doesn't, they move over, nothing is lost.

Apply (ids from the SELECTs above; `ws` = the workspace id from either row):

```sql
UPDATE reply_branches SET starter_id = '<keep.id>'
  WHERE workspace_id = '<ws>' AND starter_id = '<dup.id>';
UPDATE activities SET starter_id = '<keep.id>'
  WHERE workspace_id = '<ws>' AND starter_id = '<dup.id>';
INSERT OR IGNORE INTO starter_tags (workspace_id, starter_id, tag_id)
  SELECT workspace_id, '<keep.id>', tag_id FROM starter_tags
  WHERE workspace_id = '<ws>' AND starter_id = '<dup.id>';
UPDATE reply_drafts SET converted_starter_id = '<keep.id>'
  WHERE workspace_id = '<ws>' AND converted_starter_id = '<dup.id>';
DELETE FROM starter_tags WHERE workspace_id = '<ws>' AND starter_id = '<dup.id>';
DELETE FROM starters WHERE workspace_id = '<ws>' AND id = '<dup.id>';
```

Note: the script's real apply also handles partner-conflicting branches
(drops the losing branch after moving its activities) and uses a
NULL-branch trick for FK safety; if either branch set on the duplicate
conflicts, run the script path (`REPAIR_THREAD_DUPLICATES=apply` semantics)
instead of hand-patching.

Undo: before running, back up the duplicate and everything pointing at it:

```sql
SELECT * FROM starters WHERE workspace_id = '<ws>' AND id = '<dup.id>';
SELECT * FROM reply_branches WHERE workspace_id = '<ws>' AND starter_id = '<dup.id>';
SELECT * FROM starter_tags WHERE workspace_id = '<ws>' AND starter_id = '<dup.id>';
SELECT * FROM activities WHERE workspace_id = '<ws>' AND starter_id = '<dup.id>';
SELECT * FROM reply_drafts WHERE workspace_id = '<ws>' AND converted_starter_id = '<dup.id>';
```

Save the results (e.g. to CSV). To undo: re-INSERT the starters row, then
re-INSERT the rows with their original starter ids from the backup, then
revert the re-pointed rows on the survivor back to `<dup.id>` where the
backup shows they came from the duplicate.

## Case 2 — two "Catherine Read" starters, no blog, no branches

`apxtropaic.tumblr.com/826609859511353344` and `apxtropaic.tumblr.com/825882541271760896`.
The character has no blog, and neither starter has reply branches. They track
two different posts with nothing behind them yet. Owner's choice: (a) delete
both, (b) keep them and assign Catherine Read a blog so refresh can find
replies. The SQL below is option (a).

Look up first:

```sql
SELECT id, workspace_id, created_at, title FROM starters
WHERE (thread_root_blog_id = 'apxtropaic.tumblr.com'
   AND thread_root_id IN ('826609859511353344', '825882541271760896'));
```

Confirm each has zero children before deleting:

```sql
SELECT COUNT(*) FROM reply_branches WHERE starter_id IN ('<id1>','<id2>');   -- must be 0
SELECT COUNT(*) FROM activities     WHERE starter_id IN ('<id1>','<id2>');   -- must be 0
SELECT COUNT(*) FROM starter_tags   WHERE starter_id IN ('<id1>','<id2>');
SELECT COUNT(*) FROM reply_drafts   WHERE converted_starter_id IN ('<id1>','<id2>');
```

If any count is non-zero, stop and re-plan (re-point those rows first, per
case 1's statements). Otherwise:

```sql
DELETE FROM starter_tags WHERE workspace_id = '<ws>' AND starter_id IN ('<id1>','<id2>');
DELETE FROM starters WHERE workspace_id = '<ws>' AND id IN ('<id1>','<id2>');
```

Undo: back up with the same SELECTs as case 1 (both ids), then re-INSERT from
the backup.

## After approval

- Run case 1, verify, then case 2 (or case 2 first — it's the simpler, fully
  reversible one; order doesn't matter since they touch different rows).
- Re-run the B10 dry-run after: it should report no duplicate groups (case 1 was never one of its groups, so check it by opening "ilyas x dimas").
- No deploy or push is part of this; SQL runs only against live D1 once
  approved, via the normal D1 access the owner already uses.
