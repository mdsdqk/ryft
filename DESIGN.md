---
name: ryft merge review
description: A drafting-room revision sheet for reviewing a three-way Postgres schema merge.
colors:
  diazo-ground: "#e4ded0"
  sheet: "#faf7ef"
  sheet-shade: "#f0ebdd"
  panel: "#fffdf7"
  ink: "#1e1b16"
  ink-soft: "#4a4438"
  ink-faint: "#635a46"
  line: "#c9bfa6"
  line-strong: "#a89a78"
  ours-prussian: "#153a5e"
  ours-wash: "rgba(21, 58, 94, 0.08)"
  theirs-oxide: "#9a3c0b"
  theirs-wash: "rgba(154, 60, 11, 0.1)"
  conflict-oxblood: "#8f1a17"
  conflict-edge: "#b52621"
  conflict-wash: "rgba(181, 38, 33, 0.07)"
  ok-verdigris: "#2f6a3c"
  ok-wash: "rgba(47, 106, 60, 0.08)"
  focus-blue: "#0b5cff"
typography:
  display:
    fontFamily: "Saira Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "clamp(22px, 3vw, 30px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
  title:
    fontFamily: "Saira Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.05em"
  body:
    fontFamily: "Saira Condensed, Arial Narrow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.42
    letterSpacing: "normal"
  label:
    fontFamily: "Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.2em"
  mono:
    fontFamily: "Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
    fontFeature: "\"tnum\" 1"
rounded:
  none: "0"
  sm: "3px"
  pill: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  gutter: "clamp(16px, 4vw, 40px)"
components:
  button-default:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "7px 11px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "7px 11px"
  button-ghost:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "7px 11px"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  chip-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  select-input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.none}"
    padding: "2px 4px"
  keycap:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "1px 5px"
  link-button:
    backgroundColor: "transparent"
    textColor: "{colors.ours-prussian}"
    typography: "{typography.body}"
    padding: "0 2px"
  conflict-card-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.none}"
    padding: "16px 16px 18px"
---

# Design System: ryft merge review

## Overview

**Creative North Star: "The Revised Drawing"**

The merge-review surface is a mechanical-drafting revision sheet, not a pull
request. A bordered sheet with an inset drawing border sits on a warm bone
ground; a title strip runs across the top with the revision-status dial plated
into its right end; four lettered zones (A three-way comparison, B conflict
queue, C operation log, D fabrication order) fill the sheet below. Divergence is
drawn the way a draughtsman marks a change: a numbered outline triangle beside
the object, a leader line (`↳`) carrying the note underneath, a crisp
rectangular ring around any row that diverged. Everything structural is drawn
with ink-weight borders; there is exactly one soft shadow in the whole system,
under the sheet itself.

The register is instrument-panel plain. Display type is a condensed technical
face (Saira Condensed) set uppercase and letter-spaced for the sheet title, the
dial status word, and the conflict-queue position; everything that is data — the
object ids, the type specs, the DDL, the timestamps, the keycaps, the tracked
zone labels — is monospace (Spline Sans Mono) with tabular figures on. Two
committed palettes carry it: **Diazo** in light (the ammonia-print bone ground,
prussian ink) and **Cyanotype** in dark (blue-black ground, pale linework).
Provenance is three role tokens used identically in every zone: `--ours`
(prussian / pale blue), `--theirs` (burnt oxide / tan), `--conflict` (oxblood /
salmon), plus `--ok` (verdigris) for anything auto-merged or cleared.

This world explicitly refuses the GitHub unified-diff dump and the commit-graph
spine — there is no spine in the comparison, no diff hunks, no commit nodes.
It also refuses the rubber stamp: the revision status is a marker that advances
along a visible four-step sequence, never a "MERGED" badge. Depth is refused as
a device — no drop shadows for elevation, no opacity to push things back.

**Key Characteristics:**
- Bordered sheet with a 7px inset drawing border and a single ambient shadow.
- Two theme-aware palettes (Diazo light default, Cyanotype dark); light is `:root`.
- Condensed display face for titles; monospace with `tnum` for all data.
- Three provenance tokens (`--ours` / `--theirs` / `--conflict`) plus `--ok`.
- Square corners everywhere; the only radii are the 3px keycap and the 9px dial dot.
- Nothing conveyed by colour alone — every conflict also carries the △! mark, a class badge, and the word "conflict".
- Ink-weight borders on a 2px / 1.5px / 1px / 1px-dashed ladder do all the structural work.

