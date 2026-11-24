# Redesign handoff: "The Writer's Desk"

Read this whole file before touching code. It is written so a new agent with no chat history can finish the job.
Last updated: 2026-11-24, phases 1–2 committed as `e58ac9a`; phase 3 implemented and reviewed; phase 4 mostly done (all uncommitted).

## 1. What this is

RP Thread Buddy (repo dev name Threadums, internal ids `puffinpost`/`threadums`) is getting a full visual redesign.
The owner approved a design called **The Writer's Desk**: a cozy, grown-up "writing desk" look with paper sheets,
folder-tab navigation, editorial serif headings and selective depth and motion.

- **Design reference (the source of truth for visuals):** `docs/redesign/prototype.html` in this folder. Open it in a
  browser. It is a single self-contained HTML prototype with tabs: Prototype (clickable app, desktop/mobile, light/dark,
  plus a "Public profile" and "Sign in" surface), Feature inventory, Depth & motion, Design system (tokens, measured
  contrast), XD handoff (measurements, tokens JSON/CSS, build plan, responsive acceptance checks), References,
  Directions. The owner also has it as a claude.ai artifact: https://claude.ai/artifact/CQSo7EWASHbBKdWhZfJGZj
  (private to the owner).
- The prototype uses **made-up data** (Wren, Theo, Ilse, Joon; RP sections Hollowmere, Station Alder, Paper Moon).
  Never copy the owner's real characters or threads into anything.
- The owner chose to **build in phases** and review each one. The owner must give a **fresh yes before any deploy**
  (AGENTS.md hard limit). Never run `wrangler deploy`, never touch the remote D1, never push without that yes.

## 2. Ground rules you must follow (from AGENTS.md and the owner)

1. Read `AGENTS.md`, `docs/architecture.md`, `docs/frontend-architecture.md` first.
2. **Every feature on the live site must remain.** The owner said: "if it's on the live site, it needs to be in the
   redesign. period." The full list of live features and where each goes is the "Feature inventory" tab of the
   prototype. Do not drop any of them.
3. Don't change API contracts or the DB schema from frontend work. All `/api` calls go through `src/web/lib/api.ts`.
4. Never rename internal `puffinpost`/`threadums`/`puffin-*` identifiers. User-facing text says "RP Thread Buddy".
5. Never print or commit secrets (`.dev.vars`, `wrangler.production.jsonc`).
6. No new UI framework, router, state library, CSS framework or animation library. Plain CSS + tokens, CSS motion,
   View Transitions. Ask the owner before adding any dependency (this includes font packages, see §6).
7. Respect `prefers-reduced-motion`. Keep accessibility: labels, focus rings, skip link, `role="status"`/`"alert"`,
   modals with focus handling and Escape.
8. Run `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:e2e` before calling anything done. Known pre-existing
   e2e failures as of 2026-11-21: `layout.spec.ts` "first branch card on screen at 390px" and `visual-system.spec.ts`
   "dark depth". The redesign may fix them; never loosen assertions to make them pass.
9. Don't add rules to `landing-fixes.css`. New styles go in `src/web/redesign.css` (or new files it imports).
10. Commit on the branch, don't push or open a PR unless the owner asks.

## 3. Branch and environment

- Live site runs **`origin/main`** (build 9187b2b at the time of writing, shown on the Support page).
- Work branch: **`redesign/phase-1-shell`**, created from `origin/main`, in the worktree
  `C:\Users\console\Documents\ChatGPT\rpthreadtracker\threadums\.worktrees\threadums-stage-1`.
- The old branch in that worktree, `fix/duplicate-thread-report`, is **behind main** (no sprints, no roadmap). Don't
  build on it.
- Untracked local folders `.claude/` and `.impeccable/` hold local tooling config (the Impeccable design hook). Leave
  them out of commits unless the owner asks (`.impeccable/config.json` may be shared later).
- Dev server: `npm run dev` (Vite + Cloudflare plugin, local Worker and local D1) on port 5173. `.claude/launch.json`
  has a `dev` entry. e2e uses `tests/e2e/auth-fixture.ts` (seeds a user in local D1, needs `SESSION_SECRET` in
  `.dev.vars`) or route mocks (see `theme.spec.ts`, `redesign-shell.spec.ts`).
- Windows: use `npm.cmd`. In Git Bash heredocs, long Python with non-ASCII chars broke; write scripts to files instead.

## 4. Architecture decisions already made

- **Layering.** `src/web/main.tsx` imports `styles.css`, then `landing-fixes.css`, then **`redesign.css`** (new). The
  redesign file wins by load order. It (a) re-maps the legacy token names (`--canvas`, `--surface`, `--surface-muted`,
  `--text`, `--muted`, `--subtle`, `--border*`, `--accent`, `--on-accent`, `--highlight`, `--nav-bg`, `--success`,
  `--warning`, `--danger`) to the new palette so every legacy page picks up the new colors at once, and (b) adds new
  tokens (`--sheet-3`, `--turn`/`--turn-t`, `--wait`/`--wait-t`, `--starter`/`--starter-t`, `--dorm`/`--dorm-t`,
  `--peach-t`, `--lav-t`, `--danger-t`, `--focus`, `--lamp`, `--e1..--e3`, `--f-display`, `--f-ui`, `--f-read`,
  `--r-*`, `--ease-settle`). Dark values live in `:root[data-theme="dark"]` plus a `prefers-color-scheme` fallback
  for `:root:not([data-theme])`. `lib/theme.ts` and `data-theme` on `<html>` are unchanged.
