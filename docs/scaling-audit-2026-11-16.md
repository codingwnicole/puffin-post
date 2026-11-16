# Scaling audit — 2026-11-16

Every signed-in page plus the sign-in page, measured against a local worker seeded with worst-case data
(long names, a paragraph-long thread title, long partner URLs, multi-RP characters).

Sizes: 1920×1080 at 100/125/150/200% Windows scaling, 1366×768, 1440×900, 1366 at 200%, tablet
landscape/portrait, phones at 390, 375 and 320 wide.

Checked: page wider than the screen, elements off-screen, clipped text, overlapping controls, sticky
panels taller than the screen, fixed bars covering content, text under 11.5px, tap targets under 32px.

**No page scrolls sideways at any size.** Page ends always scroll clear of the bottom nav.

## Findings, worst first

| # | Where | Sizes | Problem | Cause |
|---|---|---|---|---|
| 1 | Character planner | ≤1440 wide (125%+ scaling) | Card heading squeezes the name and faceclaim into a ~90px column; long names break every few letters, the card grows ~3× taller | `.planner-card-heading` is one flex row: avatar + text + stage badge |
| 2 | Sidebar (every page) | all desktop sizes | "Search / commands" button is hidden under "Sign out"; only its Ctrl K box pokes through | `AppShell.tsx:49-50` renders two `p.nav-note`, both `position:absolute; bottom:1.5rem` |
| 3 | Inbox | 125%, 150%, 200%, phones | No thread is visible on the first screen: header strip + hero + summary row + Reply run card + 6-field filter box fill it | Oversized hero (`.page-heading`), Reply run on its own row, filters always expanded |
| 4 | Inbox filter bar | all | "Show archived" checkbox renders as a 44px empty box with its label below | `.filter-bar input` gives every input `width:100%; min-height:2.75rem`, including the checkbox |
| 5 | Starter page | all | A stray `0` under the action buttons | `StarterPage.tsx:37` `{detail.starter.archived && …}` with `archived = 0` |
| 6 | Starter page | all | Premise textarea is ~170px wide inside a full-width card; "Latest reply" eyebrow overlaps the line under it | unstyled `textarea`; eyebrow and text share a line box |
| 7 | Text scaling | ≤1024 wide (200% zoom, tablets, phones) | Some labels get *smaller* as the screen narrows: beta label 9.3px, parking card spans 9px, eyebrows 10.7px | breakpoint rules shrink `font-size` |
| 8 | Inbox character groups | desktop | A group with one character uses half the width and leaves the other half empty; thread titles truncate early | `.character-stacks` fixed 2-column grid |
| 9 | Thread cards | all | Premise preview cut through the middle of its 3rd line | `max-height` clip without `line-clamp` |
| 10 | Thread card with a very short title | all | Card contents shrink and centre (e.g. "tea") | card content not stretched to full width |
| 11 | Settings | all | Password and "New RP section" inputs are unstyled, label jammed against the box; "Appearance" label appears twice | form not using `.tracking-form` styles |
| 12 | Tumblr activity | all | "Blog" filter is an unstyled select jammed under the description | same |
| 13 | 200% zoom (960×540) | 200% | Top bar + bottom nav take 145 of 540px (27%) | fixed header and nav at mobile sizes |
| 14 | Phones | <768 | Small tap targets: "1 overdue note" 16px, "+ Add label" 16px, "Back to Inbox" 21px, "Open source" 21px, "Add link" 21px | text links without padding |
| 15 | Inbox "Unsorted" reason text | all | Not inset; touches the section edge | missing padding |

Raw results and screenshots stay in the session scratchpad; rerun with `audit.mjs` against a seeded dev worker.
