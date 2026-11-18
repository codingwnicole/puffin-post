# Puffin Post: recovery and rollback runbook

Last reviewed: 2026-11-17. This document is the recovery plan for the live Puffin Post deployment on Cloudflare. It covers database backups and restores, interrupted deploys, partial imports and duplicate records, and how to tell which build is live. It is written to be run by the operator (Nicole @ the Puffin Post team) without a second person.

## What we back up, and what that means

- Cloudflare D1 Time Travel is the standing backup. D1 keeps a point-in-time history of the database for **up to 30 days**; after that, restored points fall out of the window and the deleted data is gone from backups.
- In addition, before every migration the operator runs a dated export of the database:

  ```
  wrangler d1 database puffin-post export ./backups/$(date +%Y-%m-%d)-pre-migration.sql
  ```

  (Adjust the path and the `d1 database puffin-post` reference to the real binding and DB id in the live project.) The export file is kept outside the repository.
- The D1 Time Travel window is the only safety net between two dated exports. If you skip the pre-migration export, you rely entirely on Time Travel and its 30-day horizon.

## Restoring into a separate database first

Never restore directly over the live database when the cause of the problem is unknown. The sequence is:

1. Create a throwaway database: `wrangler d1 create puffin-restore-check` (or reuse an existing scratch DB).
2. Restore into that database at the chosen time: `wrangler d1 time-travel restore --database-name <scratch-id> --timestamp <ISO-8601>`.
3. Run `wrangler d1 time-travel list --database-name <scratch-id>` and then spot-check tables (`wrangler d1 execute <scratch-id> --remote --command "SELECT count(*) FROM users"`, etc.) to confirm the restored state is what you expect.
4. Only after the scratch restore looks right, run the same restore against the live database.
5. Delete the scratch database when you are done: `wrangler d1 database delete <scratch-id> --yes`.

## Deletion requests vs restores

When a user asks us to delete their account (or an export, or a workspace), the operator records the request in the support log — the email, the workspace ids, and the time it was completed — **not** in the database backup.

After any restore from a point before those deletions, re-apply every deletion listed in the support log that falls after the restore point. The backup does not know about deletions made after it; only the support log does.

Do not store the deletion list in D1: it would be restored along with the data and would recreate the problem.

## Partial imports and duplicate records

The Tumblr import can partially fail: a few threads import, a few duplicate, or an import that started with an old token leaves behind orphaned records. For the repair procedures, see `docs/repair-plan-2026-11-16.md`, which describes the exact SQL for finding and removing the duplicate rows the importer can leave behind, and the repair tests that verify the fix. The general rule: find the orphans by the unique key (thread_id, oauth user id), delete only the rows you can prove are the duplicates, and never bulk-delete by a guess.

## Interrupted deploys

- Migrations are additive: every migration only adds tables or columns, and never drops or rewrites existing ones. A deploy that dies mid-migration leaves the database in a consistent state; it does not corrupt it.
- To roll the Worker back to the previous build without touching the database, run `wrangler rollback`. This redeploys the previous Worker version. Do not attempt to manually "down-migrate" D1 to match — the Worker does not depend on the new schema in a way that requires undoing it.
- Confirm the rollback worked by checking the live revision (below) and then hitting a known page.

## How to check the live revision

Every response from the live Worker carries an `X-Build-Revision` header. Fetch it:

```
curl -sI https://puffinpost.app/ | grep -i x-build-revision
```

Compare that value to the revision of the deploy you expect to be live (the `wrangler deploy` output shows it). If they disagree, the deploy you think is live is not the one serving traffic, and the Worker is still on the previous build (or a rollback happened and nobody noticed).

## Do not

- Do not run `wrangler d1 execute --remote` against the live database with any statement that is not part of a named migration.
- Do not restore Time Travel without first checking the state into a scratch database.
- Do not skip the pre-migration export because "the migration is small".
- Do not store deletion-request records in D1.
- Do not down-migrate D1 to match an older Worker.
