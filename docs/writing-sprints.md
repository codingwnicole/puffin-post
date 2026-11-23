# Writing Sprints

Writing Sprints supports solo timers and private multiplayer rooms. A session can hold several independent reply segments so a writer can copy, complete, clear, or reopen one reply without losing the session's reply count and credited-word snapshot.

## Where data lives

- Reply text, reply titles, character/thread associations, segment state, and the solo timer are stored in the browser's IndexedDB database `rpthreadbuddy-writing-sprints`. If IndexedDB is unavailable, the app falls back to localStorage keys with the `rpthreadbuddy-writing-sprint:` prefix.
- Browser storage is local to that browser profile. It is not included in account export or account deletion, and it can be lost if the browser clears site data. The page provides per-sprint delete controls; writers should use **Save to Parking Lot** when they deliberately want an account-backed copy. Parking Lot content follows its existing account deletion and workspace rules.
- A browser Web Lock prevents two tabs from editing the same session at once where supported. Browsers without Web Locks display a warning and should keep a sprint in one tab.
- Registered users can save history to D1. The strict API accepts title, sprint kind, timestamps, active duration, credited words, completed replies, optional goal, and participant count. It rejects additional fields and never accepts reply prose or segments. The migration is `0041_writing_sprints.sql`; rows are scoped to the current workspace and cascade when it is deleted.
- A room Durable Object stores the room name, hashed invite and participant tokens, optional salted PBKDF2 password hash, temporary display names, connection status, timer and rounds, and aggregate participant progress. It does not receive reply text, reply titles, character/thread selections, or raw passwords. Room access expires 24 hours after creation, and the scheduled alarm deletes the temporary state.
- Room invitations use a random 256-bit token. The browser keeps participant and invite credentials in sessionStorage so a tab can reconnect; leaving the room removes the participant reconnect token. Treat an invitation link like a private invite.

## Word credit

The shared helper `src/shared/writing-sprints.ts` counts whitespace-delimited words. Character-level attribution marks ordinary typed insertions only while the solo timer or room timer is running. Pasted/imported text and text entered while paused or stopped are not credited. A word counts only when all of its non-whitespace characters have a typed mark. Deleting text changes the current count; completing a reply freezes its credited count so clearing its prose does not erase the sprint total. Reopening a reply resumes counting from its current browser-side attribution mask.

This is a best-effort browser measure, not a tamper-proof proof of authorship. A participant can modify their browser or send false aggregate progress to a room. Room progress is presented as participant-reported totals, while the Durable Object controls the room timer, permissions, participant limit, and round snapshots.

## Room behavior and security

- Creating a room requires a signed-in workspace and is rate-limited. Joining is guest-friendly and does not require an account; join attempts are rate-limited by a keyed client-IP-and-room value.
- A room supports 2–32 participants. The host can start, pause, resume, end, configure, and advance rounds or remove guests. The room timer runs from the Durable Object's clock, not a participant browser clock.
- Tokens are hashed before durable storage. Passwords use a per-room random salt with PBKDF2-SHA-256. Guest names are stripped of control characters and capped at 32 characters.
- WebSocket connections require the configured app origin and a participant token. Messages are size-limited and validated; progress updates are rate-limited and accepted while a round is running or paused so the final browser count can flush after a pause. Counts cannot be lowered within a round. A disconnected host is transferred after 30 seconds.
- The API CSP permits a WebSocket connection only to the configured app origin. The route also checks the browser Origin before forwarding to the room object.

## Deployment

The checked-in `wrangler.jsonc` declares the `SPRINT_ROOMS` Durable Object binding and the `v1` SQLite class migration. The private production Wrangler config must retain both entries when copied from the checked-in config. Keep that private config out of Git.

Apply D1 migration 0041 with the existing D1 migration command in `beta-runbook.md`. Deploying Worker code with the `v1` migration creates the Durable Object namespace/class in the selected Cloudflare environment. Do not deploy until the production config points at the intended Worker and D1/R2 resources. A rollback should roll back Worker code only; do not remove or reverse an applied Durable Object migration.

## Verification

Relevant checks:

- `tests/unit/writing-sprints.test.ts`: counting, paste exclusion, frozen totals, and separate reply aggregation.
- `tests/integration/sprints.test.ts`: D1 workspace scoping, strict aggregate-only payloads, idempotency, room password checks, token reconnect, and capacity.
- `tests/e2e/writing-sprints.spec.ts`: solo persistence/history plus a two-client room check proving reply text stays private while progress is shared.
- Run `npm test`, `npm run build`, and `npm run test:e2e` from the isolated feature worktree before merging. Multiplayer WebSocket behavior should also be smoke-tested in a staging deployment before enabling the feature for beta users.