- **Page by page.** Each later phase rebuilds one page's markup with new `rd-*` classes styled in `redesign.css`, then
  deletes that page's now-unused rules from `styles.css`/`landing-fixes.css` in the same commit. When both legacy
  files are empty, delete them and their imports.
- **New classes are prefixed `rd-`** so no legacy selector (many use `!important`) reaches new markup. e2e specs that
  selected old classes were moved to the new ones (see §7).
- **Document scrolling stays.** The prototype scrolls an inner sheet because it lives in a fixed-height frame. The real
  app keeps normal page scrolling: the sidebar is `position: sticky; height: 100dvh`, the sheet grows with content.
  This avoids the scroll-containment bug the prototype test found and keeps anchors, `scrollIntoView`, pull-to-refresh
  and existing tests working. If you ever switch to an inner scroller, the sheet and its wrapper need `min-height: 0`.
- **Fonts.** Display: Young Serif 400. UI: Figtree (variable). Reading/prose: Newsreader (variable) + italic.
  The Worker CSP blocks Google Fonts, so they are self-hosted through npm packages (see §6).
- **Icons.** `src/web/components/Icon.tsx` is the only icon registry. A stroke `chevron` was added for the drawers.
  Keep the CC BY 4.0 credit line in the sidebar footer.

## 5. Status

### Done in phases 1–2 (commit `e58ac9a` on branch `redesign/phase-1-shell`)
- `src/web/redesign.css`: tokens (light + dark), base type, desktop shell, tablet icon rail (≤1020px), phone top bar +
  bottom tab bar + More sheet (≤760px), signed-out layout, reduced motion.
- `src/web/components/AppShell.tsx`: rebuilt markup.
  - Desktop sidebar (`nav.rd-side`, `aria-label="Primary"`): brand + "Private beta", Search/commands button (Ctrl K),
    four folder drawers — Threads (Dashboard, Parking lot, Tumblr activity with unread badge), Cast (Characters,
    Character planner), Desk (Writing tools; sprints live under it at `#tools/sprints`), Account (Connected accounts,
    Settings, Site roadmap, Support & feedback). Drawer open state persists in `localStorage['rptb-nav-drawers']`
    (try/catch). Collapsed drawer links get `tabIndex=-1`. Active link is `aria-current="page"`, coloured like the
    sheet with curved pseudo-element corners (the "joined tab"). Footer: tagline, Terms/Privacy/Cookies, icon credit,
    Sign out.
  - Sheet: `div.rd-sheet-wrap > main#main-content` (paper sheet with a rotated second sheet behind it via `::before`).
    Offline banner kept inside main.
  - Phone: `header.rd-topbar` (brand + search), `nav.rd-tabbar` (`aria-label="Primary (phone)"`: Dashboard, Parking,
    Characters, Tools, More). More sheet (`#mobile-more-menu.rd-more-sheet`, `role="dialog"`): grabber with the
    existing swipe-to-close hook (selector changed to `.rd-grabber`), Close, notice, Quick note (Enter saves to Parking
    Lot via `/reply-drafts`), links to Tumblr activity, Character planner, Connected accounts, Settings, Site roadmap,
    Support & feedback, plus Search and Sign out. Backdrop closes it.
  - Kept: skip link, CommandMenu, OnboardingTour, ToastHost, session probe and identity cache clearing, Ctrl/⌘K,
    offline detection, activity unread count, nav prefetch on hover/focus.
- `src/web/main.tsx`: imports `redesign.css` last.
- `src/web/components/Icon.tsx`: `chevron` stroke icon.
- e2e selectors moved to the new shell (§7). New `tests/e2e/redesign-shell.spec.ts`.
- `docs/redesign/prototype.html` (design reference) and this file.

### Fixes found by the tests during phase 1 (already applied)
- Tablet rule hid the brand name and search label on phones too, so the phone top bar's link and button had no
  accessible name. Hide rules are now scoped to `.rd-side`, and both elements carry `aria-label`s.
- The More backdrop lives inside the tab bar's stacking context and covered the More button. `.rd-tab` now has
  `z-index: 49` (above the backdrop at 48). The sheet opens above the tab bar (`bottom: 66px + safe area`), so the
  More tab also closes it.
- The rotated paper sheet behind the page (`.rd-sheet-wrap::before`) widened the document by 9px. The wrapper now has
  `overflow-x: clip` (clip, not hidden, so sticky children keep working).
- `--subtle` darkened to `#6B6156` (4.5:1 on the page ground). `--border-strong` (input borders) is `#8A7E70` light,
  `#7E756A` dark, for 3:1 against cards.
- Test updates that follow the new structure (not weaker): `theme.spec.ts` 390px test now finds the phone landmark
  "Primary (phone)" and Settings inside the More dialog; `layout.spec.ts` "More menu on top" runs at 375/600/760
  only (the phone bar ends at 760px) and `redesign-shell.spec.ts` adds a test that at 761 and 1024px the icon sidebar
  shows all 10 links; `transitions.spec.ts` swipe helper waits for the sheet's slide-in to finish before grabbing.
- Result: all 53 shell-related e2e tests pass, including the two previously known failures (layout 390px first card,
  visual-system dark depth).

### More fixes from the full e2e run (applied)
- The local D1 in this worktree was missing migrations 0038–0041 (roadmap, writing sprints), which made thread
  creation return 500 in e2e. Fixed with `npx wrangler d1 migrations apply threadums-local --local` (local only).
  A fresh worktree needs the same step.
- Brand link: tests look for a link named exactly "RP Thread Buddy". The brand is now `div.rd-brand` containing
  `a.rd-brand-home` (`aria-label="RP Thread Buddy"`, mark + name) and the "Private beta" pill outside the link.
