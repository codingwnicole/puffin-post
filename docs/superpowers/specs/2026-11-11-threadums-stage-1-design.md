# Threadums Stage 1 — Tumblr Thread Tracker

## Intent

Threadums is a modern, mobile-first replacement for RPThreadTracker. It helps roleplayers and collaborative writers see the Tumblr threads they owe, organize them around characters, and avoid losing an ongoing scene in a sea of reblogs and drafts.

The first launch is private/invite-only for testing with Liz's Tumblr blogs, while its data model, authorization boundaries, and deployment shape support a later public launch. Discord tracking and the notification bot are deliberately Stage 2.

## Goals

- A responsive, accessible thread inbox that treats “what do I owe?” as the primary task.
- Tumblr-only thread tracking through Tumblr's supported API and OAuth flow.
- Accounts, workspaces, user-owned characters/blogs, partners, tags, starter posts, reply branches, statuses, and activity history.
- Thread status lanes: your turn, their turn, queued, archived.
- Optional character icons: uploaded portrait/icon when supplied, initials fallback otherwise.
- Light/dark themes with three paired palettes (rose, violet, ocean); respect system preference on first visit.
- Quick add, edit, archive, restore, filtering, search, tags, and CSV export.
- Background refreshes that identify new Tumblr activity for tracked posts and update the thread state without posting or modifying Tumblr content.
- Owner-controlled invite-only access at launch.

## Non-goals for Stage 1

- Discord connection, bot, DMs, server installation, or Discord notifications.
- Tumblr post creation, reblogging, liking, following, or any write operation on a user's behalf.
- AI writing, automatic reply generation, paid plans, or public marketing pages beyond a simple sign-in/early-access surface.
- Migration automation from RPThreadTracker. A CSV import can be scoped after we inspect a real export.

## Experience

The signed-in landing screen is an Inbox, not a giant legacy table. It starts with an answer: count of threads that need the user's reply. Each row shows the character icon or initials, title, partner, Tumblr source, last activity, and status. On desktop it has a focused sidebar; on mobile it becomes a bottom navigation bar and compact rows.

Threadums never requires character art. A character can be named and connected to one Tumblr blog; an optional cropped image may be uploaded to private object storage. Deleting an icon only falls back to initials and never deletes the character or thread data.

An open starter can have more than one participant. Threadums models that honestly: the starter owns the original post, character, shared tags, and shared description; every person who takes it gets a separate reply branch. A branch has its own partner, latest post, status, notes, activity history, and archive state. The inbox counts branches—not starters—so three people owed replies appear as three actionable items without making the user duplicate their starter three times.

## Architecture

### Chosen approach: Cloudflare-first app

- React + TypeScript frontend bundled with a Cloudflare Worker.
- Worker routes for the app API, Tumblr OAuth callbacks, authorization checks, and exports.
- Cloudflare D1 (SQLite) for relational application data.
- Cloudflare R2 only for optional character icons; URLs are served through a Worker authorization route rather than made publicly enumerable.
- Cloudflare Cron Trigger runs batched refresh work on a predictable schedule in UTC.
- Secrets (Tumblr consumer credentials, session/signing secrets, mail sender credentials) live in Cloudflare environment variables, never in the repository or D1.

This keeps the Stage 1 operating floor around Cloudflare's $5/month Workers paid plan once a dependable public beta needs scheduled work, with database and small icons comfortably inside included/free usage for a small product.

### Alternatives considered

1. **Supabase + Vercel:** excellent managed Postgres/auth experience, but more expensive once the app needs to stay awake and be dependable. Rejected for this project's bootstrapped public-beta stage.
2. **Railway + Postgres:** strong fit for a long-running Discord gateway later; more server operations than Tumblr Stage 1 needs. Deferred as the likely Stage 2 bot host.
3. **Private single-user app:** lowest build complexity, but would force an authorization/data-model rewrite before Threadums could serve others. Rejected.

## Core model

All user-owned rows include `workspace_id`; every database query must scope through membership before it reads or changes data.

| Record | Important fields |
|---|---|
| User | ID, email, display name, auth identity, created timestamp |
| Workspace | ID, name, owner user ID, invite-only setting |
| Membership | workspace ID, user ID, role (`owner` / `member`) |
| Invite | workspace ID, email, token hash, expiration, accepted timestamp |
| Tumblr connection | workspace ID, Tumblr OAuth token/secret encrypted at rest, Tumblr account metadata, status |
| Character | workspace ID, name, optional icon object key, color, active/hiatus state |
| Character blog | character ID, Tumblr connection ID, canonical blog identifier, display label |
| Partner | workspace ID, canonical Tumblr blog identifier, display label |
| Tag | workspace ID, normalized label, display label/color |
| Starter | workspace ID, character ID, title, source (`tumblr`), root post ID, root blog ID, shared description, created timestamp |
| Reply branch | workspace ID, starter ID, optional partner ID, status, branch notes, latest Tumblr post ID, last poster, last activity timestamp, last refresh timestamp, archived timestamp |
| Starter tag | starter ID, tag ID |
| Activity | workspace ID, starter ID, optional reply branch ID, type, actor/source, metadata JSON, timestamp |
| Refresh cursor | character blog ID, newest scanned post timestamp/ID, last successful refresh, error state |

