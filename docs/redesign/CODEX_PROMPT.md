You are taking over the RP Thread Buddy redesign ("The Writer's Desk"). Phases 1 (tokens + app shell) and 2 (Dashboard) are built and tested. Your job is phases 3 and 4, then phase 5 only if the owner approves it.

## Where to work
- Repo (a git worktree): `C:\Users\console\Documents\ChatGPT\rpthreadtracker\threadums\.worktrees\threadums-stage-1`
- Branch: `redesign/phase-1-shell`, cut from `origin/main` at 9187b2b (the build that's live). Phases 1 and 2 are **uncommitted** in this worktree. Do NOT reset, checkout, clean or stash them away. Build on top of them. If the stash is ever needed: `git stash push -u -m "<unique-tag>"`, then `git stash apply <sha>`, never a bare `git stash pop` (the stash stack is shared with other worktrees).
- Windows. Use `npm.cmd` / `npx.cmd`. A local-only migration step may be needed in a fresh environment: `npx.cmd wrangler d1 migrations apply threadums-local --local`.

## Read these first, in this order
1. `AGENTS.md`: hard rules. Never deploy, push or touch the remote D1 without the owner's fresh yes. Never print or commit secrets (`.dev.vars`, `wrangler.production.jsonc`). Don't change API contracts or the schema from frontend work. No new UI libraries. Never rename internal `puffinpost`/`threadums` ids.
2. `docs/redesign/HANDOFF.md`: the full context, every decision, what's done, the bugs found and fixed, and step-by-step plans for each remaining phase. **This is your spec.** Keep it up to date as you work.
3. `docs/redesign/prototype.html`: the approved visual design. Open it in a browser and check the Prototype (app / public profile / sign in; desktop / mobile; light / dark), Feature inventory, Depth & motion, Design system and XD handoff tabs. Its data is made up; never copy the owner's real characters into anything.
4. `docs/frontend-architecture.md` and `docs/architecture.md`.

## Files already changed (phases 1–2): know them before you touch anything
- `src/web/redesign.css`: the new layer, loaded last. It holds the tokens (legacy names remapped plus new ones), the shell, the Dashboard, the scene drawer, the Add a thread dialog, filters, alerts and forms. All new markup uses `rd-*` classes or is scoped under `.rd-dashboard`.
- `src/web/main.tsx`: self-hosted fonts (`@fontsource/young-serif`, `@fontsource-variable/figtree`, `@fontsource-variable/newsreader`), then `styles.css`, `landing-fixes.css` and `redesign.css`.
- `src/web/components/AppShell.tsx`: the folder-drawer sidebar, the joined sheet, the phone top bar, tab bar and More sheet.
- `src/web/App.tsx`: the View Transition promises are caught; no page transition to or from `#quick-add`.
- `src/web/pages/InboxPage.tsx` (Dashboard), `src/web/components/BranchRow.tsx` (scene cards and the details drawer), `src/web/components/SpinWheel.tsx`, `src/web/components/StarterFields.tsx` (premise never auto-filled; the post is a reference), `src/web/components/AddThreadDialog.tsx` (the one Add a thread form), `src/web/pages/TumblrActivityPage.tsx` ("Add to tracker" opens that form), `src/web/components/Icon.tsx` (`chevron`).
- `src/web/styles.css` and `src/web/landing-fixes.css`: legacy CSS, pruned for the Dashboard classes. Use `docs/redesign/tools/css_prune.py` to remove the selectors each later phase replaces.
- Tests: `tests/e2e/redesign-shell.spec.ts`, `tests/e2e/redesign-dashboard.spec.ts` (new), plus updated `layout`, `mobile-more`, `pre-redesign-fixes`, `theme`, `transitions`, `visual-system`, `check-tumblr`, `multi-reply-starter` and `spin-and-titles` specs.
- `package.json` / `package-lock.json` (the font packages) and `docs/frontend-architecture.md`.

## What to do next (details in HANDOFF.md §8, phases 3–5)
- **Phase 3: Characters, trading cards, profile, sharing.**
  - Files: `src/web/pages/CharactersPage.tsx`, `src/web/components/TradingCard.tsx`, `src/web/components/CardEditor.tsx`, `src/web/pages/CharacterProfilePage.tsx`, `src/web/components/SharePanel.tsx`, `src/routes/public-share.ts` (the server-rendered public page `/c/<slug>`).
  - Must keep the Details | Cards toggle. Details shows the small square **icon** used site-wide; Cards shows the bigger card **portrait**, which may be an animated GIF.
  - Add a visible **Make/Edit trading card** button on every Details tile, and "Make or edit a card" next to the toggle.
  - Keep all 10 card themes as data.
  - Add the tilt shadow, glare, foil and a 600ms flip, while keeping PNG/GIF export identical.
- **Phase 4: every remaining page, restyled with the same parts.** Parking lot, Tumblr activity (layout only; the add flow is done), Writing tools, Writing sprints, Character planner, Connected accounts, Settings, Site roadmap, Support & feedback, Legal, and sign-in/landing. Delete each page's legacy CSS as you go.
- **Phase 5: concepts, only with the owner's approval.** Focus cycles, desk music, desk themes.
- **Rule:** every feature on the live site must stay in the redesign. Check the prototype's Feature inventory tab before removing anything.

## Checks: run all three before calling any step done
```
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```
At the end of phase 2: 341/341 unit, build OK, 114/114 e2e. Don't weaken assertions. When a test fails, find out whether it's a real bug: the phase 2 runs turned up several. Update a test only when the design deliberately changed the behavior it checks, and record that in HANDOFF.md.

## Ground rules for you
- Commit only when the owner asks. Never push or deploy. When a phase is done, stop and report the results, and ask the owner whether to continue.
- After each meaningful step, update `docs/redesign/HANDOFF.md`: what you did, why, what's left.
- If something in this prompt conflicts with AGENTS.md or HANDOFF.md, those two win. Ask the owner when unsure.
