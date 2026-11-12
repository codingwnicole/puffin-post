# Threadums Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an invite-only, Tumblr-first Threadums beta where each user can organize characters, fan one starter into multiple reply branches, and reliably see the replies they owe.

**Architecture:** A React interface is served by a Cloudflare Worker running a small Hono API. D1 owns tenant-scoped relational data; R2 holds optional character icons; a Worker `scheduled()` handler refreshes Tumblr activity in fair batches. Magic-link authentication uses server-issued, hashed, single-use tokens and signed HTTP-only session cookies.

**Tech Stack:** TypeScript, React, Vite, Cloudflare Vite plugin/Workers, Hono, Zod, D1, R2, Vitest, Playwright, Wrangler, Resend HTTP API, Tumblr API v2/OAuth 1.0a.

**Spec:** `docs/superpowers/specs/2026-11-11-threadums-stage-1-design.md`

## Global Constraints

- Stage 1 supports Tumblr only; Discord, bot notifications, post creation, likes, reblogs, and follows are out of scope.
- Every user-owned database operation must be scoped by workspace membership; never trust a workspace, user, starter, or branch ID from the client.
- One Starter owns shared Tumblr root-post data, character, title, description, and tags; every ReplyBranch has independent partner, status, activity, notes, and archive state.
- Character icons are optional; all UI paths must render an initials fallback.
- First visit honors system light/dark preference; users can persist light/dark plus rose, violet, or ocean palette choices.
- OAuth tokens, encryption keys, session keys, and mail credentials live only in Worker secrets/environment bindings.
- Icons must be image-only, size limited, private in R2, and served only after membership authorization.
- Default scheduled refresh is `*/30 * * * *` UTC and must use a fair cursor/batch rather than attempt every blog at once.
- CSV exports must neutralize spreadsheet formulas.

## Review Focus

- A malicious user changing a URL ID must never read or mutate another workspace; Task 3 adds cross-workspace API integration tests.
- A starter with three active partner branches must yield three independent inbox rows and status counts; Task 5 adds this query/UI test.
- A valid Tumblr post URL from a different blog must be rejected before persistence; Task 6 adds parser and service tests.
- A failed refresh must preserve the last known branch state and expose the failure; Task 7 adds a simulated Tumblr 5xx test.
- An SVG, oversized, or cross-workspace icon request must never expose storage or execute markup; Task 8 adds upload/read authorization tests.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `vite.config.ts`, `wrangler.jsonc`, `tsconfig.json` | Build, Worker bindings, local development, cron configuration |
| `src/worker.ts` | Worker entrypoint, Hono application, scheduled dispatch |
| `src/shared/domain.ts` | Shared domain types and status/palette constants |
| `src/shared/validation.ts` | Zod request schemas and Tumblr post URL parsing |
| `src/db/migrations/*.sql` | D1 schema and indexes |
| `src/db/client.ts`, `src/db/repositories/*.ts` | D1 access, membership-scoped repositories |
| `src/auth/*.ts` | Magic-link, signed session, invite acceptance middleware |
| `src/routes/*.ts` | HTTP route modules by bounded feature |
| `src/tumblr/*.ts` | OAuth 1.0a client, connection flow, post normalization, refresh service |
| `src/refresh/*.ts` | Fair cursor selection and scheduled refresh runner |
| `src/storage/icons.ts` | R2 image validation, object key and authorized streaming |
| `src/export/csv.ts` | Formula-safe CSV serializer |
| `src/routes/reply-drafts.ts`, `src/web/pages/ReplyParkingLotPage.tsx` | Manual owed-reply queue and safe conversion into tracked Tumblr work |
| `src/web/*` | React application, theme state, page components, API client, styles |
| `tests/unit/*`, `tests/integration/*`, `tests/e2e/*` | Unit, Worker/D1, and browser tests |

### Task 1: Scaffold the Cloudflare React Worker application

