# UI fixes and focused wheel — November 24, 2026

Implemented for **Dashboard and Parking Lot**, following the owner's scope correction. Characters has no new wheel. No deployment, push, production configuration, database schema, API contract, authentication, or Tumblr synchronization changes.

## Repository and synchronization

- Original checkout: `main`, `7539e0b83cd4f494c3f31c1a9bf832caa8c482cb`.
- Selected authoritative baseline: `origin/main`, `975bf02641735d41d499f9e4f3c07275e2f23324`.
- Feature branch: `fix/ui-wheel-polish-20261124`.
- Worktree: `C:\Users\console\Documents\ChatGPT\rpthreadtracker\threadums\.worktrees\ui-wheel-polish-20261124`.
- `git fetch origin --prune` failed because the shell could not resolve GitHub. The connected GitHub API confirmed that its current `main` exactly matched the already-present remote-tracking commit. Rechecked before handoff: still `975bf02`. No open PRs were present at baseline selection.
- Read `AGENTS.md`, `CLAUDE.md`, frontend/backend architecture, `PRODUCT.md`, and `DESIGN.md`. Reviewed the merged Writer's Desk changes and existing worktrees. Existing developer worktrees were left intact.

## Design resources actually available

| Resource | Found and read | Use |
|---|---|---|
| UI/UX Pro Max | `C:\Users\console\.agents\skills\ui-ux-pro-max\SKILL.md` | Loaded and used. Local searches returned modal focus, long-token wrapping, responsive overflow, and React timer-cleanup guidance. |
| Impeccable | `C:\Users\console\.agents\skills\impeccable\SKILL.md` | Loaded and used. Ran context and the mechanical detector; read adaptation, polish, and craft-floor guidance. Preserved the existing Operate UI. |
| Local `design-taste-frontend` | Local skill file inspected | Marketing-site workflow; not applied to this focused application repair. Identity with the requested `leonxlnx/taste-skill` package was not verified. |
| Stop Slop | Local `stop-slop/SKILL.md` read | Writing guidance, not a UI styling toolkit. Used only as a copy check. |
| AI Design Skills | No matching installation identified | Not loaded or installed. |
| Website Design review/page skills | Catalog resources read | Not used: their new-site and review funnels do not fit this implementation task. |

No project-local design skill installation was found. The relevant design skills live in the user's shared skills directory. No installation scripts or new dependencies were run. Existing locked dependencies were copied from the sibling development worktree after an offline install could not find all cached packages.

Optional Figma, Mobbin, and Themely tool endpoints were exposed. Superdesign was present in the skill catalog, but no dedicated tool endpoint was discovered. These optional services were not invoked; this repair used the committed product/design system and rendered application as its references.

## Root causes and implementation

