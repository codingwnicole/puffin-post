---
version: 1
slug: "src-web-pages-inboxpage-tsx"
primary_target: "src/web/pages/InboxPage.tsx"
related_targets: []
---

# Surface brief: signed-out landing (guest view of InboxPage)

Scope: the signed-out page at `/` (the guest branch of src/web/pages/InboxPage.tsx) and its check-your-email state. Mode: Persuade.
Audience: roleplay writers arriving for the first time; returning writers must reach sign-in at once, on phones too.
Action: sign in or start free with an email link (password option stays).
Proof: words only (owner's choice). Claims allowed: the four PRODUCT.md differentiators, free while in beta, 16 and older. No testimonials, numbers or interface previews.
Constraints: keep the magic-link form, password option, terms line, legal and roadmap links, check-your-email state and their test hooks (.guest-copy, .guest-card, button "Email me a sign-in link").
History: the owner first locked "The desk list", then switched to "The thread" (the dealt lead).

## Direction contract
THESIS: The page is an RP thread: a writer's worries and the app's answers take turns, and the last post is the writer's turn, which is the sign-in. Refuses the split hero over a feature-card row.
OWN-WORLD: Writer's Desk paper and sheet under the lamp glow; posts as sheet-coloured slips with soft elevation; turn labels as small chips in the product's own turn colours (your turn plum, their turn blue outline); Young Serif headline, Newsreader post text, Figtree labels.
STORY: The visitor recognises their own worries, reads four answers that name what only this tracker does, and signs in from the "Your turn" slip without scrolling.
FIRST VIEWPORT: Brand top left; headline "Know whose turn it is, on every thread." at 56-64px with one line of lede; below it the thread starts (You / Thread Buddy posts, alternating offsets); the "Your turn" sign-in slip pinned at the top right beside the headline. On phones the slip sits directly under the headline, before the thread.
FORM: The thread, position 6 on the ordered list (the dealt lead), seed:f9388522627b1067.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
