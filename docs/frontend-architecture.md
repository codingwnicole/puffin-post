# Frontend architecture (pre-redesign)

Status as of 2026-11-21, branch `refactor/pre-redesign-architecture`. The rules agents must follow live in [AGENTS.md](../AGENTS.md). This page explains the current shape of the frontend, what the pre-redesign pass changed, and how to land the redesign.

## Shape

| Layer | Where | Notes |
| --- | --- | --- |
| Entry | `src/web/main.tsx` | Mounts `<App/>` in StrictMode, loads `styles.css` then `landing-fixes.css`, forwards uncaught errors to `/api/client-errors`. |
| Routing | `src/web/App.tsx` | Hash router. `routeFor(hash)` returns the nav page and the element to render. Legal pages render outside the shell. Page swaps use `document.startViewTransition`. |
| Shell | `components/AppShell.tsx` | Brand, primary nav, phone "More" sheet (swipe-to-close), command menu (Ctrl/⌘K), offline banner, toast host, session probe. |
| Pages | `src/web/pages/*` | One per route. Each page owns its data and state. |
| Components | `src/web/components/*` | Reusable UI. Must not import from pages. |
| Data | `lib/api.ts` | `api()` JSON wrapper, `apiUpload()` multipart wrapper, `staleGet`/`peekCache` stale-while-revalidate cache, sessionStorage draft safety net, nav prefetch. |
| App state | `lib/toast.ts` | Undo toast store (`useSyncExternalStore`). The only global store. |
| Motion | `styles.css` motion tokens + `lib/motion.ts` | CSS keyframes and transitions. `useEntered()` stops entrance animations from replaying. View Transitions for page swaps. |
| Theme | `lib/theme.ts`, `components/ThemeMenu.tsx` | `data-theme` on `<html>`, light/dark/system, saved in localStorage. |
| Canvas export | `components/TradingCard.tsx`, `lib/stats-card.ts` | PNG/GIF export of cards and stats images. |

No router, state, styling, or animation library is installed. Dependencies the browser bundle uses: `react`, `react-dom`, `gifenc` (animated card export), `zod` (shared validation).

## Audit findings

### Corrected in this pass

| Area | Problem | Fix |
| --- | --- | --- |
| Data | Inbox "Load more" sent `offset` twice after the first page (`?offset=100&offset=200`). The server reads the first value, so the second click repeated page 2. Any edit after paging reloaded only that later page. | `offset` is now passed only by `loadMore`. `reload()` returns to page 1. |
| Data | Inbox filters were written to the URL as `includeArchived=true` but read back only as `archived=1`, so "Show archived" was lost on reload, Back, or a shared link. | Both spellings are now read. |
| Data | Moodboard uploads on the profile page ignored failed responses, so a rejected image looked like it had uploaded. | Uploads go through `apiUpload()`, which throws the server's error. |
| Data | Editing a card's portrait from the profile page uploaded it to the character's **icon** instead of the portrait, despite the "separate from your icon" hint. The Characters page did it correctly. | The profile page now posts to `/portrait`, like the Characters page. |
| Data | Seven hand-written multipart `fetch` calls each had their own error handling. Some dropped the server message, and none showed the signed-out message. | One `apiUpload()` in `lib/api.ts`. |
| Routing | The archived-character page linked each thread with the branch id where the starter id belongs, so every link opened "not found". | Links use `starterId`. |
| Routing | A nested ternary chain plus a separate list of page names in `pageForRoute` meant a new route had to be added in three places, and the unreachable fallback was still "coming soon" copy. | A single `routeFor()` table. The dead fallback is removed. |
| Structure | `SharePanel` (a component) imported `statsCardBlob` from `CharactersPage`, a circular page↔component import. | Moved to `lib/stats-card.ts`. |
| DOM | Entrance-animation "done" flags were set with `document.querySelector(...).setAttribute` on a timer, including one aimed at a `.character-grid` that no longer exists. | `useEntered()` sets the attribute through React. The dead target is removed. |
| DOM | The phone More sheet found itself and its fields with `document.querySelector`. | Uses a ref. |
| CSS | Two `@keyframes toast-in` definitions; the first was dead. | Dead copy removed. |
| Copy | User-facing text still said "Puffin" in six places, plus downloaded file names. | Now "RP Thread Buddy" / "Thread Buddy". Storage keys and the service worker path are unchanged. |
| Profile | Card download errors in the profile overlay were swallowed. | Shown in the page's alert. |
| Inbox | On an empty inbox, the "+ Add a thread" link and the onboarding pointed at a form that wasn't rendered, so a new user couldn't add a thread from the Inbox. | The form renders on an empty inbox too. |
| Inbox | Filtering down to zero results hid the filter bar (showing onboarding instead), so there was no way to clear the filter. | Filters stay visible, with a "No scenes match these filters" message. |
| Dialogs | Escape in the card editor discarded unsaved edits without asking. | Escape and Cancel ask first when the card changed. |
| Dialogs | No modal kept focus inside or returned it on close. The character delete dialog had no keyboard exit. | `useDialogFocus()` (`lib/focus.ts`) on all five modals; Escape closes the delete dialog. |
| Shell | The phone More sheet's "Quick note" field was never saved. | Enter saves it to the Parking Lot as a note. |
| Inbox | Branch autosave wrote both records and reloaded the whole inbox on every blur, even with no change. | Skips the write when nothing changed. |
| Shell | Nested `<p>` in the sidebar footer (invalid HTML, React warning). | Inner element is a `<span>` with the same spacing. |
| Cards | Animated GIF card exports built their 255-color palette from the portrait's first frame only, so later frames came out in the wrong colors (a blue frame rendered brown). | The single palette is sampled from every frame. |
| Tests | The e2e sign-in fixture failed on Windows (inline SQL through cmd.exe) and in current Chromium (a Secure cookie set against an `http://` URL is rejected). About 20 specs also targeted removed or renamed UI (the "More filters" panel, `<details>` More menu, old card labels, the three-panel card download, the old cookie-banner wording). | Fixture seeds from a SQL file with retries and sets the cookie via `https://localhost`. Stale specs updated to the current, intended UI. New `pre-redesign-fixes.spec.ts` covers the fixes above. |

