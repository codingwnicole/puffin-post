# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hobbyist roleplay (RP) writers, 16 and older, who keep many threads going at once across several characters and writing partners. Tumblr is where most of them write today and is the first integration, but the audience is roleplay writers wherever they write: Discord, forums and other platforms are in scope as the product grows. They check in on desktop and on phones, often in short sessions ("what do I owe right now?") and sometimes in longer writing sittings.

Their recurring jobs:
- see which replies they owe, and which scenes are waiting on a partner;
- keep track of each partner's reply to a shared starter separately;
- keep character details, notes and ideas in one place instead of many open tabs;
- write: draft replies, run timed sprints, park ideas for later;
- share their characters with partners and friends.

## Product Purpose

RP Thread Buddy is a private thread tracker and writing workspace for roleplay writers. It turns a scattered pile of threads, tabs and notes into one calm place that answers "whose turn is it?" and helps the writer get back to writing. Success is a writer who opens it, knows what they owe within seconds, and spends their time writing rather than bookkeeping.

## Positioning

What neighbouring trackers can't truthfully claim, all together:
- **Separate reply branches:** several partners replying to one open starter are each tracked on their own, with their own turn state and notes.
- **Tumblr turn detection:** it reads the writer's Tumblr and works out whose turn it is, so threads stay current without manual updates.
- **Character cards and public profiles:** trading cards and shareable character pages that writers show to partners and friends.
- **Writing tools in the same place:** writing sprints (solo and private rooms), focus cycles, the Parking Lot for drafts and ideas, and title/formatting tools.

## Operating Context

- One Cloudflare Worker (Hono) serves `/api` and a React 19 + TypeScript single-page app (Vite, hash routes). Data in Cloudflare D1, images in R2, sprint rooms on a Durable Object.
- Sign-in by email magic link (Resend), with an optional password. Tumblr is connected per user through OAuth.
- Free private beta at https://rpthreadbuddy.app. puffinpost.app and rpthreadbuddy.com redirect to it.
- Writers move between the tracker and the platform they write on (Tumblr today), copying replies out and checking for new posts.
- Reply text written in sprints stays in the browser; only totals are uploaded. Public share pages show only what the writer chooses to share.

## Capabilities and Constraints

- **Core:** Dashboard of owed and waiting scenes grouped by RP section and character; threads with reply branches; Tumblr activity and "Check Tumblr now"; characters with trading cards, moodboards, playlists and RP sections; character planner; Parking Lot; writing tools (sprints, focus cycles, word count, case converter, title builder, symbols); public character pages and embeds; CSV export; account deletion; support board and site roadmap.
- **Terms writers use:** thread, scene, starter, reply branch, your turn / their turn / queued, RP section, muse, partner, Parking Lot.
- **Hard constraints (from AGENTS.md):** user-facing name is "RP Thread Buddy"; internal `puffinpost` / `threadums` / `puffin-*` identifiers are never renamed for branding; frontend work does not change API contracts or the database schema; never deploy or write to the live database without a fresh yes from the owner.
- **Anything on the live site must survive a redesign.** Removing a live feature needs the owner's say-so.
- **In progress or undecided:** Discord integration (bot and DMs, shown as "coming soon"); writing goals (needs API work); other platforms beyond Tumblr.

## Brand Commitments

- Name: RP Thread Buddy (formerly Puffin Post; dev name Threadums). Canonical domain rpthreadbuddy.app.
- Voice: warm, plain, writer-to-writer, using RP writers' own words ("scenes on your desk", "waiting on a partner"). It doesn't sound like corporate software.
- The approved visual direction is "The Writer's Desk" (prototype in `docs/redesign/prototype.html`, decisions in `docs/redesign/HANDOFF.md`). Visual details live there and in code, not in this file.
- Icon credits (chikin icons, Ayub Irawan, wishforge.games, CC BY 4.0) stay visible in the app.

## Evidence on Hand

- Real product copy, legal pages (Terms, Privacy, Cookies) and the site roadmap are in the app.
- No testimonials, user counts, press or case studies exist. Future work must not invent them.

## Product Principles

1. **Answer "what do I owe?" first.** Every main surface should make the next reply obvious before anything else.
2. **Never lose a writer's words.** Drafts survive failed saves, reloads and closed tabs, and reply text stays private by default.
3. **Server data is the truth, the interface is calm.** Show changes at once, confirm them, offer undo, and roll back cleanly on error.
4. **Grow beyond Tumblr without breaking Tumblr.** New platforms are added alongside it; nothing Tumblr writers rely on goes away.
5. **Sharing is the writer's choice.** Nothing becomes public unless the writer turns it on, and they can turn it off again.

## Accessibility & Inclusion

WCAG 2.2 AA. The e2e suite already checks AA contrast in light and dark, 44px touch targets on phones, and reduced-motion behaviour. Status changes use `role="status"`, errors `role="alert"`, and modals use native `<dialog>`.
