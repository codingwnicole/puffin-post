# RP Thread Buddy architecture

One Cloudflare Worker (Hono) serves the API and the built React single-page app. D1 holds all data, R2 holds character icons, a cron trigger runs background sync.

## Modules

| Path | Responsibility |
| --- | --- |
| `src/worker.ts` | Wires routes under `/api`, security headers, same-origin check for writes, error handler, cron entry (`scheduled`). |
| `src/auth/sessions.ts` | Signed `__Host-` session cookie, expiry, revocation, membership checks. |
| `src/auth/magic-links.ts`, `passwords.ts` | Single-use email sign-in links, password hashing and sign-in. Passwords can be added after email-link sign-in. |
| `src/auth/moderator.ts` | Moderator check against the configured server-side user ID. |
| `src/auth/invites.ts` | Shared-workspace invites and owner checks. |
| `src/auth/rate-limits.ts` | Atomic D1-backed rate limits for sign-in, email requests and expensive calls. |
| `src/routes/starters.ts` | Add/resolve threads (reads the Tumblr post), titles, premise. |
| `src/routes/branches.ts` | Inbox, per-partner reply branches, status, archive/restore. |
| `src/routes/reply-drafts.ts` | Parking lot drafts and converting them to threads. |
| `src/routes/characters.ts`, `character-planner.ts` | Cast, archive/restore, icons, planner. |
| `src/routes/connections.ts`, `tumblr.ts` | Tumblr OAuth connect, blog list, blog-to-character assignment, disconnect. |
| `src/routes/tumblr-activity.ts` | Mentions and recent posts feed per blog. |
| `src/routes/groups.ts`, `partners.ts`, `tags.ts`, `title-styles.ts` | RP groups, partners, tags, title formats. |
| `src/routes/export.ts` + `src/export/csv.ts` | CSV export of the active workspace. |
| `src/routes/settings.ts` | Account settings and account deletion. |
| `src/routes/push.ts` | Web push subscriptions and due reminders (`sendDuePushes`). |
| `src/routes/support.ts`, `feature-suggestions.ts` | Support board and suggestions; email to the team via Resend. |
| `src/routes/client-errors.ts` | Redacted browser error reports. |
| `src/tumblr/client.ts` | The only code that calls api.tumblr.com (OAuth signing, timeouts, host allowlist, 429). |
| `src/tumblr/refresh.ts` | Whose turn it is, from a thread's reblog notes. |
| `src/tumblr/normalize.ts` | Post link parsing, blog identifiers, tag normalising. |
| `src/refresh/runner.ts` | Cron sync: picks blogs fairly, refreshes threads within budgets, backoff, push summary. |
| `src/storage/icons.ts` | R2 icon upload/download with workspace checks. |
| `src/db/migrations` | Schema, applied in order by wrangler (additive changes only once live). |
| `src/db/repositories` | Shared SQL for starters, branches, drafts, workspaces. |
| `src/shared/redact.ts` | Strips tokens, emails and writing from log lines. |
| `src/web/pages/*` | One page per hash route (Inbox, Parking lot, Characters, Planner, Connections, Activity, Settings, Support, Legal, thread page). |
| `src/web/lib/api.ts` | Fetch wrapper, per-user GET cache (cleared on sign-out and workspace switch). |

## Secrets

Worker secrets (never in git; local copies in `.dev.vars`): `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` (encrypts Tumblr tokens at rest), `TUMBLR_CONSUMER_KEY`/`SECRET`, `RESEND_API_KEY`, `PUSH_VAPID_PRIVATE_KEY`. Plain vars in Wrangler config: `APP_ORIGIN`, `MAIL_FROM`, `REFRESH_FETCH_BUDGET`, and `MODERATOR_USER_ID`. The moderator variable must contain an existing user ID; an unset value disables moderator actions. Tumblr tokens never leave the Worker.

## Workspace scoping

Every protected tenant-data route calls `requireWorkspace(c)`, which checks the session and current membership and returns `{ db, workspaceId }`. Public share pages, email-link confirmation, and the push public key are intentional public routes. Tenant-table statements filter by `workspace_id`; `tests/integration/tenant-scoping.test.ts` checks this (with an allowlist for cron and account deletion). Cross-user tests: `ownership.test.ts`, `cross-user.test.ts`, `tests/e2e/real-flows.spec.ts`.

New accounts are created through the email-link flow. Password sign-in is available for users who set a password after signing in by email. Public email-link sign-up is currently open; each verified address receives a private workspace.

## Cron sync

Every 30 minutes `runRefreshBatch` takes up to 60 blogs: rank 1 of every workspace first (stalest first), then rank 2, so a big account cannot starve a small one. Blogs in backoff (`refresh_cursors.next_retry_at`) are skipped. Per blog: one notifications call, one notes call per thread (shared across the character's blogs), one post read per new reply. Budgets: Tumblr fetches (default 30, `REFRESH_FETCH_BUDGET`) and D1 calls (800). A Tumblr 429 stops the run and holds the next one until Retry-After. Ceiling: Tumblr allows 1,000 calls/hour and 5,000/day for the whole app.

## Duplicated rules

Consolidated: none this pass (no duplicate was small enough and tested on both sides).
Left as is, for later:
- Turn status labels ("Your turn"/"Their turn") are written out in several components; T9d moves them to one component.
- Blog identifier normalising exists in `normalize.ts` and a private copy in `client.ts` (`blogNameToIdentifier`).
- Title suggestion logic lives in `starters.ts` and its hint text in `BranchRow.tsx`.