## Colors

A drafting-print palette: a warm bone ground stepped through four surface tones,
warm-grey linework, near-black ink, and four saturated role colours that carry
every merge signal.

### Primary
- **Prussian Ink — ours** (`#153a5e`, pale blue `#78c1ec` in dark): the source
  branch. Revision triangles, "on ours" column header, the `mr-side--ours` card
  top rule (3px), operation-log nodes from this branch, DDL tags for our
  statements, link-button text, and the text-selection background.
- **Burnt Oxide — theirs** (`#9a3c0b`, tan `#e2b782` in dark): the target
  branch. The mirror of Prussian everywhere ours appears; also the border/text
  of a *subtle*-severity conflict badge (`mr-cf__cls--subtle`).
- **Oxblood — conflict** (text `#8f1a17`, edge `#b52621`; salmon `#ff9385` /
  `#ff7a68` in dark): an unresolved divergence. Split deliberately into a
  text-safe tone (≥ 4.5:1) and an edge tone for borders (≥ 3:1). Drives the dial
  status word while held, the conflict-row ring + wash, the queue header band,
  the active-card top/bottom rules, and blocked DDL comments.

### Secondary
- **Verdigris — ok** (`#2f6a3c`, mint `#8fd6a4` in dark): auto-merged rows,
  rebase leader lines, the "Cleared / Released" dial state, the `BEGIN;` /
  `COMMIT;` lines, the resolved-card rules, and the mergeable status dot.

### Tertiary
- **Focus Blue** (`#0b5cff`, `#9cc8ff` in dark): the keyboard focus ring only.
  Deliberately outside both palettes so it never reads as a provenance colour.

### Neutral
- **Diazo Ground** (`#e4ded0`; `#0a121d` dark): the page behind the sheet, and the app bar.
- **Sheet** (`#faf7ef`; `#0f1b2b` dark): the drawing sheet itself.
- **Sheet Shade** (`#f0ebdd`; `#132539` dark): the right rail, group headers, the base-ancestor row, inactive queue cards.
- **Panel** (`#fffdf7`; `#0c1826` dark): framed component interiors — comparison table, queue, log, DDL block, popover.
- **Ink** (`#1e1b16`; `#e4eef8` dark): body text and every structural 2px border.
- **Ink Soft** (`#4a4438`; `#a7bccf` dark) / **Ink Faint** (`#635a46`; `#8299ac` dark): secondary and tertiary text, tracked labels, empty-cell dashes.
- **Line** (`#c9bfa6`; `#284159` dark) / **Line Strong** (`#a89a78`; `#3a5670` dark): interior hairlines (solid and dashed) and component frames; Line Strong also draws the scrollbar thumb.

### Named Rules
**The Two-Provenance Rule.** Every divergence on the screen is carried by exactly
one of `--ours`, `--theirs`, `--conflict` (plus `--ok` for cleared/auto-merged),
and the *same* token is used for that role in every zone — triangle, column,
card rule, log node, DDL tag. No zone invents its own accent.

**The No-Colour-Alone Rule.** Colour is never the only signal. Every conflict
also carries the △! outline mark, a text class badge ("divergent retype", etc.),
and the literal word "conflict". Provenance additionally carries a triangle
number and a "— ours" / "— theirs" text label.

**The Off-Palette Focus Rule.** The focus ring is `#0b5cff`, chosen to sit
outside both committed palettes so a focused control can never be mistaken for a
provenance state.

## Typography

**Display Font:** Saira Condensed (self-hosted `@fontsource`, weights 400/500/600/700), fallback `Arial Narrow, system-ui, sans-serif`.
**Body Font:** Saira Condensed — the condensed face is also the default UI body at 15px.
**Mono / Data Font:** Spline Sans Mono (self-hosted, weights 400/500/600), fallback `ui-monospace, SFMono-Regular, Menlo, monospace`, always with `font-feature-settings: "tnum" 1`.

**Character:** A narrow technical drawing-title face against a plain-spoken
monospace. The condensed face only ever appears uppercase and letter-spaced, for
plate-style headings; the monospace does all the reading work — data, ids, code,
and every tracked micro-label.

