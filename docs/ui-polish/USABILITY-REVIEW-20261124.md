# RP Thread Buddy — usability review, 24 November 2026

Scope: the current ui-wheel-polish worktree, the built client, local Worker/D1 integration tests, and public profile rendering. This is an automated task walkthrough and code review, not a moderated user study, a production audit, or evidence of user satisfaction. No participants were recruited and no SUS scores were invented.

## Questions and method

Can a writer find their next reply, identify a character, edit a card, download/share it, use writing tools, and recover from failed requests? Does the interface fit a phone? Does the chosen palette apply consistently?

- Walk 16 destinations at 1440px and 390px: Dashboard, Characters, character profile, Parking Lot, Planner, Tumblr activity, Connections, Writing tools, Focus, Sprints, Settings, Roadmap, Support, Terms, Privacy, Cookies.
- Require each destination's own heading, no sideways page scroll, accessible names for visible buttons, and no uncaught client errors. Save screenshots for visual inspection.
- Exercise the existing browser regression suite for real workflows, keyboard/modal behavior, draft preservation, reload/sign-in persistence, two-user isolation, filters, archive/undo, layouts, contrast, and sprint privacy.
- Add explicit card-download and public-preview regressions under the production image policy; verify actual PNG output rather than only clicking a button.
- Verify all four dashboard palettes in both modes, plus saved-card public palettes across all ten card themes.

## Findings addressed

| Severity | Finding | Result |
| --- | --- | --- |
| High | Canvas card rendering used blob image URLs blocked by production CSP. | SVG rasterization and stats-icon loading use allowed data images; security policy stays restrictive. Download tested from profile overlay and Characters cards view. |
| High | Public PNG links depended on a saved preview that could be missing after failed generation or editing. | Public preview now builds both sides from the displayed public SVG, opens a PNG preview with a download link, and reports blocked popups/rendering errors on the source page. It also works without a stored preview. |
| Medium | Public cards referenced a portrait endpoint even for characters with no portrait/icon. | No-image cards now keep their initials fallback instead of requesting an absent image. |
| Medium | Card editor embedded a Pinterest form inside the card-save form. | Pin controls now use their own button and Enter handler without nesting forms or submitting the card. |
| Medium | Dashboard turn status stayed pink regardless of the selected skin. | Turn colors inherit the selected accent/highlight in every palette and mode. Status text remains the identifying cue. |
| Medium | Public profile used a fixed beige palette and duplicated short/full names. | Profile uses the saved card palette; one italic full card name is the heading, with character name as the fallback. |
| Medium | Public Spotify required an extra load action; board frame did not fill its section. | Spotify iframe loads immediately without starting audio. Board frame stretches with its section and has a useful title. |
| Medium | Public/exported turn labels addressed the visitor as the owner. | Public profile, trading-card SVG, and stats PNG labels now say My turn. Machine/API status identifiers remain unchanged. |
| Low | RP membership was visually flat. | RP names are centered in italics below the stats, separated by a decorative divider, with no extra wording. |
| Low | Public decorative halo could spill past a narrow viewport; hidden report-form CSS overrode hidden state. | Halo constrained; hidden report form stays hidden. |
| Low | Data-integrity assertions matched hidden wheel text. | Assertions target visible scene cards and draft headings; canonical Dashboard URL expectation corrected. |

The character profile already uses the same native CardEditor dialog as Characters Details and Cards; its behavior was retained and tested, including opening, closing, and exporting.

## Limits and remaining checks

- External Spotify/Pinterest content is stubbed during deterministic layout tests. The parent frame sizing and initial load are verified; provider availability, sign-in prompts, and third-party interior rendering need a live smoke check.
- Existing public card.png/social previews stored in R2 are not rewritten by this patch. Open Share / Save settings to regenerate a stored image with current labels. The public PNG action no longer depends on that stored image.
- No browser testing substitutes for five actual RP writers trying the flows without hints. No live production data was modified and no deployment was performed during this review.

## Ready-to-run participant round

Recruit five RP writers: a new tracker user, a multi-muse writer, a shared-blog writer, a phone-first writer, and a keyboard-first writer. Ask permission to take notes; avoid recording private drafts or account information. Ask participants to think aloud, and do not tell them which button to choose.

Tasks:
1. Find the oldest reply you owe and open the correct partner post.
2. Add a character, make a card, change its theme, and download it.
3. Create a public share and check the name, stats, board, playlist, and PNG preview.
4. Park an unfinished reply, reload, then recover and edit it.
5. Pick something to write with the wheel; use it again from the Parking Lot.
6. Start a solo sprint, then create a room and invite a second browser.
7. Change palette and appearance on a phone; find support without using search.

For each task, record: completed unaided / completed with help / not completed, elapsed time, wrong turns, lost work, and a 1–7 ease rating. Ask what the participant expected when they hesitated, which terminology was unclear, and what they would change first. Prioritize failures that lose work or block completion, then repeated navigation/wording problems. Do not interpret automated execution times as human task times.

## Validation

- Build and TypeScript checks pass.
- 141 unit tests pass.
- 28 offline Chromium checks pass, including the 32 page/viewport combinations, all eight palette/mode combinations, Characters/profile PNG export with a portrait under CSP, and public PNG generation without a stored preview.
- Full local-Worker browser run: 143 passed, six failed initially. Name/turn assertions were updated to the requested behavior; the five affected real-Worker test files then passed all six tests at two workers. The new walkthrough also passed after correcting its expected route headings. This is combined coverage, not a single all-green full-suite run. The full browser command and focused real-Worker rerun hung after recording their test results and were interrupted during teardown; the independent offline browser suite completed normally.
- The full Vitest run is NOT green in this environment: 38 files failed, 28 passed; 191 tests failed, 165 passed, 29 skipped. Affected D1 integration tests fail with internal runtime errors during fixture migration setup (tracking-fixture.ts:82), before exercising route behavior. A focused public-share integration retry fails at the same setup boundary. Re-run npm.cmd test from normal PowerShell before deployment.
- Provider content and real-user behavior remain unverified as described above. Screenshots and test logs are generated under test-results/ui and .wrangler respectively; these are local verification artifacts rather than product assets.
