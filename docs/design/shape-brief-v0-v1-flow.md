# ryft — V0→V1 flow · design brief

Confirmed 2026-08-30. Output of `/impeccable shape`. This is a brief, not a direction
contract and not code — it fixes what to build and how it should work. Visual-world
reference mockups live in `docs/design/mockups/` (`7-drafting-room.html` and
`8-stress-test.html` are the merge-review reference; `1`–`6` are the direction options
that were considered).

## 1 · Job and audience

Engineers on a team sharing one Postgres database, reconciling concurrent schema changes.
They arrive from a merge notification or their branch list, mid-task, needing to answer two
questions fast: *what diverged*, and *is it safe to merge*. Secondary audience: a reviewer
cold-cloning the repo. **Visitor mode: Operate** throughout — the username landing is a
ten-second gate, not a Persuade surface.

## 2 · Outcome and proof

The visitor resolves every conflict and produces ordered, runnable Postgres DDL — or
understands exactly why the merge is held. Proof only ryft can show: a rename followed
across branches (the unique index lands on `email_address`, not a dropped column),
conflicts sorted into named classes, and a commutativity check gating the "clean" verdict.

## 3 · Selected direction — "The Revised Drawing"

- **World:** the drafting room — a schema is a controlled engineering drawing; a merge is a
  *revision* with a checker's sign-off, not a pull request. Bordered sheet, title block,
  numbered revision triangles (`△1`), revision clouds ringing what diverged, leader-line
  annotations, monospace throughout, a condensed technical display face.
- **Structural thesis:** every screen reads in a lettered zone order. The merge-review
  screen is **A** three-way comparison (object + stable id in the gutter, *on ours* /
  *on theirs* columns, base stated plainly — **no commit spine**) → **B** conflict queue →
  **C** operation log with attribution → **D** fabrication order (DDL).
- **Provenance is two colours everywhere:** ours / theirs / conflict. Auto-merged rebases
  render on a faint success wash and never enter the queue.
- **Status is a dial, not a stamp:** `Received → In check → Cleared → Released`, current
  step boxed. It visibly turns; it is never an authority seal.
- **Raises carried in:** *foreground sheet* — the active conflict holds full contrast, the
  rest ghosts to underlay; *single drawline* — one primary action per screen.
- **Palettes:** **Diazo** (light, default) and **Cyanotype** (dark, toggle). Theme-aware.

## 4 · Scope and boundaries

**In scope:** username landing · branch list · branch schema view + a structured
(form-driven) editor that records operations including renames · open-merge-request · the
merge-review screen (diff + classify + resolve + commutativity + DDL) · merged / empty /
first-run states.

**Fidelity:** production-ready screens, the full flow, real interaction.

**Untouched:** the `engine/` API contract, the schema-document shape, PRODUCT.md truth.

**Anti-goals:** no commit graph or branch-of-branch UI; no SQL console (stretch only); no
marketing register; no gamified "merge!" moment; no full-row red/green diff washes
(PlanetScale's default, and its reference screenshots' habit).

## 5 · States and ranges

- Schema: 3–40 tables; a reviewed table has 5–40 columns plus 2–15 indexes/constraints.
- A merge request: 0 changes (nothing to merge) · 1–5 typical · 20+ operations in a rewrite.
- Conflicts: 0 (fast-forward) · 1–2 typical · 4+ spanning all classes. Seven classes
  (`docs/merge-engine.md` §5): divergent retype, add-vs-add, rename-vs-rename, divergent
  index definition, drop-vs-modify, dependency conflict, and **divergent definition** — a
  clear-severity catch-all for a divergent default / primary key / unique / foreign-key
  change. Six are *clear*; dependency conflict is the one *subtle* class.
- Material states: no-changes, clean / fast-forward, held-on-conflict,
  held-on-commutativity-failure (unclassified divergence), resolved-and-merged,
  stale-base re-validation when an MR reaches the front of the merge queue. The
  commutativity check proves order-independence only — a merge that is stable but produces a
  structurally invalid document (a duplicate name, a nullable primary-key member, a dangling
  reference) is caught by a separate validation pass (ticket 0008), not held here.
- Downstream gating is real: one unresolved rename can freeze the index and FK that
  reference it — surfaced in Zone A and Zone D.

## 6 · Interaction and layout

- **Zone A** — grouped (Columns / Indexes / Constraints), each collapsible; sticky group
  headers; bounded scroll (~56vh) so B/C/D stay in view; filter chips (Changes only /
  Conflicts only / All) with live counts.
- **Zone B** — conflict queue: "Conflict N of M", `J`/`K` nav, per-card class badge
  (clear / subtle), ours/theirs with author, `1` / `2` / `3` = take ours / take theirs /
  specify. Resolving advances focus to the next unresolved conflict and announces it via
  `aria-live`.
- **Zone C** — operation log, its own bounded scroll, node colour = side, every `△` links
  to its comparison row and log entry.
- **Zone D** — DDL with each statement tagged to its revision; blocked groups listed as
  reasoned comments; a status line states what unblocks "Cleared" (empty queue +
  commutativity agrees).
- **Structured editor** (branch screen) — a form-driven operation panel (Add column,
  Rename, Retype, Add index, …); each action appends to the operation log; drops are
  blocked on dependents with an explicit "remove these first" message.
- **Responsive:** below ~1100px the ours/theirs columns stack; the rail drops under the
  main column.
- **Motion:** minimal and mechanical — a revision cloud drawing in, the status dial
  advancing a step. No decorative transitions.

## 7 · Constraints and open decisions

**Constraints:**

- Stack: React SPA + Hono on Vercel, Neon + Drizzle.
- Accessibility: WCAG 2.1 AA. Keyboard-first with a documented key map; roving-tabindex
  listbox for the conflict queue; visible 2px focus ring at 2px offset; never colour-only
  (glyph + label + class badge on every conflict). Conflict *text* uses the darker red
  token; the bright red is border/outline only (non-text 3:1).
- Build is **code-led** (no image generation available this session); ambition rides in the
  direction contract's first-viewport and signature-interaction blocks, not a comp.

**Open for the builder — do not invent, decide at build:**

- Exact type scale and spacing grid.
- The condensed display face (candidates: Saira Condensed, Archivo Narrow, or another
  technical grotesk — a face from the impeccable "stopped looking" list needs a reason).
- Whether the structured editor and the merge-review are separate routes or a two-pane
  surface.
- How stale-base re-validation is presented when an MR reaches the front of the queue and
  `main` has moved.