### Hierarchy
- **Display** (700, `clamp(22px, 3vw, 30px)`, line-height 1, `0.08em`, uppercase): the sheet `<h1>` in the title strip and the dial status word (`mr-dial__now`, fixed 30px).
- **Title** (700, 17–18px, `0.05–0.12em`, uppercase or lowercase): the conflict-queue position ("Conflict 2 of 4") and the app-bar brand ("ryft", lowercase, `0.12em`).
- **Body** (400, 15px, line-height 1.42): default UI text set in the condensed face.
- **Data / Mono** (400, 11–12.5px, line-height 1.4–1.75): object names (12.5px/600), stable ids (9.5px), cell type specs (11.5px), the DDL block (12px/1.75), operation-log entries (10.5px), title-block rows (10px).
- **Label** (600, 9–11px, `0.06em`–`0.24em`, uppercase, mono): zone headings (`mr-zone__k`, 11px/`0.2em`), the dial label (10px/`0.24em`), column headers (9.5px), chip and button text (10–10.5px), theme-switch items (11px).
- **Keycap** (`<kbd>`: mono `0.82em`, 1px border with a 2px bottom edge, 3px radius, `1px 5px`).

### Named Rules
**The Mono-Carries-Data Rule.** Anything a reviewer might read, copy, or compare
character-by-character — ids, type specs, DDL, timestamps, keycaps — is Spline
Sans Mono with tabular figures. The condensed face is reserved for plate
headings and never carries data.

**The Tracked-Uppercase Rule.** The condensed display face and every mono label
appear uppercase with positive letter-spacing (`0.05em` minimum, up to `0.24em`
on the dial label). Lowercase condensed type appears once, for the brand mark.

## Layout

**Shell.** A sticky app bar (`10px` vertical, `clamp(16px, 4vw, 40px)` inline,
1px bottom rule on Line Strong) over a main region padded by the same gutter
clamp. The app bar carries the brand, a `<details>` keyboard-help disclosure,
and a three-segment theme switch.

**The sheet.** `max-width: 1280px`, centred, `background: --sheet`, `border: 2px
solid --ink`, with a `::before` pseudo-element inset `7px` drawing a `1px
--line-strong` inner border. One shadow (`--shadow-sheet`) sits under it.

**Title strip.** A two-column grid (`1fr auto`): identity block (`20px 24px
16px`) on the left, the revision-status dial (`min-width: 320px`, `2px --ink`
left border) on the right. Bottom edge is a `2px --ink` rule.

**Body grid.** `minmax(0, 1fr) / 344px` — a main column (comparison + queue,
`22px 24px` padding, `2px --ink` right border) and a right rail (log + title
block, `--sheet-2` background, `20px` padding). Zone D (fabrication order) spans
the full sheet width below, with a `2px --ink` top border.

**Bounded scroll regions.** The comparison table scrolls internally at
`max-height: min(56vh, 520px)` with sticky group headers; the operation log at
`300px`; the DDL block scrolls on the x-axis. Zones B–D stay in view while Zone A
scrolls.

**Spacing rhythm.** Base step `--step: 4px`. Observed multiples: 6/8/10/12/14/16/
18/20/22/24/26px. Zones are separated by `24px` (`margin-bottom`).