| File | Change and reason |
|---|---|
| `src/web/redesign.css` | The Details hint is absolutely positioned. The inherited button hover brightness filter and press transform established a different containing block, relocating the hint into the summary button. The card also lifted on hover. Removed those transforms/filter changes from the scene target, retained shadow/color feedback, and kept a 44px Details target anchored to the card. Added wrapping for titles/badges, shrinkable Parking Lot summary content, readable phone fields, and responsive dialog rules. |
| `src/web/components/BranchRow.tsx` | Uses the extracted Tumblr destination helper, keeping cards and the wheel consistent. Existing editing, status actions, and drawer remain. |
| `src/web/lib/tumblr-links.ts` | Extracts the existing latest-post logic: pair the branch's latest post ID with its actual poster; fall back to the known root only when the latest pair is incomplete. Manual scenes have no invented Tumblr URL. |
| `src/web/components/SpinWheel.tsx` | Replaces the inline picker and page-scrolling reveal with a shared native dialog. It uses a frozen candidate snapshot, synchronous in-flight lock, transition-end completion, timer cleanup, forward rotation, and a selected segment that matches the result. Closing cancels an active spin; settled results survive closing/reopening. |
| `src/web/lib/spin-wheel.ts` | Pure landing-angle calculation, tested for every index across repeated spins and wheel sizes through 500. |
| `src/web/pages/InboxPage.tsx` | Dashboard results use the selected reply branch's canonical Tumblr destination. A native `target="_blank"` link opens it directly and leaves the tracker in place. Manual scenes retain their internal thread link. |
| `src/web/pages/ReplyParkingLotPage.tsx` | Results offer Open Draft, View Idea, Open Plot, or Open Note. The selected item opens its editor, scrolls into view, and focuses its title. Selection is consumed so saving and remounting the updated draft does not reopen the editor. |
| `tests/unit/wheel-destinations.test.ts` | Eleven new checks for geometry, invalid selections, partner branches, known-root fallback, and manual/incomplete destinations. |
| `tests/e2e/ui-wheel-polish.spec.ts` | Twenty-three browser checks covering the new flow, layouts, keyboard/touch, motion, destination handling, clipboard recovery, editor save lifecycle, and screenshots. Captures unexpected page errors and React warnings. |
| `tests/e2e/spin-and-titles.spec.ts` | Updates the prior inline-wheel expectation to the requested dialog and contextual result actions. No assertion thresholds or security checks were weakened. |
| `playwright.ui.config.ts`, `package.json` | Adds `npm.cmd run test:ui`, exercising the built application with mocked APIs and no local Worker/server. The normal full e2e command remains intact. |

**Reproduction evidence:** on the untouched baseline, the Details regression measured a hover jump from `y=546.1875` to `y=482.1875`, a 64px shift. The corrected control stays at the same bounds through hover, pointer-down, and returned keyboard focus.

## Wheel interaction and accessibility

- The opener shows the dialog first; Spin starts the selection. Escape and Close work during and after animation.
- Native `showModal()` provides top-layer rendering, background inertness, focus handling, and return to the opener. Background scroll is locked while the wheel is open.
- Desktop uses wheel/result columns. Phones stack the wheel, selected result, and full-width actions. Short screens scroll inside the dialog.
- Numbered segments correspond to an expandable list of complete item names. Large wheels omit crowded dial labels while retaining the full candidate list.
- The primary result action appears beside/before secondary Spin Again. Space is reserved so normal result changes do not resize the dialog.
- Reduced motion chooses immediately; changing the preference mid-spin also settles immediately. Single-item wheels resolve immediately.
- Tumblr navigation uses a normal user-activated link, avoiding async `window.open` popup behavior. Copy link and an explicit link-menu recovery message cover denied or unavailable clipboard access. The browser test opens and verifies a mocked Tumblr tab; no real Tumblr post was contacted or altered.

## Targeted visual polish and deferred direction

Kept the existing palette, typefaces, layout system, turn-color meanings, and shared elevation tokens. The wheel uses existing sage, peach, lavender, paper, and muted-surface tokens with a clear pointer and selected rim. Hover/focus feedback stays visible without moving the action. Dark mode uses a dark scrim rather than washing out the background.

Added only `--motion-wheel`, `--ease-wheel`, and `--wheel-backdrop`. No global palette replacement or new animation dependency. Larger palette shifts, botanical artwork, new folder/tab treatments, page composition, and a broader Animal Crossing direction remain with the Adobe XD redesign. Any substantial palette change still needs a concrete preview and approval.

The mechanical scan reported 89 findings across the existing stylesheet. Four advisories intersected the new wheel rules: compact 13/14px helper/list text and 22px phone headings. These match neighboring application sizing and were retained intentionally. Other findings concern existing CSS outside this repair; no unrelated style rewrite was attempted.

## Verification and limits

