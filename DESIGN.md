---
name: RP Thread Buddy
description: A thread tracker and writing desk for roleplay writers, built as warm paper under a desk lamp.
colors:
  paper: "#F3EEE5"
  sheet: "#FBF8F2"
  sheet-inset: "#F5EFE6"
  sheet-quiet: "#EDE5D9"
  ink: "#2D2925"
  ink-soft: "#5C544B"
  ink-faint: "#6B6156"
  hairline: "#E3DACC"
  hairline-strong: "#8A7E70"
  meadow: "#56715B"
  meadow-tint: "#DDE6D8"
  harbor-ink: "#2F5F63"
  your-turn: "#86506A"
  your-turn-tint: "#F1E1E7"
  their-turn: "#4D6488"
  their-turn-tint: "#E0E7F1"
  new-scene: "#4F6E52"
  new-scene-tint: "#DFE9DB"
  queued: "#7A644F"
  queued-tint: "#ECE3D8"
  danger: "#9A3B32"
  danger-tint: "#F6E0DC"
  night-paper: "#1C1A17"
  night-sheet: "#262320"
  night-ink: "#EFE8DC"
  night-meadow: "#A3C0A4"
typography:
  display:
    fontFamily: "Young Serif, Iowan Old Style, Palatino Linotype, Georgia, serif"
    fontSize: "clamp(40px, 5.4vw, 62px)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Young Serif, Iowan Old Style, Palatino Linotype, Georgia, serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.25
  title:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  reading:
    fontFamily: "Newsreader, Iowan Old Style, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Figtree, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.05em"
rounded:
  chip: "6px"
  control: "10px"
  tab: "12px"
  sheet: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.meadow}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.danger-tint}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "40px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "40px"
  chip-your-turn:
    backgroundColor: "{colors.your-turn}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  chip-their-turn:
    textColor: "{colors.their-turn}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  chip-queued:
    backgroundColor: "{colors.queued-tint}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "20px 22px"
---

# Design System: RP Thread Buddy

## Overview

**Creative North Star: "The Writer's Desk"**

The app is a writer's desk at night. The page is paper (#F3EEE5) under a desk lamp, a soft warm glow in the top-left corner. The work happens on a sheet laid over it, slightly crooked, with a second sheet peeking out underneath. Navigation is a set of folder tabs on the left; the active tab joins the sheet you are working on. Optional tools (a focus timer, music, a quick note) sit in a desk rail on the right at wide sizes.

The feel is tactile and playful inside a calm, readable frame. Things respond like objects on a desk: buttons press down, a card settles with a small overshoot when it becomes your turn, the spin wheel spins and lands, ticks and posts arrive one after another. The frame stays plain so the writer's own words and the turn colours carry the personality: type and colour do the expressive work, not decoration. Dark mode is a re-tinted night desk, not an inversion.

Density is moderate. The Dashboard and lists are scannable at a glance on a phone between replies; long-form pages (profiles, the signed-out page) breathe more.

**Key Characteristics:**
- Warm paper ground, one sheet per page, a second sheet behind it.
- Young Serif headlines, Figtree interface text, Newsreader for writing and premises.
- Turn colours as the product's own language: plum for your turn, blue outline for their turn, a quiet brown for queued.
- One filled sage button per area; everything else secondary or text.
- Springy, physical motion that switches off completely under reduced motion.

## Colors

A restrained warm-neutral palette with one sage accent and a small set of meaning-carrying turn colours.

### Primary
- **Meadow Sage** (meadow): the accent. Primary buttons, focus-adjacent highlights, progress rings, ticks, the brand mark. Its tint (meadow-tint) marks a selected command or a highlighted row. Desk themes (Tidepool, Lavender hour, Mushroom) swap only this accent and its tint.
- **Harbor Ink** (harbor-ink): links, text buttons and the focus ring. Kept separate from the accent so links read as links on any desk theme.