**Responsive.**
- **≤ 1100px:** title strip collapses to one column and the dial moves below the
  identity block (left border → `2px --ink` top border); the body grid becomes a
  single column (main column's right border → bottom border); comparison rows
  collapse from three columns to stacked, with the ours/theirs headers gaining a
  `2px` top rule in their own colour; the active-card grid goes single-column.
- **≤ 640px:** the app bar wraps; main, rail, and Zone D padding drop to `16px`.

**Pointer vs. keyboard.** All hover treatments live inside `@media (hover:
hover)`. `prefers-reduced-motion: reduce` collapses every animation/transition to
`0.001ms`.

## Elevation & Depth

This system is essentially flat and draws depth with **ink-weight borders and
surface layering**, not shadow. Surfaces stack by tone: `--bg` (behind the
sheet) → `--sheet-2` (rail, group headers) → `--sheet` (the sheet) → `--panel`
(framed component interiors). The sheet's `::before` inset border reads as a
physical drawing margin.

### Shadow Vocabulary
- **Sheet lift** (`box-shadow: 0 24px 60px -34px rgba(30, 27, 22, 0.55)`; dark:
  `0 24px 70px -30px rgba(0, 0, 0, 0.7)`): the only shadow token. Used under the
  drawing sheet (`.mr-sheet`) and re-used under the keyboard-help popover
  (`.keymap`) so the popover reads as lifted off the same sheet.

### Named Rules
**The One-Shadow Rule.** `--shadow-sheet` is the entire shadow vocabulary.
Elevation for anything else is expressed with a heavier border (2px vs 1.5px vs
1px), a surface-tone change, or a colour-hued top/bottom rule — never a new
shadow.

**The No-Opacity-Recession Rule.** De-emphasis (inactive conflict cards, done
log steps) is carried by smaller padding, lighter type weight, and a neutral
badge — never by lowering opacity. Every text run stays at full AA contrast.

## Shapes

**Corners are square.** `border-radius` is `0` on effectively everything,
including scrollbar thumbs (explicitly `border-radius: 0`). The only exceptions:
`<kbd>` keycaps at `3px`, and the single fabrication-order status dot at `50%`
(a 9px filled circle — the one round mark in the system, standing in for a
signal lamp).

**Borders are the material.** A four-weight ladder does all structural work:
`2px solid --ink` for the sheet edge and zone dividers; `1.5px solid --ink` or
`1.5px solid --line-strong` for component frames; `1px solid --line` for
interior hairlines; `1px dashed --line` for sub-row dividers and the
base-ancestor row. Colour-hued rules mark state: a `3px` provenance top border
on the ours/theirs fact cards, a `1.5px --conflict-edge` (or `--ok`) top+bottom
rule on the active/resolved conflict card, a `1.5px --conflict-edge` bottom rule
under the queue header.

**Authored linework.** Iconography is hand-drawn SVG at `stroke-width: 1.4`,
`fill: none` — the revision triangle (`viewBox 0 0 12 11`, delta path) and the
disclosure chevron (`viewBox 0 0 10 10`) share one stroke language. No icon
font, no raster.

**Diverged-row ring.** A row that diverged is ringed with a crisp rectangular
outline (`outline: 1.5px solid --conflict-edge; outline-offset: -1.5px`) plus a
`--conflict-wash` fill — the "revision cloud" concept kept, its scalloped
contour deliberately dropped as noise at table density.

**Gated-row hatch.** A row held by an upstream conflict is filled with a `-45deg`
repeating-linear-gradient hatch (`--sheet-2` 7px / transparent 7px) — a drafting
"not yet" fill.

### Named Rules
**The Square-Sheet Rule.** Nothing is rounded. If a corner radius appears, it is
either the 3px keycap or the 9px dial dot — anything else is off-system.

**The Authored-Linework Rule.** Every glyph is inline SVG stroked at 1.4. Icon
fonts and image icons are not used anywhere in this system.

## Components

### Buttons (`.mr-btn`)
- **Character:** hard-edged mono keycap-style labels; they read as machine controls.
- **Shape:** square (`0`), `1.5px solid --ink`, padding `7px 11px`.
- **Text:** `--ff-mono`, 10.5px, `0.05em`, uppercase.
- **Default:** `--sheet` background, `--ink` text.
- **Primary (`--primary`):** inverted — `--ink` background, `--sheet` text. Used for "take ours" on a conflict.
- **Ghost (`--ghost`):** border switches to `dashed`. Used for prev/next queue nav.
- **Embedded keycap:** `<kbd>` inside a button takes `border-color: currentColor` at `opacity: 0.7`.
- **Hover** (pointer only): default → `--sheet-2` fill + `--ink` border; primary → `--ink-soft` fill.

### Chips (`.mr-chip`) — comparison filters
- **Style:** `--panel` background, `1px solid --line-strong`, `--ink-soft` text, mono 10px `0.06em` uppercase, padding `6px 10px`, square.
- **State:** `aria-pressed="true"` → `--ink` background, `--sheet` text, `--ink` border. Hover (unpressed) → border + text to `--ink`.
- The theme switch (`.app-bar__theme`) is the same pattern as a joined segmented control: shared `1px --line-strong` frame, `1px` dividers, pressed segment fills `--ink`/`--sheet`.

### Cards / Containers
- **Corner style:** square.
- **Frame:** `1.5px solid --ink` (comparison table, operation log, title block, DDL block) or `1.5px solid --line-strong` (conflict queue).
- **Background:** `--panel` interior; `--sheet-2` for the queue list and rail.
- **Shadow:** none — see The One-Shadow Rule.
- **Internal padding:** `12–16px` typical; the fabrication-order block uses the sheet gutter (`24px`, `16px` at ≤640px).

### Inputs
- The only form input is the operation-log author `<select>`: `--sheet`
  background, `--ink` text, `1px solid --line-strong`, padding `2px 4px`, square.
  Hover → `--ink` border. There are no text inputs in this surface.
- **`<kbd>` keycap:** mono `0.82em`, `--sheet`-ish ground, `1px solid
  --line-strong` with `border-bottom-width: 2px`, `3px` radius, padding `1px 5px`,
  `--ink-soft` text.
- **Link button (`.mr-linkbtn`):** inline, inherits type, `--ours` colour,
  underline at `2px` offset; hover thickens the underline to `2px`.

### Navigation
- No site nav. The app bar carries only the brand, a keyboard-help `<details>`
  disclosure (summary is mono 11px uppercase `0.1em`, `--ink-soft` → `--ink`
  when open; popover is `--panel` on a `1px --ink` frame with the sheet shadow),
  and the theme switch.
- **Skip link:** off-screen until focused, then `left: 14px`; `--ink` ground,
  `--sheet` text, mono 12px.
- **In-surface wayfinding:** a `G`-then-`A–D` key jump and per-zone `tabIndex=-1`
  anchors whose `:focus-visible` ring sits at `6px` offset.

### Revision Triangle (signature)
An `inline-flex` outline delta (authored SVG, stroke 1.4, no fill) with the
revision number set beside it in mono 10px/700 with `tnum`, both in the role
colour via `currentColor`. Tone classes: `--ours` / `--theirs` / `--conflict` /
`--neutral`. In conflict form the glyph shows `!` instead of a number and the
whole mark is `role="img"` with `aria-label="conflict"`.

### Revision Dial (signature)
A drawing's issue/approval plate that **turns**. Stacked: a tracked label
("Revision status", mono 10px `0.24em`), the current status word (display face,
700, 30px, `--conflict` while held, `--ok` at Cleared/Released), then the full
four-step sequence (`Received · In check · Cleared · Released`) always visible as
a mono 9px row. The current step is boxed with a `1px solid currentColor` border
and animates into place (`mr-dial-advance`, 420ms, `translateX(-9px)→0` with the
border fading in) each time the status changes; done steps go `--ink-soft`. A
`34ch` detail line underneath carries counts. Never a stamp.

### Comparison Table (Zone A, signature)
Three-column grid (`190px / minmax(0,1fr) / minmax(0,1fr)`): object + stable id
gutter, "on ours" column, "on theirs" column, with the common-ancestor stated in
a dashed-bottom band between the header and the rows — **no spine**. Column
headers are mono 9.5px uppercase; the ours/theirs headers take their role
colour. Groups (Columns / Indexes / Constraints) have sticky headers (mono 10px
`0.12em` uppercase) with the shared chevron. Rows are divided by `1px dashed
--line`; a rebase or auto-merge note appears as a leader line (`↳`, mono 10px,
`--ok` or `--ink-faint`) spanning the two value columns; a rename renders as
`<s>old</s> → <b>new</b>` with the strike in `--conflict`.

### Conflict Queue (Zone B, signature)
A single roving-tabindex listbox (`role="listbox"`, one `tabIndex=0` container,
`aria-activedescendant`, arrows / J / K to move, 1 / 2 / 3 to resolve the active
one). The active conflict comes forward: `--panel` surface, `16px` padding,
`1.5px --conflict-edge` top+bottom rules, full-weight mono title, a two-column
ours/theirs fact grid (each fact card `1px --line-strong` with a `3px`
provenance top border and an uppercase "ours · Name" caption), and the
resolution buttons. Inactive conflicts shrink to `10px 14px` padding, 11px/400
title, neutral badge — they recede by size and weight, never opacity. Resolved
conflicts collapse to a one-line record with an "undo" link button and switch
their rules to `--ok`. Every card carries the △! mark + `severity ·
class-label` badge + the word "conflict".

### Operation Log (Zone C, signature)
A vertical timeline: a `1px --line-strong` rail at `left: 10px`, one `7px` square
node per entry outlined `1.5px` in the entry's side colour (`--ours` /
`--theirs`), entries mono 10.5px with a `△N` tag, author, and time (or target
name). Chronological by revision number; filterable by author via the `<select>`.