### Known debt, left on purpose

- **CSS is append-only.** `styles.css` (82 KB) has four `:root` token blocks, oklch values overridden by hex on the next line, and many rules re-declared further down. `landing-fixes.css` (40 KB) is a second override layer. Untangling it would change rendering in small ways, and the redesign replaces it anyway. Don't refactor it; replace it.
- **Dense one-line JSX.** Several pages (`InboxPage`, `ConnectionsPage`, `SettingsPage`, `AppShell`) are written as very long lines. Reformat them only when the redesign rebuilds that page's markup, to keep diffs reviewable.
- **Hand-rolled modals.** They now trap and restore focus, but the redesign should replace them with one Dialog primitive on native `<dialog>`.
- **Duplicated local types.** `Character`, `ArchivedCharacter` and `blogLabel` are redeclared in several pages.
- **`settings` uses `any`** for its API data.
- **Two visual checks fail on purpose:** `layout.spec.ts` "first branch card on screen at 390px" (the always-expanded filter bar is 304px tall on phones, so the first card sits at ~1040px against a 1000px budget) and `visual-system.spec.ts` "dark depth" (the phone More sheet uses the same surface tone as cards in dark mode). Both are layout and color decisions for the redesign.
- **Backend tests.** Five integration tests fail independent of the frontend (blog reassignment unique constraint, tenant-scoping allowlist, three tracking-refresh cases). They're in Tumblr refresh and assignment logic and need their own investigation.

## Implementing the redesign

1. **Tokens first.** Write a new token sheet (color, type scale, spacing, radius, shadow, motion) as one `:root` block plus a `[data-theme="dark"]` block, and load it before everything else. Keep `--motion-*`/`--ease-*` and their reduced-motion override. Keep `data-theme` and `lib/theme.ts`; they already work.
2. **Primitives next**, in `src/web/components/ui/`: Button, Field (label + help + error), Select, Card, Dialog, Sheet, Badge, Skeleton, EmptyState. Build Dialog on native `<dialog>` + `showModal()` to get focus trapping, Escape, and the top layer for free, then move all five modals onto it.
3. **Page by page**: swap each page's markup to the primitives and delete the CSS that page used from `styles.css`/`landing-fixes.css` in the same commit. When both files are empty, delete them and the imports in `main.tsx`.
4. **Behavior stays put.** Data loading, optimistic updates, draft safety nets, routing, and the undo toast are independent of the markup. Pages keep their handlers and state; only the JSX and classes change.
5. **Tests.** Most e2e specs select by role and label. Specs that select by class (`.mobile-more-menu`, `.rp-groups`, `.tcard-*`, `.sheet-note`) must move to roles or `data-testid` when that markup changes.

## Decisions that should wait for the new design

- Styling approach: plain CSS with tokens (current) vs CSS modules vs a utility framework. Pick it with the design system, not before.
- Whether any interaction needs a JS animation library. Today CSS, the View Transitions API, and the card's pointer-driven custom properties cover everything.
- Navigation structure: sidebar + phone bottom bar + More sheet, and whether the command menu stays.
- Trading-card themes, card layout, and export dimensions (these are content as much as style).
- Icon set: the hand-drawn `Icon.tsx` paths vs a library.
- Whether the phone More sheet stays a swipe sheet.
- Next.js: not justified. The app is a client-rendered, signed-in SPA behind one Worker. Public share pages are already server-rendered by the Worker (`src/routes/public-share.ts`). A migration would add hosting complexity for no user-visible gain.