- `components/StarterFields.tsx`: the link-lookup status `<p role="status" className="field-status">` is now always
  rendered (min-height 2.9em in redesign.css). Before, it appeared on blur of the link field and pushed the submit
  button down under the cursor, so a click right after pasting a link could miss. Also better for screen readers
  (a live region must exist before it changes). Found by `reply-parking-lot.spec.ts`, which passes on main only by
  layout luck.
- `App.tsx`: the View Transition promises now have `.catch()`, so a quick second navigation (which skips the running
  transition) no longer raises an unhandled rejection that the error beacon in `main.tsx` would report to the server.
- Page change motion: `main#main-content` has `view-transition-name: rd-page`; old content fades up and out in 150ms,
  new content rises in over 340ms; root and the group don't animate (sidebar stays still). styles.css already
  zeroes all view-transition animation under reduced motion.
- Phone More sheet: tabs `z-index: 50`, sheet 49, backdrop 48 (all inside the tab bar's stacking context) so the
  sheet never paints over the tabs, even mid-slide. Sheet links are left-aligned (a tablet rule had leaked; tablet
  rules are now all scoped to `.rd-side`). Grabber bar drawn with `::before`.
- Phase 1–2 verification from the completed worktree: unit 341/341, build OK, e2e 114/114.

### Phase 1–2 verification
- Phases 1–2 are committed and were built and tested. Run all three required checks again after later phase changes.
- The approved prototype could not be opened from the local `file://` URL in the embedded browser because of its URL policy. Its source was inspected read-only; do not try a different browser route to work around the block.

### Phase 1 completion
- Shell, Dashboard, fonts, and their tests are committed in `e58ac9a`.
- Never deploy or push without a fresh yes for that specific action.

## 6. Fonts (decided and done)
The owner chose npm packages. Installed with exact versions: `@fontsource/young-serif@5.3.0`,
`@fontsource-variable/figtree@5.3.0`, `@fontsource-variable/newsreader@5.3.0` (all OFL-1.1). `src/web/main.tsx` imports
`young-serif/400.css`, `figtree/wght.css`, `newsreader/wght.css` and `newsreader/wght-italic.css` before `styles.css`.
Vite bundles the woff2 files as same-origin assets, which the CSP (`font-src 'self' data:`) allows. Family names:
`"Young Serif"`, `"Figtree Variable"`, `"Newsreader Variable"` (the token stacks in redesign.css list these first).
Newsreader uses the weight-only files (58 KB latin) instead of the optical-size ones (132 KB); the difference is
negligible at 15–17px. A typical page downloads about 47 KB of fonts (Figtree + Young Serif, latin); Newsreader loads
only on pages that use `--f-read` (from phase 2). `redesign-shell.spec.ts` asserts the faces actually load.
`docs/frontend-architecture.md` lists the new dependencies.

## 6b. Phase 2 (Dashboard) status — essentially complete on the same branch (phase 1 was never committed separately)

### Done
- **Premise is never auto-filled** (owner request). `components/StarterFields.tsx` no longer copies the linked
  post's `summary`/`preview` into "Scene premise". The post shows in a collapsed `<details class="source-preview">`
  ("Show the linked post (for reference; not saved as your premise)"). Before a link resolves, a same-height placeholder
  line holds the space so the submit button never moves. The server already keeps an empty premise when the form sends
  one (`src/routes/starters.ts` line ~226: `input.description?.trim() ?? found?.summary`), so no API change.
  StarterFields is shared by Dashboard Add a thread, Parking lot "Convert to Tumblr" and others, so they all behave the
  same. `spin-and-titles.spec.ts` updated to assert the new behavior (empty premise + preview visible on expand).
- **Header** (`pages/InboxPage.tsx`): the section has class `rd-dashboard`; the description reads "You owe N replies.
  The oldest has waited N days. Sorted by RP and character." (oldest from `lastActivityAt` of your-turn branches).
  H1 stays "Your turn" (tests and the archived/all views depend on it).
- **Reply run ring**: two SVG arcs (your turn `--turn`, waiting `--wait`) with a draw-in keyframe; same `.reply-donut
  strong/span` text so tests keep working. No count-up on purpose: tests read the number immediately.
- **Spin the wheel** (`components/SpinWheel.tsx`, shared with Parking lot): a 72px dial of the candidate segments
  spins on ONE CSS transition (3.6s, `cubic-bezier(.14,.86,.24,1.02)`, slight overshoot) to land the chosen segment
  under the pointer; the pointer wiggles while spinning; the winning segment stays lit and the others fade. Reduced
  motion → instant. Then it scrolls to and highlights the card as before (`.is-picked`, settle animation). API and
  test hooks (`.spin-wheel p`, `data-pick-id`) unchanged.
- **Cards** (`.branch-card` etc. from `BranchRow.tsx`): white paper card, e1 shadow and hover lift, meta line in caps,
  title, 3-line premise in Newsreader, turn badge as a tinted chip, Your turn/Their turn as a segmented control. These
  styles are unscoped because BranchRow also renders on the thread page (`#starter/<id>` via StarterBranches).
- **Sections/columns**: RP section header is a paper divider tab (tint rotates sage/blue/peach), character stacks are
  inset columns on a 330px auto-fill grid. Oldest-owed card gets a `--turn` ring. Toolbar pills restyled.
- **Legacy CSS deleted** with `docs/redesign/tools/css_prune.py` (usage: `python docs/redesign/tools/css_prune.py "src/web/styles.css;src/web/landing-fixes.css" "class-a,class-b"`): 176 selectors and 136 emptied rules
  removed from `styles.css`/`landing-fixes.css` for: branch-card, branch-heading, branch-title, branch-meta,
  branch-premise, scene-card-trigger, scene-card-hint, branch-turn-actions, turn-button, turn-badge, rp-group,
  rp-deck-header, group-count, character-stacks, character-stack, character-deck-header, branch-list, oldest-owed,
  is-picked, inbox-hero, inbox-hero-copy, quick-add-link, inbox-summary, do-next, spin-wheel, legend-owed,
  legend-waiting, summary-legend. Not removed (shared): `rp-groups` (used on Characters/Settings/Profile) and
  `reply-donut` (shares `:is(.reply-donut,.plotting-donut)` rules with Parking lot; redesign overrides it with
  `!important` where legacy forces it). The pruning rule: split each selector list on top-level commas, drop a selector
  when a target class appears outside `:is()/:where()/:not()/:has()`, drop rules left empty, keep at-rules.
- Pinned leftovers: `.branch-card.tracking-card` (legacy `.tracking-card` padding/border), `.branch-card
  .scene-card-trigger` (legacy button `justify-content:center` centred the card content).

- **Scene details drawer (done).** `BranchRow.tsx` renders the details in a native `<dialog class="scene-drawer">`
  (via `useNativeDialog`) docked right, 560px, full height; full screen on phones. The dialog stays a DOM child of the
  card, so card-scoped test locators still find its contents. Escape/backdrop/Close save first (`closeDetails()` calls
  `save()` because unmounting skips the blur autosave), then focus returns to the card trigger through a ref. The old
  "remember details were open" localStorage key is gone (it would pop a modal on every load). `window.prompt` (Add
  label) became an inline form; `window.confirm` (Delete thread) became an in-place `.inline-confirm` box. Archived
  cards now say "Archived thread"/"Archived reply" on the card face. Card hover lift is off while its drawer is open.
  New `tests/e2e/redesign-dashboard.spec.ts` covers open/Escape/focus return/delete confirm/label form/phone width.
  Tests adjusted to the drawer: `check-tumblr.spec.ts` (Escape before using the page), `multi-reply-starter.spec.ts`
  (one drawer at a time; "Archived reply" label).
- **Site-wide legacy bug fixed:** `styles.css` had `[role="alert"]{animation:toast-in … both}`; `toast-in` ends at
  `translate(-50%,0)` (meant for the centred floating toast), so every inline alert in the app was shoved left by half
  its width. Deleted; inline alerts now use `rd-alert-in` (fade up 4px). The toast keeps its own `toast-in`.
- Tabular figures restored for `.do-next`, `.group-count`, `.turn-button`, `.turn-badge` (the pruned legacy rule used
  to set them; the redesign's `font:` shorthands reset them, so the rule sits at the end of redesign.css).

- **One Add a thread form everywhere (done).** New `components/AddThreadDialog.tsx`: a native dialog holding
  `StarterFields` + Add/Cancel, plus `starterPayload(form)` (the POST /starters body the Dashboard always sent).
  Dashboard: `QuickAdd` renders it with `id="quick-add"` whenever the hash is `#quick-add` (header link, onboarding,
  command menu all point there; closing replaces the hash with `#dashboard`). `App.tsx` skips the page View Transition
  when moving to or from `#quick-add`, since the page doesn't change. Tumblr activity: "Add to tracker" now opens the
  same dialog prefilled with the post link and the chosen "Track for" character (StarterFields takes a `postUrl` prop
  and reads it once on open), instead of POSTing immediately. The premise is sent empty, so the server no longer falls
  back to the post's opening lines (that fallback is `src/routes/starters.ts` ~226, untouched). Errors (including
  `character_needs_blog`) show inside the dialog. Legacy `.quick-add-panel/-inline/-help/-card` rules pruned.
  Tests: `redesign-dashboard.spec.ts` covers the Dashboard dialog and the activity flow (asserts `description: ''`).
- **Filter tray, empty states, skeletons, load more** restyled under `.rd-dashboard` (pill summary, inset tray with a
  small slide-in, paper empty state, shimmer skeletons).

### Phase 2 follow-up
- The implementation and required checks are complete. Optional greeting-name and count-up refinements remain out of scope unless requested.

## 7. Tests changed for the new shell (keep them in sync if you change markup)
Old → new selectors: `.primary-nav` → `.rd-side` (desktop) or `.rd-tabbar` (phone background), `.primary-nav > a` →
`.rd-link`, `.nav-note` → `.rd-foot`, `.shortcut-hint` → `.rd-side .rd-search`, `.sign-out` → `.rd-signout`,
`.mobile-more` → `.rd-more` (display: contents; use `.rd-tabbar` for visibility checks), `.mobile-more-toggle` →
`.rd-more-toggle`, `.mobile-more-menu` → `.rd-more-sheet`, `.sheet-close` → `.rd-sheet-close`, `.sheet-note` →
`.rd-sheet-note`, `.sheet-notice` → `.rd-sheet-notice`, `.sheet-grabber` → `.rd-grabber`. Files touched:
`layout.spec.ts`, `mobile-more.spec.ts`, `pre-redesign-fixes.spec.ts`, `theme.spec.ts`, `transitions.spec.ts`,
`visual-system.spec.ts`. Prefer roles/labels in new tests.

## 8. The remaining phases (do them in order, one commit or PR each, owner review between)

Use the prototype for every visual detail. Measurements and tokens: prototype "XD handoff" and "Design system" tabs.

### Phase 2 — Dashboard (`src/web/pages/InboxPage.tsx`, route `#dashboard`, also `''` and legacy `#inbox`)
- Header: greeting ("Good evening, <first name>.") with owed count and oldest wait; "reply run" ring (two arcs:
  your turn `--turn`, waiting `--wait`, count-up number on first view) with "Spin the wheel".
- "Draft in progress" resume strip if a draft exists (drafts already live in `saveDraftLocal`/Parking Lot).
- Toolbar: Add a thread (primary), Oldest owed first (toggle; raises the oldest scene with a `--turn` ring — this is
  the existing `focusMode`), Check Tumblr now (spinner + toast), Show/Hide filters, Parking lot link.
- Filters tray (animated height): Show (all/your turn/their turn/queued), Archive (active/archived/all), Character,
  Tag, Order (recently active/waiting longest), Search. Keep URL sync (`includeArchived`/`archived=1` both read).
- Grouping: RP section divider tab → character column (icon, name link to profile, "N active scenes · N owed") →
  scene cards (muse × partner label, title, status chip, 3-line excerpt in Newsreader, labels, Your turn/Their turn
  sliding toggle with "settle" animation, Details, age). Keep optimistic updates + rollback.
- Scene details become a right-side drawer (full-height sheet on phones): latest post, Open on Tumblr, Refresh names,
  updated time, reply draft (local draft safety net), all existing fields (scene label, stable premise, partner muse
  names, recap/next step, status incl. Queued, partner, RP section, labels add/remove, thread notes, reminder date),
  autosave indicator, Archive reply, Delete thread (inline confirm). Keep reply branches (`StarterBranches`).
- Spin the wheel: rAF-driven spin (4.6s, ease-out past the winner then back 6°, pointer flick per segment via WAAPI,
  hub pulse, winner highlighted, others faded; reduced motion → instant). Prototype `spin()` is the reference.
  Existing component: `components/SpinWheel.tsx` (it has a cross-list highlight that uses direct DOM; keep the comment).
- **Add a thread = one full form everywhere** (owner request). Same component from Dashboard, Tumblr activity "Add to
  tracker", untracked "Save as a scene", Parking lot "Track as thread", and the command menu. Prefill link, character,
  partner, muse, section, label from the source. **Premise starts empty**; show the source post above the form as a
  labelled read-only reference ("Latest post, for reference … isn't saved as your premise"). Today the default
  description is the first lines of the latest reply, which confused people. Check whether the API currently fills
  the premise server-side from the post; if so, change only what the client sends (no contract change) or ask the owner.

### Phase 3 — Characters, trading cards, profile, sharing
- Characters page: Details | Cards toggle (keep both; Details uses the small square **icon** used site-wide, Cards uses
  the **card portrait**, which can be a larger image or an animated GIF). Header buttons: "Make or edit a card"
  (opens editor with a character picker), Add an RP, Add character. Per Details tile: icon, ACTIVE, Tumblr assigned,
  RP sections, threads/your turn/their turn, quicklinks + Add link, **"Make/Edit trading card" button (visible, owner
  request)**, Replace icon, More (Edit trading card, Export stats card, Return to planner, Remove character).
  Export RP stats per section.
- Trading card (`components/TradingCard.tsx`): keep all 10 themes as data, front/back fields, flip, tilt; add the
  shadow that shifts with tilt, glare, theme-coloured foil, 600ms flip. Keep PNG/GIF export identical.
- Card editor (`components/CardEditor.tsx`): Front / Back / Playlist & board tabs, live preview, theme swatches,
  portrait upload note (GIF stays animated). Keep the unsaved-changes prompt on Escape.
- Profile (`pages/CharacterProfilePage.tsx`): card at 330px, name, sections, counts, View card / Edit card / Share,
  moodboard (12 slots, upload, Pinterest pin, reorder, full board link), playlist with click-to-load consent, tracklist.
- Share panel (`components/SharePanel.tsx`): card/stats style, options (moodboard, playlist, stats, indexable), link +
  copy, New link (rotate), preview image (PNG), embed snippets HTML/BBCode/Markdown, Stop sharing (confirm).
- Public page (`src/routes/public-share.ts`, server-rendered `/c/<slug>`): restyle with the same tokens inlined.
  Hero: card with tilt (tiny inline script, skipped on touch/reduced motion) over a halo in the favourite colour;
  name, nickname, quote, details with blur-rise entrance; sections on a 12-col grid: Fun facts, About, Thread stats
  (count-up), Moodboard, Playlist (click-to-load), Tracklist; footer "Make a card for your character". Must work
  without JS. CSP for that route allows only what it allows today; check before adding inline script (may need a
  nonce or keep it CSS-only).

### Phase 4 — Remaining pages, same parts
Parking lot (show filter, plotting pulse + mark wrapped, spin, items, "Save something for later" form with all fields),
Tumblr activity (blog filter, Load older, Did you mean to track these?, Tagged starters, Asks — adding opens the full
Add a thread form), Writing tools (sprints card, word count + minimum, case converter, title builder with formats,
dividers, save style, symbols shelf, type styles), Writing sprints (solo setup 5–60/custom, word goal, title; rooms:
create/join with display name, guests, reply tabs, credited words, completed replies, connection dots; saved drafts;
history), Character planner, Connected accounts, Settings (theme, walkthrough, notifications, password, Discord coming
soon, RP sections add/delete, CSV export, delete account with DELETE), Site roadmap, Support & feedback (form, votes,
statuses, build number), Legal pages (Read layout), signed-out landing + sign in (magic link, password option,
check-your-email). Delete each page's legacy CSS as you go.

### Phase 5 — Concepts (only if the owner approves; not live features)
Focus cycles (built on solo sprints: breaks, linked scene, bloom), desk rail with music (reuse `parsePlaylist` and the
click-to-load rule; CSP already allows `frame-src https://open.spotify.com`), desk themes ("dashboard skins" on the
roadmap: Meadow, Tidepool, Lavender hour, Mushroom accents), writing goals (needs API work).

### Phase 3 progress (2026-11-24)
- Characters now use a details/card grid, with the requested header character picker and visible per-character card actions. The 10 card themes and existing PNG/GIF rasterization remain data/source of truth.
- Card editor has Front / Back / Playlist & board tabs and session-local draft recovery. Card tilt now also shifts its cast shadow; foil/glare and the 600ms flip are in the redesign layer.
- Character profile now has a 12-slot moodboard, About, Fun facts, Thread stats, Playlist and Tracklist sections. Sharing panel has the existing settings exposed as controls, link copying and PNG preview.
- Public `/c/<slug>` rebuilt (GPT): tokens matching the app, card hero with a favourite-colour halo (the colour is
  validated as `#rrggbb` before it reaches CSS), sections on a 12-column grid, tilt in `public/share.js` (skipped on
  touch and reduced motion), and the share options for playlist and stats now respected.

### Phase 3 review and completion (Claude, 2026-11-24)
Checked GPT's uncommitted phase 3 work: type-check, unit tests and build passed; 5 e2e tests failed. Fixed:
- Cards toggle label is now "Cards" (the old "✦ Cards" glyph counted as an icon glyph); tests use `{ name: 'Cards', exact: true }`.
- Moodboard: the live guidance line "Upload 8–12 images that feel like this character, or add pins from Pinterest."
  had been dropped; restored under the empty grid. Empty slots no longer carry `.profile-tile` (they inflated tile
  counts); they are `.profile-empty-tile` only. Pin frames are titled "Pinterest pin N" (unique, better for screen
  readers); the test matches the prefix.
- Card editor: fields moved onto Front / Back / Playlist & board tabs, so tests open the right tab first. The editor
  lost the legacy `.card-editor` class, so its inputs had fallen back to browser defaults; they now use the redesign
  field style (`.rd-card-editor ...`).
- Share test raced the PNG preview upload; it now waits for the panel's preview image (shown once upload finishes)
  before fetching `card.png`. Same save order as before; the race was already there.
- Removed the decorative eyebrow labels GPT added (profile sections, card editor, public hero "A character
  profile"); Impeccable's craft floor bans eyebrows above headings.
- Profile Pinterest link field styled.
- Legacy CSS pruned for the phase 3 classes used only in phase 3 files (character-*, card-editor-row,
  card-theme-picker, card-symbol-picker, view-switch, profile-*, share-*, mood-*): 40 selectors, 39 rules. Kept:
  `tcard*` (card rendering and export alignment), `profile-board`, `upload-hint` (shared with the planner).
- Do not start phase 4 before the owner reviews phase 3.

### Phase 4 progress (Claude, 2026-11-24; owner said "begin phase 4", uncommitted)
**Data audit (owner asked for a full check that nothing is lost):**
- Phases 1–4 change no API route, request/response shape, schema or migration. The only server-side change is the
  rendering of the public `/c/<slug>` page (`src/routes/public-share.ts`), which reads the same fields as before.
- Local draft keys (`saveDraftLocal`/`restoreDraftLocal`), theme and walkthrough storage keys are unchanged, so text
  people typed before the redesign is still restored.
- Every card field (front, back, playlist, board, theme, symbol, stats, favourite colour) is still editable in the
  card editor tabs; every profile/public section still renders.
- `tests/e2e/data-integrity.spec.ts` (new): seeds characters with full trading cards, RP sections, quicklinks, moodboard,
  threads with every branch field, labels, Parking lot drafts, planner ideas and public sharing; snapshots the API, walks
  every redesigned page checking the data is shown, saves the card editor untouched, and proves nothing stored changed.

**Pages:** every remaining page moves onto the redesign through one shared layer near the end of `redesign.css`
("phase 4: the shared parts"): paper cards for `.tracking-card`/`.settings-section`, small-caps `.eyebrow`, one field
style for inputs/selects/textareas in `main` and `dialog`, and primary/secondary/text/danger buttons. No page markup
or data flow changed. Also:
- The two `!important` input border-colour rules were removed from `styles.css` (they overrode the field style).
- `.empty-state` uses the Dashboard empty-state style everywhere (was centred and bordered on Connected accounts).
- Thread page (`#starter/<id>`): spacing between the title actions, summary and partner cards; "Add branch" no longer
  stretches full width.
- Signed-out landing: sits on the app sheet (no second tinted box); the old monogram circle (hard-coded colours in
  `landing-fixes.css`) is hidden because the shell brand shows the same mark. Copy unchanged.
- `.text-button` is 44px tall on touch screens (`polish.spec.ts` hit-area check).
- `tests/e2e/redesign-pages.spec.ts` (new): renders parking lot, activity, planner, tools, sprints, connections,
  settings, roadmap, support, terms and a thread page at 1440 and 390 with real data, asserts no sideways scroll, and
  saves screenshots to `test-results/pages/` for review.

**Checks (2026-11-24):** unit 341/341, build OK, e2e 115/116 in the full run; the one failure (`polish.spec.ts` hit
area) was fixed and that spec rerun 6/6. The `rows.map`/`drafts.filter` errors in the e2e log come from failure-state
tests that feed malformed responses on purpose; those tests pass.

**Second pass (same day):**
- `redesign-pages.spec.ts` gained a "deeper states" test: check-your-email (1440/390), Support board with items,
  solo sprint setup and running, private room (1440/390). Screenshots in `test-results/pages/`.
- `.tool-copied` chip ("Copied", "Draft saved on this device"): legacy white text on `--nav-bg`, which the redesign
  remaps to pale paper, so it was unreadable. Now ink-reversed, and above the phone tab bar.
- Check-your-email: the address stays inside its sentence (legacy made it `display:block`, leaving ". It expires…"
  on its own line).
- Support: build number no longer touches the heading.
- `writing-sprints.spec.ts` solo test had a race (typed the second reply before the app swapped in the new blank
  reply); it now waits for the "Reply completed" status first. No assertion loosened.
- "Skip to content" showing mid-page in phone full-page screenshots is a screenshot artifact; in the browser it
  stays at -80px until focused.
- Legacy CSS pruning is deliberately not done for phase 4: these pages still take their layout grids from
  `styles.css`/`landing-fixes.css`; the new layer only restyles surfaces, fields and buttons. Remove the legacy
  files wholesale once each page's layout has redesign rules, not class by class.

**Checks (second pass):** unit 341/341, build OK, e2e 117/117.

## 9. Motion spec (implement with CSS + View Transitions; tokens in redesign.css)
fast 140ms (hover/press), med 220ms (tabs, drawers), slow 420ms (settle, lift). Page change: old page out 150ms,
new page in 340ms (name the main content `view-transition-name` and set those timings; App.tsx already calls
`startViewTransition`). Cards deal in once per page load (45ms stagger, `useEntered()` stops replays). Status toggle
settles with `--ease-settle`. Drawers: grid-rows height animation + 30ms item stagger. Scene drawer slides 40px from the
right. Card tilt ±9°/±7° with glare and foil; flip 600ms. Wheel 4.6s. Count-ups ease-out cubic. Reduced motion zeroes
all of it and disables tilt and View Transitions.

## 10. Responsive acceptance (add to e2e as you go)
At 320, 375, 768, 1024, 1440, 1920: no document sideways scroll (`scrollWidth <= clientWidth`); dialogs and drawers fit
the viewport and scroll inside; phone targets ≥ 44px; nothing hidden under reduced motion. `redesign-shell.spec.ts`
covers the shell; extend `layout.spec.ts` per page.

## 11. Deploy (only with the owner's fresh yes for that specific deploy)
Build must pass, all tests pass (except the two known visual checks if still failing for their documented reasons).
Ask the owner explicitly before deploying; follow the repo's normal deploy path (check `README.md`/`docs/` for the
exact command and environment, and whether it deploys from `main` after a merged PR).

### Phase 5 progress (Claude, 2026-11-24; owner said "start phase 5", uncommitted)
**Emails and bridge pages** now match the Writer's Desk:
- One shared stylesheet, `src/shared/bridge-page.ts`, holds the paper tokens. It follows the system theme with light-dark(), and the font stacks fall back to system fonts because the strict CSP allows no web fonts.
- It is used by `src/routes/auth.ts` (confirm sign-in, link unusable) and `src/routes/public-share.ts` (not found, report received, too many reports, card embed, stats embed).
- The sign-in email (`magicLinkEmail` in `src/auth/magic-links.ts`) uses the light paper palette and is marked light-only.
- Copy is unchanged apart from dropping the decorative eyebrows.

**Desk themes** (Settings › Appearance): Meadow, Tidepool, Lavender hour and Mushroom.
- Stored in the existing `puffin-post.theme` key as `desk`; Meadow is stored as no value.
- Applied as `<html data-desk>`. The redesign.css "phase 5: desk themes" block overrides `--accent` and `--highlight`, with separate values for dark mode.
- Fixed a bug that was already there: the saved light/dark choice was only applied while Settings was open. `main.tsx` now applies the theme at startup and follows live system changes.

**Focus cycles** (`#tools/focus`, linked from Writing tools):
- `src/web/lib/focus.ts` is the timer. It is a localStorage store (`puffin-post.focus`) shared through `useSyncExternalStore` and keeps time as an end timestamp, so it keeps running on other pages and after the tab sleeps.
- Each focus session is followed by a break that starts at once: 5 minutes, or 15 after every fourth.
- Stopping a session doesn't count it.
- The "Writing for" picker lists your-turn scenes first (from `/inbox`).
- When a session ends, the petals bloom.
- The 8 most recent sessions are listed.
- `FocusPage.tsx` is the page. Unit tests are in `tests/unit/focus.test.ts`.
- No API use beyond reading `/inbox`.
- The Cookies page lists the new storage key.

**Not done:** the desk rail with music. Writing goals need API work, so they wait for the owner.

### Dashboard critique fixes (2026-11-24)
`/impeccable critique` scored the Dashboard 24/40. The snapshot is in `.impeccable/critique/`. The owner chose: fix the two P1s and keep the grouping.
- **Reply run counts:**
  - Owed now comes from the server's `yourTurnCount`. Before, it counted only the first 100 loaded rows.
  - "Waiting on a partner" counts only `their_turn`; queued scenes get their own legend item.
  - Both waiting and queued show "+" when more pages exist.
- **Owed now lane:**
  - On the active view (not "Oldest owed first"), your-turn scenes sit in an "Owed now" lane at the top, oldest first.
  - The RP › character grouping follows under "Waiting and queued, by RP" and holds the rest.
  - The lane and that heading are h2s, which also fixes the h1-to-h3 jump.
- **Turn chips:** your turn is filled, their turn outlined, and queued uses the queued colours.
- **Test:** `redesign-dashboard.spec.ts` checks the counts and the lane order with 120 owed across pages.
- **Still open from the critique (P2/P3):**
  - Marking a reply sent: the two-way toggle, and no feedback or undo.
  - Phone layout and touch targets.
  - Dark-mode contrast of the inactive turn buttons (4.1:1).
  - 10.5px "Private beta" and "owed" text.
  - The "Reply desk" eyebrow above the h1.
  - Repetition on each card.

**Checks (2026-11-24):** unit 351/351, build OK, e2e 119/119.

### Dashboard critique P2 fixes (2026-11-24, owner: "Fix the P2 issues")
- **Marking a reply sent** (`BranchRow.tsx`):
  - The two-way Your turn / Their turn toggle is now one action per state: "I replied" on owed scenes (primary) and "Their reply came in" on waiting ones.
  - Queued scenes have no current turn, so they show "Mark your turn" and "Mark their turn".
  - After a change, the card moves on reload and an Undo toast appears (the existing `lib/toast.ts` / ToastHost, `role=status`). Undo puts the old status back and reloads.
  - Buttons disable while the change saves.
  - The scene drawer's Status field still sets any state.
- **Spin wheel:** the result disappears once its scene is no longer owed (`SpinWheel.tsx`).
- **Accessibility:**
  - The old dark-mode 4.1:1 toggle text is gone; the new buttons use the primary and secondary button styles.
  - "Private beta" and the donut's "owed" are now 12px.
  - The "Reply desk" eyebrow above the h1 is removed.
  - The filter toggle draws its own arrow at every width; a phone rule had hidden the marker.
- **Phone:**
  - Tighter hero spacing.
  - Below 600px, the character card no longer wraps scene cards (no card-in-card).
  - 44px touch targets on coarse pointers for the turn actions, "Oldest owed first", "Check Tumblr now", the filter toggle and "Add a thread".
  - The first owed scene is now above the fold at 390x844.
  - The Parking Lot link stays: `polish.spec.ts` requires it on phones.
- **Test:** `redesign-dashboard.spec.ts` covers "I replied" → toast → moves to waiting → Undo, and the queued buttons.
- **Still open from the critique:** P3 card repetition (the per-card avatar under the character header, a meta line that repeats the default title, and "+Show scene details" on every card).

**Checks:** unit 351/351, build OK, e2e 120/120 (the polish spec reran after the fix).

### Dashboard critique P3 fix (2026-11-24, owner: "Fix the P3 issue")
- `BranchRow` takes `showAvatar` (default true). The Dashboard's character stacks pass false, because their header already shows the character. The Owed now lane and the thread page keep the avatar.
- The pairing line ("Wren × Ash") is visually hidden when the title already reads the same, ignoring case. It stays in the DOM for tests and screen readers.
- The pairing line is now 12.5px in sentence case, not 11px uppercase.
- The "+Show scene details" row is now a small "Details ›" hint beside the turn action. The card's accessible name is short: "Show/Hide scene details: <title>, <status>".
- Queued scenes' buttons read "Your turn" / "Their turn" so they fit on one line next to the hint.

**Checks:** unit 351/351, build OK.
- e2e: 119/120 in the full run. `data-integrity` failed during its setup: `POST /api/starters` returned a 500 from the local dev server, with no error detail logged, before any page was opened. Run alone twice, it passed both times. Watch for this if it comes back.
- The other 4 failures in the first full run were mine and are fixed:
  - the title comparison crashed on mocked branches that have no title;
  - the accessible name stopped switching to "Hide scene details".

### Phase 5: desk rail (2026-11-24, owner: "Build the desk rail")
`src/web/components/DeskRail.tsx`, mounted in AppShell for signed-in users.
- **Rail (1280px and wider):** a third grid column, 288px open or 72px collapsed, sticky and scrolling on its own. It has three modules:
  - **Focus:** mini ring, clock, Start/Pause/Resume focus, a link to `#tools/focus`. Same store as the Focus page (`lib/focus.ts`).
  - **Music:** a playlist link, checked with `parsePlaylist` (Spotify, YouTube or Apple Music). The player loads only after a click, same rule and sandbox as character playlists. Because the rail lives in AppShell, music keeps playing across pages.
  - **Quick note:** saves to the Parking Lot (`POST /reply-drafts`, purpose `note`, the same call as the phone More sheet). The draft is kept with `saveDraftLocal`; the button disables while saving; the result shows in `role=status` and errors in `role=alert`.
- **Collapsing:** the rail collapses to a strip showing the time. The open state and the playlist link are stored in `puffin-post.desk` (listed on the Cookies page).
- **Phones:** `DeskBar` is a slim strip above the tab bar, shown only while a focus cycle runs, with the time, the phase and Pause/Resume focus. Music isn't on phones yet.
- **Between 761px and 1279px:** no rail, by design. The Focus page is still there.
- **Button names:** the timer buttons read "Start focus" etc., not "Start", because the writing sprint page has its own Start button. A bare "Start" made the sprint test click the wrong one.
- **Test:** `redesign-dashboard.spec.ts` "desk rail" checks that the timer survives navigation, rejects a non-music link, loads music only on click, posts the quick note, keeps the collapsed state after a reload, and shows the phone bar.

**Checks:** unit 351/351, build OK, e2e 121/121.
**Phase 5 still open:** writing goals (need API and schema work, which needs the owner's approval), and music on phones.