### Secondary
- **Plum, your turn** (your-turn / your-turn-tint): anything you owe. The filled "Your turn" chip, the owed ring arc, the "Your turn" sign-in heading.
- **Harbor Blue, their turn** (their-turn / their-turn-tint): waiting on a partner. Used as an outline chip, never filled, so it reads as quieter than plum.

### Tertiary
- **Fern, new scene** (new-scene / new-scene-tint): new or connected things, success notes.
- **Ledger Brown, queued** (queued / queued-tint): queued scenes and section bands.
- **Brick, danger** (danger / danger-tint): destructive actions only.

### Neutral
- **Paper** (paper): the page ground under the lamp.
- **Sheet** (sheet): the working surface and cards.
- **Inset and Quiet Sheet** (sheet-inset, sheet-quiet): wells, quiet tabs, secondary surfaces.
- **Ink, Soft Ink, Faint Ink** (ink, ink-soft, ink-faint): body text, secondary text, hints. Faint ink is for hints only, never on tinted surfaces in dark mode (it drops below AA there; use soft ink).
- **Hairline** (hairline, hairline-strong): dividers; the strong hairline outlines form fields.
- **Night desk** (night-paper, night-sheet, night-ink, night-meadow): the dark-mode equivalents. Every light token has a dark counterpart in `src/web/redesign.css`.

### Named Rules
**The Turn Colour Rule.** Plum, blue and brown mean your turn, their turn and queued. Never use them as decoration or for anything else.

**The One Sage Button Rule.** Each region gets at most one filled sage button. Everything else is secondary, text or danger.

**The Tinted Text Rule.** Labels on tinted surfaces use soft ink, not faint ink, so they pass AA in both themes.

## Typography

**Display Font:** Young Serif (with Iowan Old Style, Palatino Linotype, Georgia)
**Body Font:** Figtree (with Segoe UI, system-ui)
**Reading Font:** Newsreader (with Iowan Old Style, Georgia)

**Character:** A sturdy, slightly old-fashioned serif for headings, like a typed title on a manuscript, paired with a friendly humanist sans for controls. Newsreader carries the writer's own words: premises, thread posts, quotes. All three are self-hosted.

### Hierarchy
- **Display** (400, clamp(40px, 5.4vw, 62px), 1.04): page titles and the signed-out headline. One per page.
- **Headline** (400, 20px, 1.25): section and card headings in Young Serif.
- **Title** (600, 15px, 1.3): scene titles, control labels, module headings in Figtree.
- **Body** (400, 16px, 1.55): interface copy. Page descriptions cap at 68ch.
- **Reading** (400, 17px, 1.5): premises, thread posts and character writing in Newsreader.
- **Label** (600, 12px, 0.05em, uppercase only for small section labels): never smaller than 12px.

### Named Rules
**The 12px Floor Rule.** Nothing people read is set below 12px.

**The No Kicker Rule.** No small label sits above a heading. The heading carries its own weight; type information goes after the title, not above it.

## Layout

A three-column desk at wide sizes: folder-tab sidebar (256px), the sheet (fluid), and the desk rail (288px open, 72px collapsed) from 1280px and wider. Between 761px and 1279px there is no rail. At 760px and below the sidebar becomes a top bar plus a five-tab bottom bar, the sheet runs edge to edge with an 8px margin, and a slim focus bar appears above the tab bar while a focus timer runs.

The sheet pads 28px by clamp(18px, 3vw, 44px) on desktop and 20px by 16px on phones. Spacing steps in 4px increments (4, 8, 12, 16, 24, 32); tight groups use 8-12px, sections 18-32px, with more space above a heading than below it. Card grids auto-fill at minmax(330px, 1fr). No page scrolls sideways at any width.

The signed-out page is the exception: a centred sheet (max 1200px) with no sidebar.

## Elevation & Depth

Layered paper. Soft, offset shadows lift the sheet and cards off the paper; the stacked second sheet behind the page adds a physical edge. Dark mode uses deeper, darker shadows rather than lighter surfaces alone.