### Title Block (Zone C)
A drafting title block: a `<dl>` framed `1.5px --ink`, rows on an `82px / 1fr`
grid, mono 10px, `<dt>` uppercase `--ink-soft` with a `1px --line` right rule.
Rows: Drawing / Merge / Base / Opened / Revisions / Rebased / Checker. The
Checker value takes `data-warn` → `--conflict` while conflicts are unresolved.

### Fabrication Order (Zone D, signature)
The generated DDL in a `<pre>` (mono 12px, line-height 1.75, x-scroll,
focusable). `BEGIN;` / `COMMIT;` and the "all resolved" comment are `--ok`; each
statement carries a `  -- △N` tag coloured by side (`--ours` / `--theirs` /
`--ink-faint` for engine glue), with `, rebased` appended where relevant;
blocked groups render as `--conflict` comment lines. Below, a status line — not
a stamp — with a `9px` round dot (`--conflict-edge` → `--ok` when mergeable) and
a **Held** / **Cleared** sentence; when it flips to mergeable the line runs
`mr-clear-sweep` (520ms, `--ok-wash` → transparent).

### Named Rules
**The Foreground-Sheet Rule.** In any list of peers (conflict queue, dial
sequence), exactly one item is "under work" and comes forward via surface, rule
weight, and type weight; the rest recede the same way. Opacity is never the
recession mechanism, so every item stays at AA contrast.