## Tumblr behavior

1. A user connects Tumblr using three-legged OAuth on the server.
2. Threadums lists the blogs exposed by that connection; the user assigns a blog to one or more characters (multi-muse is supported).
3. A user adds a starter by choosing a character/blog and supplying a Tumblr root post URL or post ID. The Worker validates that the post belongs to that selected blog before saving it.
4. The user adds one reply branch for each participant who takes that starter. New participant branches can be added later without duplicating starter data.
5. A scheduled worker scans only connected, active character blogs in fair batches. It uses stored cursors and indexes rather than fetching an account's entire history every run.
6. On detected activity, Threadums writes an activity record and recalculates only the matching reply branch's state. It does not infer that every reblog deserves a reply without user confirmation; users retain a one-tap override to switch between “your turn” and “their turn.”
7. Refresh failures are visible in the connection/settings screen and never silently mark a reply branch as current.

### Initial refresh cadence

- Default: 30-minute batches for active connected blogs.
- User can manually refresh their own workspace, rate-limited at the API boundary.
- A global queue/cursor prevents one huge workspace from starving the others.
- The cadence and batch sizes remain configuration, not a user-facing “every N minutes” setting in Stage 1.

## Authentication and access

- Email/password or magic-link sign-in is selected during implementation based on the available Worker-compatible library; passwords, if used, are salted and hashed with an approved adaptive password hash.
- Registration is disabled by default. The owner creates invites; only accepted invitations can create a workspace membership.
- Session cookies are secure, HTTP-only, same-site, and rotated/invalidated on sign-out and credential changes.
- The initial owner account is seeded only through an explicit deployment-time command, never hard-coded.

## Pages and flows

| Page | Primary job |
|---|---|
| Sign in / invitation acceptance | Join the private beta safely |
| Inbox | See and act on reply branches needing a response; rows identify their shared starter |
| Your turn / Their turn / Queued / Archive | Dedicated filtered views, all backed by the reply-branch query model |
| Starter detail | Edit shared metadata/tags/source and see every participant branch |
| Reply branch detail | Edit the branch partner, status, notes, source link, activity history, archive/restore |
| Characters | Create/edit characters; attach Tumblr blog(s); optional icon upload/remove |
| Tumblr connections | Connect/reconnect, see blog state and refresh errors |
| Partners and tags | Lightweight organization controls |
| Settings | Theme, palette, account/security, notification preference placeholders |
| Export | CSV export scoped to the user's workspace |

## Reliability and safety

- API credentials/tokens are encrypted or stored as secrets; logs redact them.
- The app never stores a user's Tumblr password.
- OAuth callback state is validated and one-time use.
- R2 upload validation enforces image MIME types, maximum size, and generated object keys; the original file name is never trusted as a path.
- D1 schema indexes workspace/status/activity and Tumblr root-post lookups.
- Every scheduled refresh has error handling, backoff, and a visible “last synced” record.
- Exported CSV is formula-injection-safe by escaping cell values that begin with spreadsheet formula sigils.

## Testing and acceptance

- Unit tests: status transitions, starter/branch isolation, ownership checks, Tumblr URL/post-ID parsing, export escaping, palette persistence, initials fallback.
- Integration tests: invite acceptance, workspace isolation, OAuth callback state validation with mocked Tumblr responses, thread creation/refresh state updates.
- Browser checks: keyboard navigation, narrow mobile layout, light/dark contrast, icon upload/removal, and no client-side secret exposure.
- Real beta test: Liz connects test Tumblr blogs, creates several characters, a multi-reply open starter, and individual reply branches; posts/reblogs test replies; verifies refresh behavior and manual overrides before additional invites.

## Deferred Stage 2

Discord becomes a separate source adapter: Discord OAuth, bot installation, channel/thread bindings, WebSocket gateway worker, and configurable DM/server notifications. It should use the same generic `Thread.source` and activity concepts but has its own token, permission, and rate-limit boundaries. It likely belongs on a small always-on Railway service while Threadums' app and database remain on Cloudflare.

## Open implementation calls

- Choose the specific Worker-compatible authentication library after scaffolding and compatibility checks.
- Confirm a custom domain after the first beta works; a Cloudflare Pages/Workers subdomain is enough for private testing.
- Define the exact refresh-state heuristic from real Tumblr test posts, rather than hard-coding assumptions from the legacy tracker.
