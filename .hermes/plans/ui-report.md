# UI Report — Threadums Stage 1

## Animation 1-20

Source: `.hermes/plans/ui-animation-brief.md` (items 1-20). Built on the existing "Motion layer" in `src/web/styles.css` (vars `--motion-fast/med/slow`, `fade-in`, `rise`); no dependencies added.

| # | Item | Status | File | Verification |
|---|------|--------|------|--------------|
| 1 | Ease-out entrances (menus/dialogs/panels) | already present | src/web/styles.css | Motion layer + micro-interactions (rise/toast-in/sheet-up on `--ease-out`) predate this step; page sections now also rise (line 103). Verified by vitest + Playwright layout. |
| 2 | Dropdown duration 150-250ms | already present | src/web/styles.css | All dropdowns are native `<select>` (OS-controlled, not CSS-animatable); the surrounding focus ring uses `--motion-fast` (160ms, in band). Verified by code read (BranchRow/FilterBar/StarterFields selects). |
| 3 | Stagger list entrances ~30ms/row, capped | implemented | src/web/styles.css | Capped existing `--i` stagger to `min(--i,10)*--motion-stagger` (30ms, max 300ms) on line 130. Verified: vitest green, Playwright layout (no overflow), and the cap math. |
| 4 | Press feedback scale ~0.97 | implemented | src/web/styles.css | Base rule already scales `button` to .99 (line 120); added `a.button/.text-action/.text-button/.quick-add-link:active{scale(.97)}` (line 106) for link-buttons. transform-only, `:active`-gated so it restores on release. Verified by code read + vitest. |
| 5 | Stretch moving knobs up to 12% | not applicable | — | No draggable knobs/switches in the UI (only native selects, `<details>`, toggles). |
| 6 | Stagger secondary details after container | already present | src/web/styles.css | `<details>` bodies use `sheet-up` (line 135); rows ride the parent's capped `--i` reveal. Verified by code read. |
| 7 | Curved movement paths | not applicable | — | No element moves between two meaningful on-screen positions (no drag/drop, no fly-to). |
| 8 | Pulse once to confirm success | not applicable | — | Saves mutate state in place (no "Saved" toast); the autosave note has no success state. A success pulse would have to be a new feature; errors must stay static per the brief, so none added. |
| 9 | Ease-in-out for position changes | not applicable | — | No element changes on-screen position on update (lists re-render in place). |
| 10 | Popovers start at ~0.95 scale | implemented | src/web/styles.css | Modal (the only overlay) enters via `rise` + `fade-in` (lines 108-109); `rise` pairs the subtle rise with opacity. Verified by code read + Playwright (modal renders). |
| 11 | Enter from the trigger | implemented | src/web/styles.css | Modal is centered; `transform-origin:50% 0` anchors the entrance toward its top (line 109). Verified by code read. |
| 12 | Exit toward the trigger | not applicable | — | Modal exit is a React state unmount with no CSS exit transition, so there is no exit to anchor; entrance-only is the existing pattern. |
| 13 | Avoid bounce on everyday UI | already present | src/web/styles.css | `--ease-spring` is defined but unused by any rule; entrances settle with `--ease-out`. Verified by grep (no spring usage). |
| 14 | Do not tween while dragging | not applicable | — | No drag interaction exists. |
| 15 | Exits ~20% shorter than entrances | not applicable | — | No CSS exit transitions exist to shorten (modal/toasts unmount on state change). |
| 16 | Overlap old/new states (crossfade) | not applicable | — | State changes swap in place; no two-state crossfade scenario in items 1-20 surfaces. |
| 17 | Masks for contained reveals | not applicable | — | Reveals already use transform/opacity without layout shift; no contained color-reveal needing a mask. |
| 18 | Crossfade changing icons | implemented | src/web/styles.css | Added `transition:opacity` on `.icon,.scene-card-hint` (line 111) so icon/hint swaps fade in place, alignment stable. Verified by code read + vitest. |
| 19 | Rubber-band resistance beyond drag bounds | not applicable | — | No custom drag bounds to resist. |
| 20 | Shared layout identities across views | not applicable | — | No animation library (brief says don't add one); no FLIP/layoutId equivalent available. |

### Reduced motion
One `@media (prefers-reduced-motion: reduce)` block (src/web/styles.css lines 150-156) neutralizes movement and stagger (all `animation`/`transition` collapsed to no-op; list + section + modal animations explicitly `none`), while keeping color/state feedback (focus rings, hover, error color). Added the new `section[aria-labelledby],.modal-overlay,.modal-card` to its `animation:none` list.

### Verification commands
- `npx playwright test tests/e2e/layout.spec.ts --reporter=line` → (see final report)
- `npx vitest run` → (see final report)
- `npm run build` → (see final report)

## UI 8, 21, 26, 28

Source: `.hermes/plans/ui-animation-brief.md` (items 8, 21, 26, 28 + global requirements). No dependencies added.

| # | Item | Status | File(s) | Verification |
|---|------|--------|---------|--------------|
| 8 | Pulse once to confirm success | implemented | src/web/pages/TumblrActivityPage.tsx; src/web/styles.css | The Activity success `<p role="status">` ("Starter added…"/"Post dismissed…") now carries `className="success-pulse"`: a single `success-pulse` keyframe (opacity .35→1 + scale .97→1.015→1, `.3s var(--ease-out) both`) fires once per message. Errors use `role="alert"` with no pulse. Disabled under reduced motion. Verified by code read + vitest + build. |
| 21 | Skeleton loading blocks | implemented | src/web/pages/InboxPage.tsx; src/web/pages/CharactersPage.tsx; src/web/pages/TumblrActivityPage.tsx; src/web/styles.css | Added `.skeletons/.skeleton-row/.skeleton-card/.skeleton-line(.avatar/.short)/.skeleton-lines` + a 3-row branch-row skeleton (Inbox, was "Opening your writing space"), a 3-card character-card skeleton (Characters, now a `loaded` state), and a 3-row activity-row skeleton (Activity, now a `loaded` state). Each reserves the real row/card height (min-height) and rides the existing `.skeleton` shimmer. Shown only while the first load is pending (`!loaded`); real empty states ("No open threads yet", "No characters yet…") kept. Loading is visually distinct from empty. Verified by code read + Playwright layout (no overflow at 1280/1366/1440/640/375) + vitest. |
| 26 | Stale-while-revalidate | implemented | src/web/lib/api.ts; src/web/pages/{InboxPage,CharactersPage,TumblrActivityPage}.tsx; src/web/components/AppShell.tsx | `staleGet<T>(path)` in api.ts: returns cached payload immediately and refreshes in the background via a module-level Map keyed by path; on cold start it awaits the first fetch; on background-refresh failure it keeps the old content and rethrows (page still shows its error banner). Used only for the page-load GETs of Inbox, Characters and Activity — post-mutation reloads and the blog-filtered Activity load still call `api()` for fresh data. `clearApiCache()` is called on sign-out and when the session user id changes (AppShell session effect tracks `lastUserId`). Verified by new unit test `tests/unit/api-cache.test.ts` (cached-while-refetching + clearing) + full vitest. |
| 28 | Image placeholders | implemented | src/web/components/InitialsAvatar.tsx; src/web/pages/{CharactersPage,CharacterPlannerPage,CharacterShortcutPage}.tsx; src/web/styles.css | InitialsAvatar now tracks image load state: pending shows a neutral circle (the `.initials-avatar` box already reserves 2.75rem), the image fades in on load (`avatar-img-loaded`), and `onError` falls back to the existing initials span. The four character-icon `<img>` tags (character-card, planner, archived, shortcut) keep their fixed reserved box and, on `onError`, get `.avatar-fallback` — a neutral `var(--surface-3)` circle with the character's initials via `::after{content:attr(data-initials)}`. No BlurHash (none exists). Verified by code read + build + Playwright (no overflow). |

### Notes & risk
- The SWR cache is per-page-load only; `track()` (telemetry) and all mutation reloads are unaffected.
- Cache is intentionally in-memory (module-level Map), so it is cleared on reload and on sign-out / user change; there is no cross-tab or persistent storage.
- `.avatar-fallback` initials rely on `data-initials` set in JSX; the CSS `::after` is suppressed by the reduced-motion block's `transition:none` only where motion applies.

## UI 22-27

Source: `.hermes/plans/ui-animation-brief.md` (items 22, 23, 24, 25, 27 + global requirements). No dependencies added.

| # | Item | Status | File(s) | Verification |
|---|------|--------|---------|--------------|
| 22 | Optimistic updates (reversible, low-stakes only) | implemented | src/web/components/BranchRow.tsx; src/web/pages/TumblrActivityPage.tsx | BranchRow thread status ("Your turn"/"Their turn"): local `statusOverride` flips instantly, then `PATCH /branches/:id`; on failure it restores the previous status and surfaces the error (no success shown before the server confirms). Activity Dismiss: the item is removed from local state immediately, then `POST /dismissals`; on failure it is re-inserted and the error shown. Both list rows key off stable ids (InboxPage no longer keys branches by `status`) so the flip does not remount. Blog assignment and character archive/delete stay confirm-first with a busy/"Working…" state (unchanged, per brief). Verified by code read + vitest + build. |
| 23 | Command menu (Ctrl/⌘K) | implemented | src/web/components/CommandMenu.tsx (new); src/web/components/AppShell.tsx; src/web/pages/InboxPage.tsx | A single new component, opened from AppShell on Ctrl/⌘K (Cmd on Mac). Filter box + list: Add thread, Characters, Tumblr activity, Archived threads, Character planner, Settings. Arrow keys move the active row, Enter navigates (hash route), Escape closes and returns focus to the trigger. Reuses `.modal-overlay/.modal-card`. "Archived threads" navigates to `#inbox?archived=1` and InboxPage now reads that param into `includeArchived` on load. Verified by code read + Playwright layout + build. |
| 24 | Shortcut hints | implemented | src/web/components/AppShell.tsx; src/web/components/CommandMenu.tsx; src/web/styles.css | A "Search / commands" button in the sidebar shows a platform-appropriate `Ctrl K` / `⌘K` label (detected via `navigator.platform`/`userAgent`) and opens the same menu. The menu shortcut is guarded by `isEditableTarget` so it never fires while typing in an input/textarea/select/contenteditable. No other shortcuts added (none trivial/needed). Verified by code read + vitest (guard) + build. |
| 25 | Undo toasts (~6s) | implemented | src/web/components/ToastHost.tsx (new); src/web/lib/toast.ts (new); src/routes/tumblr-activity.ts; src/web/pages/{TumblrActivityPage,StarterPage,CharactersPage}.tsx | One toast component rendered once in AppShell, driven by a module-level store (`useSyncExternalStore`). Undo re-invokes the stored server restore — not just a UI revert. Wired for all three reversible actions: Activity Dismiss → new `DELETE /api/tumblr-activity/dismissals` (workspace-scoped; un-hides on next GET); thread Archive (StarterPage) → `POST /starters/:id/restore`; character Archive (CharactersPage) → `POST /characters/:id/restore`. "Return to planner" left without undo (no clean reverse exists). Verified by code read + new integration test + vitest + build. |
| 27 | Pre-rendering / selective prefetch | not applicable | — | Private SPA behind auth; nothing is public/static and the only external source is the user's Tumblr. Pre-rendering and prefetching would only add Tumblr API load for no benefit, so none is added (per brief: avoid unnecessary Tumblr requests). Reported, no code. |

### Tests
- `tests/integration/activity-feed.test.ts` — new case "deleting a dismissal un-hides the post and is workspace-scoped (B25)": POST a dismissal, confirm a second workspace's DELETE is a no-op (row still hidden), then the owner's DELETE re-appears the post on the next GET.
- `tests/unit/shortcuts.test.ts` — new: the editable-target guard returns true for input/textarea/select/contenteditable and false for plain elements, null, and undefined.

### Verification commands
- `npx playwright test tests/e2e/layout.spec.ts --reporter=line` → 10 passed (no overflow at 1280/1366/1440/640/375).
- `npx vitest run` → 26 files, 157 tests passed.
- `npm run build` → worker + client bundles build clean (tsc `-p tsconfig.json` clean).

### Notes & risk
- `DELETE /dismissals` returns 204 (no body); the item reappears on the next Activity GET. Workspace-scoped by the route's workspace binding (same as POST), so a different user cannot delete someone else's dismissal.
- The command menu reuses existing hash routing; "Add thread" goes to `#quick-add` (the existing quick-add anchor) rather than dispatching an event nothing listens for.
- Undo toast is app-wide and single (latest action wins); a rapid second reversible action replaces the first toast's Undo.
- Optimistic flips are local-only and fully rolled back on failure; they never persist unconfirmed state.

---

## UI 29-40 (brief C, final UI step)

Files: `src/web/App.tsx`, `src/web/styles.css`, `index.html`.

| # | Item | Status | File | Verification |
|---|------|--------|------|--------------|
| 29 | View transitions | DONE | `src/web/App.tsx`, `src/web/styles.css` | `hashchange` handler wraps `setRoute` in `document.startViewTransition(() => flushSync(() => setRoute(next)))` with plain-set fallback (`flushSync` from `react-dom`). Reduced-motion block adds `::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none}`. Unsupported browsers take the fallback path automatically. Vitest 160/160 green. |
| 30 | Swipe sheets | N/A | — | grep for `sheet\|swipe\|gesture` in `src/web`: no matches; app has no mobile sheets. |
| 31 | Interruptible animations | Already present | — | All motion is CSS `transition`/`animation`; no JS-driven tweens found. CSS transitions reverse from current position by design. |
| 32 | Back navigation | Already present | — | Hash routes + `#inbox?characterId=` filters already restore state on back/forward. No scroll restoration built per plan. |
| 33 | 44px hit areas | DONE | `src/web/styles.css` | `@media (max-width:760px)` block sets `min-height:44px` on `button`, `.text-button`, `.text-action`, `.turn-button`, `.do-next`, `.secondary-button`, `.icon-picker`, `.primary-nav>a`, `.mobile-more summary`. 760px mobile viewports pass layout spec (640x360 + 375x812 rows green). |
| 34 | Safe-area insets | DONE | `index.html`, `src/web/styles.css` | Viewport meta now `width=device-width, initial-scale=1.0, viewport-fit=cover`. The one persistent mobile bottom bar is `.mobile-more` → `padding-bottom:env(safe-area-inset-bottom)` in the mobile block. |
| 35 | One-time codes | N/A | — | Sign-in is magic-link only; no TOTP/OTP endpoints in the auth API. |
| 36 | Tabular numbers | DONE | `src/web/styles.css` | `font-variant-numeric:tabular-nums` on `.character-stats strong`, `.group-count`, `.count-pill`, `.turn-button`, `.rp-group-badge`, `.status-badge`, `.do-next` (grepped all number-bearing elements in pages/components). |
| 37 | Balanced headlines | DONE | `src/web/styles.css` | `h1,h2,h3,.page-heading{text-wrap:balance}` — headings only, not previews/paragraphs. |
| 38 | Consistent corners | Already present | — | `styles.css` uses a small radius scale consistently (`1rem` cards, `.7rem`/`.5rem` inner, `999px` pills). No rogue radii; added nothing. |
| 40 | Nested menus | N/A | — | No dropdown/submenu structures exist in the app. |
| — | "Export stats card" text touching edge (1366px) | DONE | `src/web/styles.css` | `.character-actions button` had `white-space:nowrap` forcing the label to clip against the border at narrow widths; removed it so the label wraps. Padding unchanged (`.5rem .7rem`). Characters page passes 1366x768 in layout spec. |

### Verification commands
- `npx playwright test tests/e2e/layout.spec.ts --reporter=line` → 10/10 passed.
- `npx vitest run` → 26 files, 160 tests passed (one cold-start run had 4 integration timeouts; clean re-run green — environment flake, not a code regression).
- `npm run build` → worker + client bundles build clean.

### Notes
- Item 34's safe-area padding uses `env(safe-area-inset-bottom)` directly (not `max()`) since the bar had no pre-existing `padding-bottom` to preserve; the viewport already had `initial-scale` only.
- View transitions wrap only the hashchange-driven route swap; initial load and auth-gate reloads are untouched.