**Files:**
- Create: `package.json`, `vite.config.ts`, `wrangler.jsonc`, `tsconfig.json`, `src/worker.ts`, `src/web/main.tsx`, `src/web/App.tsx`, `src/web/styles.css`
- Create: `tests/unit/status.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `Env` bindings for `DB`, `ICONS`, `APP_ORIGIN`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `TUMBLR_CONSUMER_KEY`, `TUMBLR_CONSUMER_SECRET`, `RESEND_API_KEY`, and `MAIL_FROM`.
- Produces: `createApp(env: Env): Hono` in `src/worker.ts` for integration tests.

- [ ] **Step 1: Write failing baseline tests**

```ts
it('exports the four valid reply statuses', () => {
  expect(REPLY_STATUSES).toEqual(['your_turn', 'their_turn', 'queued', 'archived'])
})
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npm test -- tests/unit/status.test.ts`

Expected: FAIL because shared domain exports do not exist.

- [ ] **Step 3: Scaffold the React + Vite Cloudflare Worker project**

Use the official React + Vite Worker starter shape. Define `Env`, configure local D1/R2 bindings, configure `*/30 * * * *` cron, render the app shell, and export `createApp(env: Env): Hono`.

- [ ] **Step 4: Add `src/shared/domain.ts` and pass the baseline tests**

Export `REPLY_STATUSES` and `ReplyStatus` with exactly the four values above.

- [ ] **Step 5: Verify the app and smoke page**

Run: `npm test && npm run build && npm run dev`

Expected: unit tests pass, build succeeds, and the smoke test sees the Threadums app shell.

- [ ] **Step 6: Commit**

```bash
git add package.json vite.config.ts wrangler.jsonc tsconfig.json src tests
git commit -m "feat: scaffold Threadums Worker app"
```

### Task 2: Create the tenant-safe D1 schema and repository boundaries

**Files:**
- Create: `src/db/migrations/0001_initial.sql`, `src/db/client.ts`, `src/db/repositories/workspaces.ts`, `src/db/repositories/starters.ts`, `src/db/repositories/branches.ts`
- Create: `tests/integration/repositories.test.ts`

**Interfaces:**
- Consumes: `Env['DB']`, `ReplyStatus`.
- Produces: `requireMembership(db, userId, workspaceId): Promise<Membership>`.
- Produces: `createStarter(input: CreateStarterInput): Promise<Starter>` and `createReplyBranch(input: CreateReplyBranchInput): Promise<ReplyBranch>`.
- Produces: `listInboxBranches(input: InboxQuery): Promise<InboxBranch[]>`.

- [ ] **Step 1: Write failing repository tests**

```ts
it('returns no branches belonging to another workspace', async () => {
  await seedBranch({ workspaceId: 'A' })
  await seedBranch({ workspaceId: 'B' })
  await expect(listInboxBranches({ workspaceId: 'A', userId: 'member-a' }))
    .resolves.toHaveLength(1)
})
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `npm test -- tests/integration/repositories.test.ts`

Expected: FAIL because migrations and repository functions do not exist.

- [ ] **Step 3: Implement migration `0001_initial.sql`**

Create users, workspaces, memberships, invites, Tumblr connections, characters, character blogs, partners, tags, starters, reply branches, starter tags, activities, and refresh cursors. Add indexes for `(workspace_id, status, archived_at)`, starter branch lookup, and Tumblr root/last-post lookups.

- [ ] **Step 4: Implement membership-scoped repositories**

Every public repository function accepts `userId` plus `workspaceId` and calls `requireMembership` before reading/writing. Never expose an unscoped `findById` to route code.

- [ ] **Step 5: Verify migration and repository isolation**

Run: `npm test -- tests/integration/repositories.test.ts`

