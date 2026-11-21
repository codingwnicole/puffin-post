# RP Thread Buddy: recovery and rollback runbook

Last reviewed: 2026-11-21. This document covers D1 backups, restore limits, interrupted deploys, partial imports, and revision checks. Live D1 restores are destructive and require an approved maintenance decision.

## What we back up, and what that means

- Cloudflare D1 Time Travel is available automatically. It keeps history for **up to 30 days on Workers Paid (7 days on Workers Free)**. The production plan and database backend have not been verified from this workspace.
- Before a production migration, create a dated export with the actual database name from the uncommitted production Wrangler config:

  ```
  npx wrangler d1 export <production-db-name> --remote --output=.\backups\pre-migration.sql --config .\wrangler.production.jsonc
  ```

  Store exports outside Git in encrypted, access-controlled storage; they contain user records and authentication data. Do not run the export unless that storage is ready. The current workspace does not verify that production exports are being taken or retained.

## What can be tested safely

Cloudflare Time Travel restores a database **in place**. It cannot restore production history into a scratch database, so the previous scratch-restore instructions were incorrect. Cloudflare documents database branching/cloning as unsupported at this time.

Use a synthetic, non-production database to test migration and export/import procedures. Do not copy real beta-user data into a test database. That validates the procedure, but does not prove production point-in-time recovery. A production Time Travel restore has not been tested from this workspace.

The read-only check for a production point in time is:

```
npx wrangler d1 time-travel info <production-db-name> --timestamp "<ISO-8601>" --config .\wrangler.production.jsonc
```

## Production Time Travel restore

Stop and get explicit approval before this operation. It overwrites the named database in place and cancels in-flight queries. First take and securely retain a current export and record the current Time Travel bookmark. Then use the reviewed timestamp only during an approved maintenance window:

```
npx wrangler d1 time-travel restore <production-db-name> --timestamp "<ISO-8601>" --config .\wrangler.production.jsonc
```

Wrangler requires confirmation. Save the previous bookmark returned by the command so the restore can be undone if needed. Reconcile account-deletion requests made after the target time before reopening traffic.

## Deletion requests vs restores

When a user asks us to delete their account (or an export, or a workspace), the operator records the request in the support log — the email, the workspace ids, and the time it was completed — **not** in the database backup.

After any restore from a point before those deletions, re-apply every deletion listed in the support log that falls after the restore point. The backup does not know about deletions made after it; only the support log does.

Do not store the deletion list in D1: it would be restored along with the data and would recreate the problem.

## Partial imports and duplicate records

The Tumblr import can partially fail: a few threads import, a few duplicate, or an import that started with an old token leaves behind orphaned records. For the repair procedures, see `docs/repair-plan-2026-11-16.md`, which describes the exact SQL for finding and removing the duplicate rows the importer can leave behind, and the repair tests that verify the fix. The general rule: find the orphans by the unique key (thread_id, oauth user id), delete only the rows you can prove are the duplicates, and never bulk-delete by a guess.

## Interrupted deploys

- Review each migration before applying it. Worker rollback does not undo a D1 migration or a data backfill, so only roll back to a Worker version compatible with the schema now present.
- To roll the Worker back to the previous build without touching the database, run `wrangler rollback`. This redeploys the previous Worker version. Do not attempt to manually "down-migrate" D1 to match — the Worker does not depend on the new schema in a way that requires undoing it.
- Confirm the rollback worked by checking the live revision (below) and then hitting a known page.

## How to check the live revision

Every response from the live Worker carries an `X-Build-Revision` header. Fetch it:

```
curl -sI https://rpthreadbuddy.app/ | grep -i x-build-revision
```

Compare that value to the revision of the deploy you expect to be live (the `wrangler deploy` output shows it). If they disagree, the deploy you think is live is not the one serving traffic, and the Worker is still on the previous build (or a rollback happened and nobody noticed).

## Do not

- Do not run `wrangler d1 execute --remote` against the live database with any statement that is not part of a named migration.
- Do not assume Time Travel can restore into a scratch database; it restores the target database in place.
- Do not skip the pre-migration export because "the migration is small".
- Do not store deletion-request records in D1.
- Do not down-migrate D1 to match an older Worker.