| Command/check | Actual result |
|---|---|
| `npm.cmd test -- --maxWorkers=1 --fileParallelism=false` before changes | 133 passed, 189 failed, 29 skipped; 38 failing files. Worker-based tests encounter restricted local sockets. |
| Same full command after implementation | 144 passed, 189 failed, 29 skipped; the same 38 failing files. Comparison of failure headers found no additions or removals. |
| `node node_modules/vitest/vitest.mjs run tests/unit --maxWorkers=1 --fileParallelism=false` | **120 passed**, 17 files, including the 11 new checks. |
| `npm.cmd run build` | **Passed**, including TypeScript, Worker bundle, and client bundle. Existing client chunk-size advisory remains. |
| `npx.cmd tsc --noEmit` | **Passed**. |
| `npm.cmd run test:ui -- --workers=1 --reporter=line` | **23 passed**. Uses the production client bundle with mocked API responses; no Worker socket is needed. |
| Existing mocked layout, dashboard, shell, theme, and visual-system specs through a temporary static-bundle fixture | **49 passed**; 2 could not run because their custom avatar checks dynamically import Vite dev-only modules. Those two have the same limitation on the baseline bundle. Original test expectations were retained. |
| `npm.cmd run test:e2e -- --workers=1 --reporter=line` | **Blocked at Worker startup:** `connect EACCES 127.0.0.1:<local port>`. It did not complete the full real-Worker browser suite. |
| `npm.cmd run lint` | No lint script exists. No arbitrary lint dependency/configuration was added. |
| `git diff --check` | **Passed**. |

Responsive browser checks cover **320, 375, 430, 768, 1024, 1440, and 1920px**, including long thread titles, character names, planner cards, Dashboard, Parking Lot, Writing Tools, and dialogs. A separate **320×568 touch context** verifies the action remains reachable and Details responds to tap. Dark-mode result text passes 4.5:1 contrast. Mouse press, keyboard activation, focus containment/return, active-spin cancellation, rapid double clicks, reduced motion, and 100-item wheels are exercised. The final UI checks reported no unexpected page errors or React warnings.

Reproduce the focused checks from this worktree:

```powershell
npm.cmd run build
npm.cmd run test:ui
```

In this restricted shell, Playwright additionally needed its already-installed browser location:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\console\AppData\Local\ms-playwright'
```

The Work Mode browser could not connect to the local preview. Rendered inspection and screenshots instead used Playwright with the actual built app and synthetic API fixtures. Worker integration behavior, real Tumblr connectivity, and production authentication were not verified end to end in this environment.

## Before-and-after screenshots

All screenshots use synthetic data. Before images come from a separately built archive of baseline `975bf02`, not a reconstruction of the old design.

| Surface | Before | After |
|---|---|---|
| Dashboard desktop | [1440px](screenshots/before-dashboard-1440.png) | [1440px](screenshots/after-dashboard-1440.png) |
| Dashboard phone | [375px](screenshots/before-dashboard-375.png) | [375px](screenshots/after-dashboard-375.png) |
| Dashboard wheel desktop | [Inline wheel](screenshots/before-dashboard-wheel-1440.png) | [Focused dialog](screenshots/after-dashboard-wheel-1440.png) |
| Dashboard wheel phone | [Inline wheel](screenshots/before-dashboard-wheel-375.png) | [Stacked dialog](screenshots/after-dashboard-wheel-375.png) |
| Parking Lot desktop | [1440px](screenshots/before-parking-lot-1440.png) | [1440px](screenshots/after-parking-lot-1440.png) |
| Parking Lot phone | [375px](screenshots/before-parking-lot-375.png) | [375px](screenshots/after-parking-lot-375.png) |
| Parking Lot wheel desktop | [Inline wheel](screenshots/before-parking-lot-wheel-1440.png) | [Focused dialog](screenshots/after-parking-lot-wheel-1440.png) |
| Parking Lot wheel phone | [Inline wheel](screenshots/before-parking-lot-wheel-375.png) | [Stacked dialog](screenshots/after-parking-lot-wheel-375.png) |
| Dark wheel | — | [1440px](screenshots/after-dashboard-wheel-dark-1440.png) |

## Merge and deployment status

Ready for code/design review, with no identified new UI regression. Final merge approval should wait for the normal Worker-backed test/e2e commands in an environment that allows local sockets; this run cannot provide that green check. The remaining failures match the baseline, but matching failures are not a substitute for a successful integration run. No push or deployment has been performed.