## Do's and Don'ts

### Do:
- **Do** carry every divergence with one of `--ours` / `--theirs` / `--conflict` (+ `--ok`), using the same token for that role in every zone.
- **Do** pair every conflict signal with the △! outline mark, a text class badge, and the literal word "conflict".
- **Do** draw structure with the border ladder — `2px --ink` dividers, `1.5px` frames, `1px --line` hairlines, `1px dashed` sub-rows — and keep every corner square.
- **Do** set ids, type specs, DDL, timestamps, keycaps, and tracked labels in Spline Sans Mono with `"tnum" 1` on.
- **Do** reserve Saira Condensed for uppercase, letter-spaced plate headings (sheet title, dial status, queue position).
- **Do** layer surfaces by tone (`--bg` → `--sheet-2` → `--sheet` → `--panel`) instead of adding shadows.
- **Do** keep the revision status a marker advancing along a visible four-step sequence.
- **Do** de-emphasise with smaller size and lighter weight while holding text at full AA contrast.
- **Do** gate hover treatments behind `@media (hover: hover)` and honour `prefers-reduced-motion: reduce`.
- **Do** keep the focus ring `2px solid --focus` at `2px` offset (`6px` on zone anchors), visible for keyboard users and suppressed for pointer via `:focus:not(:focus-visible)`.

### Don't:
- **Don't** convey any state by colour alone.
- **Don't** round corners — the 3px `<kbd>` keycap and the 9px status dot are the only radii in the system.
- **Don't** use drop shadows for depth; `--shadow-sheet` under the sheet (and the keymap popover) is the entire shadow vocabulary.
- **Don't** lower opacity to push an element back.
- **Don't** reintroduce a commit-graph spine, diff hunks, or a unified-diff dump — the comparison is a three-way table with the base stated plainly and no spine.
- **Don't** use icon fonts or raster icons; author every glyph as inline SVG stroked at 1.4.
- **Don't** add a third provenance/accent hue — the palette is two provenance colours, `--ok` green, and the off-palette blue focus ring.
- **Don't** render the revision status as a stamp or a "MERGED" badge.
- **Don't** let the condensed display face carry data, or set it anything but uppercase and letter-spaced.

## The Front Door (signed-out gate, `/`)

The username gate is the one **Persuade**-mode surface — the product's front door.
Everything else in the app stays Operate and inherits this system unchanged; the
gate keeps the palette, tokens, border ladder, square corners, and mono body but
adds two things used **nowhere else**:

- **A serif nameplate.** `--ff-mark` (Fraunces 700) sets the wordmark "ryft" on
  the gate sheet only. Every other "ryft" in the product is the condensed
  display face. The serif is a front-door voice, not a second brand.
- **A full-bleed generative field** (`web/src/surfaces/SignInField.tsx`, canvas):
  two provenance fronts drift into one another — `--ours` (prussian) owns the
  upper half, `--theirs` (oxide) the lower — and cross through a turbulence swell
  at centre. That weave is the merge; there is no third hue. Small `ours` /
  `theirs` labels sit at diagonally opposite corners. The field is decorative
  (`aria-hidden`, `pointer-events: none`), DPR-capped at 2, throttled to ~40fps,
  paused while the tab is hidden, painted as a single static frame under
  `prefers-reduced-motion`, and re-reads the palette when the theme changes.

The sheet itself is the standard bordered sheet with the 7px inset drawing
border and `--shadow-sheet`; it sits left over the field, opaque so the field
never shows through the reading area. The in-sheet error still uses the
`ryft-rule-in` left-to-right wipe. Nothing here changes the Operate surfaces.
