# Agent rules for RP Thread Buddy

RP Thread Buddy (formerly Puffin Post, dev name Threadums) is a Tumblr-first RP thread tracker. One Cloudflare Worker (Hono) serves `/api` and a React 19 + TypeScript single-page app built by Vite. Canonical domain: https://rpthreadbuddy.app.

Read [docs/architecture.md](docs/architecture.md) for the backend and [docs/frontend-architecture.md](docs/frontend-architecture.md) for the frontend before you change either.

## Hard limits

- Never deploy, push, or write to the live D1 (`--remote`) without a fresh yes from the owner for that action.
- Never print or commit secrets (`.dev.vars`, `wrangler.production.jsonc`).
- Never rename internal `puffinpost`/`threadums`/`puffin-*` identifiers (Worker, D1, storage keys, service worker file) just for branding. User-facing text says "RP Thread Buddy".
- Don't weaken tests or security checks to make something pass.
- Don't change API contracts or the database schema from frontend work.

## Frontend rules (`src/web`)

A visual redesign is coming from a co-developer. Until it lands, frontend work is structure and bug fixes only: no new colors, fonts, layouts, or decorative animation.

1. **Stack.** React function components + TypeScript only. No class components, no jQuery-style code, and no second UI framework. Don't add a router, state library, CSS framework, or animation library without the owner's approval. Ask first if you think one is justified.
2. **Routing.** Hash routes. Add a route as one entry in `routeFor` in `src/web/App.tsx`, and add it to `navigation` in `AppShell.tsx` if it belongs in the nav. Don't parse `location.hash` anywhere else, except for a page reading its own query string.
3. **Data.** All `/api` calls go through `src/web/lib/api.ts`: `api()` for JSON, `apiUpload()` for multipart, and `staleGet()`/`peekCache()` for page-load GETs that should paint instantly from cache. Never call `fetch('/api/…')` directly. The only exceptions are the session probe and sign-out in `AppShell.tsx` (they read raw status codes), the error beacon in `main.tsx`, and reading image bytes for canvas export. Every effect that fetches must ignore results after unmount (`let active = true … return () => { active = false }`).
4. **State.** Keep state local to the page that owns it. App-wide state is limited to the toast store (`lib/toast.ts`, `useSyncExternalStore`) and the GET cache. Copy those patterns before you invent a context or store. Server data is the source of truth: apply an optimistic change, then reload or roll back on error.
5. **Mutations.** Every button that writes disables itself while its request is in flight, and every form shows the server's error message in a `role="alert"` element. Long text the user types goes through `saveDraftLocal`/`restoreDraftLocal`, so a failed save never loses it.
6. **DOM access.** Use refs, not `document.querySelector`, for elements React renders. Direct DOM work is allowed only for: per-frame pointer effects (`TradingCard` tilt), canvas/SVG export (`TradingCard`, `lib/stats-card.ts`), `scrollIntoView`/focus, and SpinWheel's cross-list highlight. Keep it inside the component and leave a comment saying why.
7. **Animation.** CSS only: transitions and keyframes in the stylesheet, using the `--motion-*` and `--ease-*` tokens. Respect `prefers-reduced-motion`; the stylesheet zeroes the motion tokens under it. Page swaps use the View Transitions API in `App.tsx`. Entrance animations that must play only once use `useEntered()` from `lib/motion.ts`. Don't add a JS animation library. If an interaction truly needs one, propose it first.
8. **Styling.** Use existing classes and CSS custom properties (`var(--accent)`, `var(--surface)`, …). Never hard-code a color in TSX. The only exceptions are canvas export code and the trading-card themes, which are data. Don't add to `landing-fixes.css`: it's a legacy override layer that the redesign will remove.
9. **Accessibility.** Keep labels on inputs, `aria-*` on toggles, visible focus, and the skip link. Every modal uses `useDialogFocus()` from `lib/focus.ts` and closes on Escape, asking first if it holds unsaved edits. Status changes use `role="status"`; errors use `role="alert"`.
10. **Files.** Pages in `src/web/pages`, reusable UI in `src/web/components`, non-UI helpers in `src/web/lib`. Components never import from pages.

## Checks

Run these before you call a change done:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Known failures as of 2026-11-23: one visual e2e check (`visual-system.spec.ts` dark depth) that waits on the redesign. Don't count it as a regression, and don't "fix" it by loosening the assertion.
