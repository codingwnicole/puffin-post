# Tumblr private-beta test script

Use dedicated test blogs and fictional posts. Do not use real roleplay threads or paste private Tumblr content into bug reports.

## Setup

1. Prepare one Tumblr account with a primary test blog and, if possible, a second sideblog. Prepare three partner test blogs.
2. Sign in to RP Thread Buddy with the beta magic link and connect the Tumblr test account.
3. Confirm the Connections screen lists only the blogs Tumblr returned. Attach the selected blog to a character.

## Branch behavior

1. Publish a root starter from the selected character blog and add it to RP Thread Buddy.
2. Create three reply branches from that one starter, each with a distinct partner blog.
3. Cause partner A to reply/reblog. Run or wait for refresh.
4. Verify only A's branch changes activity/turn information. B and C retain their own notes, status, and activity.
5. Set B manually to `queued`, trigger another refresh for A, and confirm B stays `queued`.
6. Archive C, confirm A and B remain visible, then restore C.

## Connection and failure behavior

1. Reconnect the Tumblr account and verify existing character assignment can be reselected from returned blogs.
2. Attempt to add a root URL from an unassigned or different blog. It must be rejected.
3. Temporarily simulate or observe a failed refresh. The last known branch data must remain and only that branch shows a refresh warning.

## Interface and data checks

1. Upload a PNG/JPEG/WebP/GIF character icon, then test initials fallback by removing or failing the image. SVG/HTML renamed as an image must be rejected.
2. At 390px width, apply character, partner/tag, status, and search filters together. Results should satisfy every selected filter.
3. Switch light/dark and each palette; verify text, selected controls, and avatar initials are readable.
4. Add a note beginning with `=`, `+`, `-`, or `@` (also try leading whitespace), export CSV, and confirm spreadsheet software presents literal text rather than a formula.

Record only the expected/actual behavior, browser/device, time, and sanitized IDs in a bug report. Never include login links, session cookies, OAuth parameters, raw Tumblr token values, or copied private roleplay content.