Expected: migration applies locally and all workspace isolation tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/db tests/integration
git commit -m "feat: add tenant-safe thread data model"
```

### Task 3: Implement invite-only magic-link authentication and workspace provisioning

**Files:**
- Create: `src/auth/sessions.ts`, `src/auth/magic-links.ts`, `src/auth/invites.ts`, `src/routes/auth.ts`, `src/routes/invites.ts`
- Create: `tests/integration/auth.test.ts`
- Modify: `src/worker.ts`

**Interfaces:**
- Consumes: `Env['SESSION_SECRET']`, `Env['RESEND_API_KEY']`, `Env['MAIL_FROM']`, workspace repositories.
- Produces: `requireSession(c: Context): Promise<SessionIdentity>` and `requireWorkspace(c: Context): Promise<WorkspaceIdentity>`.
- Produces: `sendMagicLink(email: string, intent: 'sign_in' | 'accept_invite'): Promise<void>`.

- [ ] **Step 1: Write failing authentication tests**

```ts
it('rejects an expired or reused magic link token', async () => {
  const token = await issueMagicLink('test@example.com')
  await consumeMagicLink(token)
  await expect(consumeMagicLink(token)).rejects.toThrow('invalid magic link')
})
```

- [ ] **Step 2: Run the auth test to verify it fails**

Run: `npm test -- tests/integration/auth.test.ts`

Expected: FAIL because auth routes and token storage do not exist.

- [ ] **Step 3: Implement magic links and signed cookie sessions**

Store only a SHA-256 hash of each one-time token with an expiry. Sign sessions with HMAC using `SESSION_SECRET`; emit secure, HTTP-only, same-site cookies. The Resend sender is behind one small `MailSender` interface with a test fake.

- [ ] **Step 4: Implement invite acceptance**

Owner-issued invite tokens bind an email to a workspace membership. A beta invite provisions a user with their own private workspace unless an owner explicitly invites them to an existing shared workspace.

- [ ] **Step 5: Verify auth and authorization failures**

Run: `npm test -- tests/integration/auth.test.ts`

Expected: used, expired, mismatched-email, and cross-workspace tokens are rejected; accepted invite creates only the intended membership.

- [ ] **Step 6: Commit**

```bash
git add src/auth src/routes/auth.ts src/routes/invites.ts tests/integration/auth.test.ts src/worker.ts
git commit -m "feat: add invite-only magic link auth"
```

### Task 4: Build the responsive shell, themes, and user preferences

**Files:**
- Create: `src/web/lib/theme.ts`, `src/web/components/AppShell.tsx`, `src/web/components/ThemeMenu.tsx`, `src/web/components/InitialsAvatar.tsx`, `src/web/pages/InboxPage.tsx`
- Modify: `src/web/App.tsx`, `src/web/styles.css`
- Create: `tests/unit/theme.test.ts`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Produces: `ThemePreference = { mode: 'light' | 'dark' | 'system'; palette: 'rose' | 'violet' | 'ocean' }`.
- Produces: `<InitialsAvatar name={string} imageUrl?: string | null />`.

- [ ] **Step 1: Write failing theme and initials tests**

```ts
it('uses initials when a character has no icon', () => {
  expect(initialsFor('Parisa Farzaneh')).toBe('PF')
})
```

- [ ] **Step 2: Run theme tests to verify they fail**

Run: `npm test -- tests/unit/theme.test.ts`

Expected: FAIL because preference and avatar modules do not exist.

- [ ] **Step 3: Implement application shell and theme persistence**

Use CSS custom properties for all palettes. Honor `prefers-color-scheme` until the user chooses a mode, persist preference locally, and use a sidebar/bottom-nav responsive breakpoint.

- [ ] **Step 4: Implement icon-or-initial avatar rendering**

Render the authorized icon URL only when supplied; otherwise derive two initials from the character name and apply the character color.

- [ ] **Step 5: Verify narrow and light-mode behavior**

Run: `npm test -- tests/unit/theme.test.ts && npx playwright test tests/e2e/theme.spec.ts`

Expected: all three palettes retain readable light/dark contrast and a 390px viewport uses bottom navigation.

- [ ] **Step 6: Commit**

```bash
git add src/web tests/unit/theme.test.ts tests/e2e/theme.spec.ts
git commit -m "feat: add responsive themed application shell"
```

### Task 5: Deliver starter, multi-reply branch, and reply-parking-lot tracking

**Files:**
- Create: `src/db/migrations/0003_reply_drafts.sql`, `src/db/repositories/reply-drafts.ts`, `src/routes/starters.ts`, `src/routes/branches.ts`, `src/routes/reply-drafts.ts`, `src/web/components/BranchRow.tsx`, `src/web/components/StarterBranches.tsx`, `src/web/pages/StarterPage.tsx`, `src/web/pages/ReplyParkingLotPage.tsx`
- Modify: `src/web/pages/InboxPage.tsx`, `src/worker.ts`
- Create: `tests/integration/branches.test.ts`, `tests/integration/reply-drafts.test.ts`, `tests/e2e/multi-reply-starter.spec.ts`, `tests/e2e/reply-parking-lot.spec.ts`

**Interfaces:**
- Consumes: `createStarter`, `createReplyBranch`, `listInboxBranches`.
- Produces: `POST /api/starters`, `POST /api/starters/:starterId/branches`, `PATCH /api/branches/:branchId`, `GET /api/inbox`.
- Produces: `POST /api/reply-drafts`, `PATCH /api/reply-drafts/:draftId`, `POST /api/reply-drafts/:draftId/convert`, `GET /api/reply-drafts`.

- [ ] **Step 1: Write failing multi-reply tests**

```ts
it('shows each active branch from one starter as an independent inbox item', async () => {
  const starter = await createStarter(fixtureStarter)
  await createReplyBranch({ starterId: starter.id, partnerId: 'one', status: 'your_turn' })
  await createReplyBranch({ starterId: starter.id, partnerId: 'two', status: 'your_turn' })
  expect(await listInboxBranches(fixtureInboxQuery)).toHaveLength(2)
})
```

- [ ] **Step 2: Run branch tests to verify they fail**

Run: `npm test -- tests/integration/branches.test.ts`

Expected: FAIL because branch routes and response shape do not exist.

- [ ] **Step 3: Implement starter and branch API routes**

Validate requests with Zod. Allow branch-level partner, status, notes, and archive updates without rewriting starter fields. Return branch rows with starter title and character summary for inbox use.

- [ ] **Step 4: Implement inbox and starter-detail UI**

Inbox groups visually only when helpful but counts every branch independently. Starter detail presents shared metadata and a participant-branch list with add-branch control.

- [ ] **Step 4a: Implement the manual Reply Parking Lot and atomic conversion**

Create a workspace-scoped draft with optional character/partner, notes, source URL, and reminder. Conversion accepts the required Tumblr starter reference and optional branch data, creates the Starter/ReplyBranch in one transaction, marks the draft `converted`, stores the created IDs, and returns the existing conversion on retry rather than duplicating data. No Discord API, credential, or automated DM reading is added.

- [ ] **Step 4b: Implement the Reply Parking Lot UI**

Show open/overdue drafts, reminder date, optional source-link button, notes preview, archive action, and a conversion form that keeps the draft notes as branch notes unless the user edits them.

- [ ] **Step 5: Verify independent branch actionability and draft conversion**

Run: `npm test -- tests/integration/branches.test.ts tests/integration/reply-drafts.test.ts && npx playwright test tests/e2e/multi-reply-starter.spec.ts tests/e2e/reply-parking-lot.spec.ts`

Expected: changing one branch to archived does not change sibling branches; three active branches produce three Your Turn counts; a converted draft cannot create a duplicate starter/branch, retains its notes, and remains private to its workspace.

- [ ] **Step 6: Commit**

```bash
git add src/routes src/web tests/integration/branches.test.ts tests/e2e/multi-reply-starter.spec.ts
git commit -m "feat: track multi-reply starter branches"
```

### Task 6: Add Tumblr OAuth, connection management, and starter validation

**Files:**
- Create: `src/tumblr/oauth.ts`, `src/tumblr/client.ts`, `src/tumblr/normalize.ts`, `src/routes/tumblr.ts`, `src/routes/connections.ts`
- Create: `src/web/pages/ConnectionsPage.tsx`, `tests/unit/tumblr-url.test.ts`, `tests/integration/tumblr-oauth.test.ts`
- Modify: `src/shared/validation.ts`, `src/routes/starters.ts`

**Interfaces:**
- Produces: `parseTumblrPostReference(value: string): TumblrPostReference`.
- Produces: `TumblrClient.getPost(blogIdentifier: string, postId: string): Promise<TumblrPost>`.
- Produces: OAuth routes `GET /api/tumblr/connect` and `GET /api/tumblr/callback`.

- [ ] **Step 1: Write failing parser and callback tests**

```ts
it('rejects a Tumblr post reference whose blog differs from the selected character blog', async () => {
  await expect(validateStarterPost({ blog: 'mine', postUrl: 'https://other.tumblr.com/post/1' }))
    .rejects.toThrow('does not belong to the selected blog')
})
```

- [ ] **Step 2: Run Tumblr tests to verify they fail**

Run: `npm test -- tests/unit/tumblr-url.test.ts tests/integration/tumblr-oauth.test.ts`

Expected: FAIL because Tumblr modules and routes do not exist.

- [ ] **Step 3: Implement OAuth 1.0a and encrypted connection persistence**

Use a server-side HMAC-SHA1 signer. Encrypt token/secret with Web Crypto AES-GCM under `TOKEN_ENCRYPTION_KEY`; store ciphertext, IV, and key version in D1. Validate and consume OAuth state once.

- [ ] **Step 4: Implement connection and blog-assignment routes/UI**

List blogs returned by Tumblr only after a successful connection. Permit the same canonical blog to attach to multiple characters for multi-muse use.

- [ ] **Step 5: Enforce post ownership during starter creation**

`POST /api/starters` calls `getPost` and rejects a root post that is absent or belongs to another selected blog.

- [ ] **Step 6: Verify mocked OAuth and cross-blog validation**

Run: `npm test -- tests/unit/tumblr-url.test.ts tests/integration/tumblr-oauth.test.ts`

Expected: state replay fails, token ciphertext is not plaintext in D1, and a cross-blog URL is rejected.

- [ ] **Step 7: Commit**

```bash
git add src/tumblr src/routes src/shared/validation.ts src/web tests/unit/tumblr-url.test.ts tests/integration/tumblr-oauth.test.ts
git commit -m "feat: connect Tumblr blogs and validate starters"
```

### Task 7: Implement fair scheduled Tumblr refresh and branch activity updates

**Files:**
- Create: `src/refresh/cursor.ts`, `src/refresh/runner.ts`, `src/tumblr/refresh.ts`, `tests/integration/refresh.test.ts`
- Modify: `src/worker.ts`, `src/tumblr/client.ts`, `src/db/repositories/branches.ts`

**Interfaces:**
- Produces: `runRefreshBatch(env: Env, now: Date, limit: number): Promise<RefreshBatchResult>`.
- Produces: `refreshStarterBranches(input: RefreshInput): Promise<RefreshResult>`.

- [ ] **Step 1: Write failing refresh tests**

```ts
it('keeps the last known branch state when Tumblr fails', async () => {
  const branch = await seedBranch({ status: 'their_turn' })
  mockTumblr.getNotes.mockRejectedValue(new Error('503'))
  await runRefreshBatch(env, new Date(), 10)
  expect(await getBranch(branch.id)).toMatchObject({ status: 'their_turn', refreshError: '503' })
})
```

- [ ] **Step 2: Run refresh tests to verify they fail**

Run: `npm test -- tests/integration/refresh.test.ts`

Expected: FAIL because scheduled refresh services do not exist.

- [ ] **Step 3: Implement durable fair cursor selection**

Select a bounded ordered set of active character blogs after the persisted cursor, update the cursor only after the batch outcome is recorded, and skip characters marked hiatus.

- [ ] **Step 4: Implement branch-only activity reconciliation**

Normalize relevant Tumblr chain activity, append an Activity record, and update only the matching ReplyBranch. A known partner activity can propose the status transition; preserve manual override and record the detected event in history.

- [ ] **Step 5: Wire the `scheduled()` Worker handler**

Dispatch `runRefreshBatch` with `ctx.waitUntil`; no HTTP request can run arbitrary unbounded refresh work.

- [ ] **Step 6: Verify fairness, failure safety, and manual override**

Run: `npm test -- tests/integration/refresh.test.ts`

Expected: no blog starves across batches, 5xx retains last state, and manual status remains authoritative.

- [ ] **Step 7: Commit**

```bash
git add src/refresh src/tumblr src/db src/worker.ts tests/integration/refresh.test.ts
git commit -m "feat: refresh Tumblr reply branches on schedule"
```

### Task 8: Add characters, optional private icons, partners, tags, and filtering

**Files:**
- Create: `src/storage/icons.ts`, `src/routes/characters.ts`, `src/routes/partners.ts`, `src/routes/tags.ts`, `src/web/pages/CharactersPage.tsx`, `src/web/components/FilterBar.tsx`
- Create: `tests/integration/icons.test.ts`, `tests/integration/filters.test.ts`, `tests/e2e/character-icons.spec.ts`
- Modify: `src/worker.ts`, `src/web/pages/InboxPage.tsx`

**Interfaces:**
- Produces: `putCharacterIcon(input: IconUploadInput): Promise<CharacterIcon>` and `getAuthorizedCharacterIcon(input: IconReadInput): Promise<Response>`.
- Produces: `GET /api/inbox?characterId=&tagId=&status=&q=`.

- [ ] **Step 1: Write failing icon and filter tests**

```ts
it('rejects SVG icon uploads and denies another workspace icon read', async () => {
  await expect(putCharacterIcon(svgUpload)).rejects.toThrow('unsupported image type')
  await expect(getAuthorizedCharacterIcon(otherWorkspaceRequest)).rejects.toThrow('not found')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/integration/icons.test.ts tests/integration/filters.test.ts`

Expected: FAIL because storage and organization routes do not exist.

- [ ] **Step 3: Implement validated private icon storage**

Accept only JPEG, PNG, WebP, and GIF under the configured size cap. Generate an opaque object key from character ID plus random UUID; stream through a membership-checked Worker route.

- [ ] **Step 4: Implement character/partner/tag CRUD and inbox filters**

Character deletion is blocked while branches exist; icon deletion clears only the icon key. Normalize tags by lowercase label within a workspace while preserving display casing.

- [ ] **Step 5: Verify storage and organization behavior**

Run: `npm test -- tests/integration/icons.test.ts tests/integration/filters.test.ts && npx playwright test tests/e2e/character-icons.spec.ts`

Expected: unsupported files are rejected, missing icons use initials, and character/tag/status/search filters combine correctly.

- [ ] **Step 6: Commit**

```bash
git add src/storage src/routes src/web tests/integration/icons.test.ts tests/integration/filters.test.ts tests/e2e/character-icons.spec.ts
git commit -m "feat: organize threads and manage private character icons"
```

### Task 9: Implement archive, exports, last-sync visibility, and beta-owner controls

**Files:**
- Create: `src/export/csv.ts`, `src/routes/export.ts`, `src/routes/settings.ts`, `src/web/pages/SettingsPage.tsx`, `src/web/pages/ExportPage.tsx`
- Create: `tests/unit/csv.test.ts`, `tests/integration/settings.test.ts`, `tests/e2e/export.spec.ts`
- Modify: `src/routes/branches.ts`, `src/web/pages/InboxPage.tsx`

**Interfaces:**
- Produces: `toFormulaSafeCell(value: string): string` and `serializeWorkspaceCsv(rows: ExportRow[]): string`.
- Produces: `POST /api/branches/:branchId/archive`, `POST /api/branches/:branchId/restore`, `GET /api/export.csv`.

- [ ] **Step 1: Write failing archive and CSV tests**

```ts
it.each(['=2+2', '+cmd', '-sum', '@value'])('escapes spreadsheet formula %s', value => {
  expect(toFormulaSafeCell(value)).toBe(`'${value}`)
})
```

- [ ] **Step 2: Run export tests to verify they fail**

Run: `npm test -- tests/unit/csv.test.ts tests/integration/settings.test.ts`

Expected: FAIL because CSV and archive endpoints do not exist.

- [ ] **Step 3: Implement branch archive/restore and CSV export**

Export starter and branch columns separately so multi-reply starters remain intelligible outside Threadums. Scope all rows to the active workspace and escape formula-leading cells.

- [ ] **Step 4: Implement settings and beta owner controls**

Show connected Tumblr blogs, last successful sync, latest error, character hiatus toggle, theme preference, and owner-only invite issuance/revocation.

- [ ] **Step 5: Verify CSV safety and recovery controls**

Run: `npm test -- tests/unit/csv.test.ts tests/integration/settings.test.ts && npx playwright test tests/e2e/export.spec.ts`

Expected: archive/restore affects only one branch, export is formula-safe, and non-owners cannot issue invites.

- [ ] **Step 6: Commit**

```bash
git add src/export src/routes src/web tests/unit/csv.test.ts tests/integration/settings.test.ts tests/e2e/export.spec.ts
git commit -m "feat: add exports beta controls and sync settings"
```

### Task 10: Validate beta readiness and deploy the private Worker

**Files:**
- Create: `.dev.vars.example`, `docs/beta-runbook.md`, `docs/tumblr-test-script.md`
- Modify: `README.md`, `wrangler.jsonc`

**Interfaces:**
- Consumes: all prior tasks and Cloudflare deployment secrets/bindings.
- Produces: a private beta deployment plus a reproducible setup and Tumblr test procedure.

- [ ] **Step 1: Write the beta acceptance checklist**

Include: invite acceptance, Tumblr connect/reconnect, one starter with three branches, a new partner reblog/reply on one branch, manual override, icon fallback, mobile 390px check, light/dark/palette switch, refresh error visibility, archive/restore, and CSV download.

- [ ] **Step 2: Run full verification locally**

Run: `npm test && npx playwright test && npm run build`

Expected: all tests pass and a local Worker can exercise D1/R2 bindings.

- [ ] **Step 3: Configure production resources without committing secrets**

Create D1 database, R2 bucket, Worker secret bindings, custom-domain/subdomain configuration, and the cron trigger. Add only variable names to `.dev.vars.example`.

- [ ] **Step 4: Deploy privately and execute the Tumblr beta script**

Use Liz's test Tumblr blogs. Record failures in the runbook, not production secrets or OAuth tokens.

- [ ] **Step 5: Commit deployment documentation**

```bash
git add .dev.vars.example docs README.md wrangler.jsonc
git commit -m "docs: add Threadums private beta runbook"
```

## Self-Review

- **Spec coverage:** Tasks 1–4 cover platform, tenancy, access, themes, and responsive UI. Tasks 5–7 cover starter/branch behavior, Tumblr connection, refreshes, and activity safety. Tasks 8–9 cover optional icons, organization, exports, settings, invite controls, and error visibility. Task 10 covers real beta validation and private deployment. Discord is intentionally absent.
- **Step scan:** Each task begins with one executable failing test, names the exact production interface, then verifies and commits its independently reviewable increment.
- **Type consistency:** `Starter`, `ReplyBranch`, `ReplyStatus`, `createStarter`, `createReplyBranch`, `listInboxBranches`, and workspace-scoped identity appear consistently across repositories, API routes, and UI tasks.
- **Review focus:** Cross-workspace access is Task 2/3; multi-branch counts Task 5; cross-blog post validation Task 6; refresh failure retention Task 7; malicious/private icon handling Task 8.
- **Proportion:** The plan is task-specific without prescribing component bodies or CSS/SQL implementation details that the tests and interfaces already determine.