### Shadow Vocabulary
- **Resting** (`box-shadow: 0 1px 2px rgb(45 41 37/.06), 0 3px 10px rgb(45 41 37/.05)`): cards, posts, the sheet.
- **Lifted** (`box-shadow: 0 2px 4px rgb(45 41 37/.05), 0 12px 26px -10px rgb(45 41 37/.24)`): hover, the sign-in slip, the focused or picked card.
- **Floating** (`box-shadow: 0 4px 8px rgb(45 41 37/.06), 0 30px 60px -22px rgb(45 41 37/.38)`): dialogs, the command menu, the focus timer face.

### Named Rules
**The One Elevation Rule.** A surface declares elevation once: a hairline or a shadow, never both.

**The No Nested Cards Rule.** A card never sits inside another card. Group inner items with a tint or a hairline instead.

## Shapes

Gently rounded and consistent: chips 6px, controls 10px, tabs 12px, sheets and cards 14px. Trading cards keep their own proportions (640×860) and corner ratio. No side stripes on rounded boxes: emphasis comes from a full hairline, a tint or a leading icon.

## Components

### Buttons
Calm at rest, physical on touch.
- **Shape:** gently rounded (10px), 40px tall, 44px on touch screens.
- **Primary:** sage fill with sheet-coloured text, 8px by 16px.
- **Hover / Focus:** a slight brightening and a 1px lift on hover, a press-down on active, a 2px Harbor Ink focus ring.
- **Secondary:** sheet background with a hairline border; hover fills with the inset sheet.
- **Text:** Harbor Ink, underlined with a 3px offset.
- **Danger:** brick text on a brick tint, filling brick on hover. On the thread page Delete is a quiet danger link next to Archive.

### Chips
- **Your turn:** filled plum with sheet text.
- **Their turn:** blue text with a 1px blue outline, no fill.
- **Queued:** soft ink on the queued tint.
- All chips pair the colour with an icon or label; colour is never the only signal.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** sheet, or the inset sheet for quieter items.
- **Shadow Strategy:** resting; lifted on hover or when picked.
- **Internal Padding:** 12-14px for scene cards, 20-22px for page sections.

### Inputs / Fields
- **Style:** sheet background, strong hairline border, 10px radius, 40px tall.
- **Focus:** a 2px Harbor Ink outline replaces the border colour.
- **Error:** the server's message in a `role="alert"` line under the form.

### Navigation
Folder-tab drawers in the sidebar, each tinted, that open and close and remember their state. The active page's tab joins the sheet. On phones, a five-tab bottom bar (Dashboard, Parking, Characters, Tools, More) with a More sheet. Ctrl K opens a command menu: a floating sheet with a search field and a list whose active row takes the meadow tint.

### Trading Card (signature)
Each character's collectible card: ten themes held as data, a front and a back, a 600ms flip, tilt that follows the pointer (off on touch and reduced motion), and foil and glare layers. Exports as PNG or GIF.

### Reply Run and Spin Wheel (signature)
The Dashboard summary: a ring showing owed against waiting, and a small wheel that spins with a settling overshoot to pick which reply to write next.

## Do's and Don'ts

### Do:
- **Do** keep the Writer's Desk tokens; desk themes may change only the accent and its tint.
- **Do** use one filled sage button per region.
- **Do** keep turn colours for turn meaning only: plum yours, blue outline theirs, brown queued.
- **Do** set the writer's words in Newsreader and interface text in Figtree.
- **Do** run motion on the `--motion-*` and `--ease-*` tokens so reduced motion turns it off.
- **Do** keep touch targets at 44px on phones and text at 12px or larger.

### Don't:
- **Don't** put a small label above a heading.
- **Don't** nest cards, or give one surface both a hairline and a shadow.
- **Don't** add a bar down one side of a rounded box.
- **Don't** hard-code colours in components; only canvas export and trading-card themes hold colours as data.
- **Don't** use faint ink on tinted surfaces.
