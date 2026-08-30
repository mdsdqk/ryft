# ryft — whole-app flow · shape plan

Output of `/impeccable shape`, 2026-08-30. A plan, not a direction contract and not
code. It fixes the surface inventory, the shell/routing decision, the per-surface job
and states, and the build sequence. Deep per-surface briefs are written later, one at a
time, as each surface is built. Companion to `shape-brief-v0-v1-flow.md` (the
merge-review brief, which stands).

---

## 1 · Where we are

The merge-review surface is built and sits at roughly production fidelity for itself
(`web/src/merge-review/`, `DESIGN.md`, mockups `7`/`8`). `PRODUCT.md` §Surfaces now
lists nine surfaces; eight are unbuilt. The web app has no router — `App.tsx` renders
the one surface and selects a state through `?scenario=`. The visual world — **"The
Revised Drawing"** (drafting-room revision sheet; Diazo light / Cyanotype dark) — is
committed and every later surface inherits it.

The gap is not visual identity. It is (a) an app shell that turns a single bordered
sheet into a navigable multi-page product, and (b) seven more surfaces drawn in the
same hand.

## 2 · Ambition — two bands

Confirmed with the user:

- **V0 — lesser finesse, better than a skeleton.** Correct structure, on-world (tokens,
  condensed/mono type, the border ladder, square corners, lettered-zone reading order
  where it applies), every state present *including the empty state*, fully
  keyboard-operable, AA contrast. **No motion, minimal micro-interaction, no signature
  animation.** Deployed.
- **V1 — production polish.** Motion grammar, micro-interactions, responsive finish, the
  finish-review loop per surface, `DESIGN.md` grown to cover the shell and the shared
  patterns. Merge-review is already here for itself.

This maps onto `PRODUCT.md` §Capabilities delivery bands: V0 is the walking skeleton
(seed → branch → edit → open MR → three-way diff → clean merge → deployed); V1 adds
conflict detection, classification, and the resolution UI (already built in
merge-review) and raises every surface to polish.

## 3 · The app shell — routing and navigation

**Locked 2026-08-30** from rendered mockups. Chosen: `docs/design/mockups/shell-a-index-rail.html`.
Rejected: `docs/design/.scratch/shell-b-sheet-tabs.html` and `shell-c-title-block.html`.
Built in `web/src/shell/` (V0 slice, 2026-08-30). The durable `DESIGN.md` "App shell +
nav" section is written from the built shell (§6).

### The drawing set — a left sheet-index rail

The database is a *set of drawings*. The shell is the set's binder.

- **Persistent left rail — the sheet index.** A slim drafting-binder tab strip on the
  bone ground, `2px --ink` right rule, listing the top-level sheets: `DATABASE` ·
  `BRANCHES` · `MERGES`. Inside a branch or a merge it expands to the sub-sheets of
  that item (e.g. under a branch: `SCHEMA` · `DIVERGENCE` · `HISTORY`). Mono labels,
  uppercase, letter-spaced; the current sheet boxed with a `1px solid currentColor`
  border, exactly like the revision dial's current step. No icons.
- **App bar unchanged.** Brand, keyboard-help `<details>`, theme switch — as built.
- **Every page is still a bordered sheet** (`.mr-sheet` frame, `::before` inset border,
  the single `--shadow-sheet`) on the ground, with a title strip. Merge-review's four
  lettered zones are one page's internal structure, not the app's — most pages have one
  or two zones, not four.
- **Routing** (client-side; React Router v8 declarative — `BrowserRouter` + the
  flat table in `web/src/shell/routes.tsx`. See work-breakdown decision 1):
  | Route | Surface |
  |---|---|
  | `/` | sign-in when no user; else redirect to `/db` |
  | `/db` | dashboard / database overview (post-sign-in landing) |
  | `/branches` | branches list |
  | `/merges` | merge-requests list |
  | `/branch/:name` | branch workspace — schema cards + structured editor + divergence view |
  | `/merge/:id` | merge review (built) |

### Rejected

- **B · sheet tabs** — folder tabs on the sheet's top edge. No horizontal cost, but the
  sub-sheets (schema / divergence / history) have nowhere to live without a second tab
  row.
- **C · title-block index** — nav inside an interactive drafting title block. Most
  world-native, but too quiet to read as the menu, and it collides with the
  merge-review screen's own title block.

### Rail behaviour to resolve at build

- Width (~230px in the mockup) and whether it collapses below ~900px to a top strip
  (the mockup does) or to an icon rail.
- Whether the rail shows viewer / org identity or leaves it to the app bar.
- Sub-sheet nesting: indent under the active branch/merge vs. replace the top-level list
  while inside one.

## 4 · Surface map

Seven page-surfaces plus one cross-cutting discipline. Each: **job · who & when ·
states · interaction sketch · on-world treatment · open questions.**

### Shell — app frame + nav rail

- **Job:** move between surfaces; always show which database and which sheet you are on.
- **Who & when:** every session, constantly.
- **States:** signed-out (rail hidden, sign-in only) · signed-in · deep in a branch /
  merge (rail shows sub-sheets) · narrow viewport (rail collapses to a top strip).
- **Sketch:** left sheet-index rail + existing app bar; content area holds the active
  surface's sheet. Current sheet boxed. `G` then a letter jumps sheets, reusing the
  in-surface wayfinding pattern already in merge-review.
- **On-world:** rail is drafting-binder tabs; box-the-current like the dial step; `2px
  --ink` divider; no new chrome.
- **Open:** rail vs top-strip (above); does the rail show the org / user anywhere, or is
  identity implicit until a later surface needs it.

### Sign in — the username gate

- **Job:** take a username as truth; known name resumes, unknown creates and proceeds.
  No password, no session.
- **Who & when:** once per person per device, first thing. Also the reviewer's first
  screen from a cold clone.
- **States:** empty · typing · submitting · unknown-name (→ "this creates a new user"
  inline, not an error) · server error.
- **Sketch:** a single sheet, centred, smaller than the app sheets. One labelled text
  input (the *first* text input in the system — merge-review has none), one primary
  button. A line of plain copy stating the no-password model rather than hiding it.
  Enter submits.
- **On-world:** bordered sheet, title strip reading `ryft`, mono field label, square
  input with `1px --line-strong`, `--ink` primary button. Diazo/Cyanotype aware.
- **Open:** does an unknown username confirm ("Create <name>?") or proceed silently with
  an undo-style notice; copy for the impersonation non-goal (state it or stay silent).

### Dashboard / database — the overview

- **Job:** orient. What is this database, what is `main`'s shape, what is in flight.
- **Who & when:** landing after sign-in; returned to between tasks.
- **States:** freshly seeded (few tables, no branches, no merges — near-empty) ·
  typical (some branches, 0–2 open merges) · busy · load / error.
- **Sketch:** title strip names the database. Below, a title-block-style `<dl>` of
  facts (tables, columns, indexes, `main` last changed, open branches, open merges),
  reusing merge-review's Title Block component. Then two short lists: **open merges**
  (each linking to `/merge/:id`, with a held/clear status dot) and **recent branches**
  (linking to `/branch/:name`). No charts, no activity graph.
- **On-world:** framed `<dl>`, `--ink-soft` keys with a `1px --line` right rule; lists
  are hairline-divided rows; the status dot is the same 9px signal lamp as Zone D.
- **Open:** is there a "new branch" primary action here as well as on `/branches`;
  how much of `main`'s schema (if any) is previewed here vs. left to the branch view.

### Branches — the list

- **Job:** see every branch; create one from `main`; delete one.
- **Who & when:** starting a change, or cleaning up after a merge.
- **States:** none yet (empty) · 1–20 typical · a branch with 0 changes vs. one with
  many · delete confirmation · create in progress · load / error.
- **Sketch:** a sheet with a title strip carrying the single primary action **New
  branch from main** (name field in a small inline form or a popover). Below, hairline
  rows: branch name, author, cut-from-`main` date, a divergence count (`△ 4` /
  `no changes`), row actions (open, delete). Delete asks once and names what is lost.
- **On-world:** rows divided by `1px dashed --line`; the `△N` tag is the revision
  triangle component in `--neutral`; author and date in mono with `tnum`.
- **Open:** sort / filter (by author, by divergence, by age) — V1 only, or never;
  whether an open merge request on a branch blocks its delete.

### Merge requests — the list

- **Job:** see every open merge request; enter one to review it.
- **Who & when:** responding to a merge notification; checking what is queued.
- **States:** none open (empty) · 1–5 typical · one held on conflict vs. one clean vs.
  one stale-base · load / error.
- **Sketch:** hairline rows: source branch → `main`, author, opened date, a status
  cell (`clean` / `held · N conflicts` / `stale base`) carrying the 9px dot and a word,
  never colour alone. Row opens `/merge/:id`.
- **On-world:** status cell uses `--ok` / `--conflict-edge` on the dot plus the literal
  word; `→` is plain text, not an arrow asset. No commit spine anywhere.
- **Open:** does this list also offer "open a merge request" (pick a branch), or is that
  action only on the branch workspace; ordering (oldest-first queue vs. newest-first).

### Branch workspace — schema cards + structured editor + divergence

One route, `/branch/:name`. Sub-sheets in the rail: **Schema** · **Divergence**.

- **Job:** view this branch's current schema as editable table cards; evolve it through
  form controls that record every edit as an operation (renames especially); see how
  the branch has diverged from `main`; open a merge request.
- **Who & when:** the core working surface — where a schema change actually happens.
  After merge-review, the most important surface in the product (it is where renames
  get recorded, which is the entire positioning).
- **States:** unchanged branch (Divergence empty) · mid-edit · a drop blocked on
  dependents · an invalid pending edit (duplicate name, nullable PK member) ·
  many tables (3–40) / a wide table (5–40 columns, 2–15 indexes/constraints) ·
  load / error / save-in-flight.
- **Sketch — Schema:** each table is a card — `1.5px --ink` frame, square, title strip
  with the table name and stable id. Rows list columns with type spec (mono, `tnum`),
  then indexes, then constraints. In-place form controls on each row: rename, retype,
  drop; add-column and add-index actions on the card; create-table / drop-table at the
  sheet level. Every applied edit appends to the operation log (reuse the Operation Log
  component) and marks the row with a `△N` triangle in the `--ours` role. A drop with
  dependents is refused inline with an explicit "remove these first" list — never
  cascaded.
- **Sketch — Divergence:** the merge-review Comparison Table (Zone A) run **two-way** —
  `on main` vs `on this branch`, base stated plainly, grouped Columns / Indexes /
  Constraints, filter chips, bounded scroll. No `theirs` column, no conflict queue.
  A rename renders `<s>old</s> → <b>new</b>`. Primary action on this sub-sheet:
  **Open merge request**.
- **On-world:** table card = the Cards/Containers spec already in `DESIGN.md`; edits
  carry the revision triangle and feed the operation log; divergence reuses Zone A
  wholesale at two columns.
- **Open:** schema + editor as one always-editable view vs. a view/edit toggle;
  do pending edits batch into one "apply" or commit per-control (per-control matches
  "one operation, one intent"); where "Open merge request" lives (Divergence sub-sheet
  vs. sheet title strip); is `HISTORY` (raw operation log for the branch) a third
  sub-sheet in V0 or V1.

### Empty states — cross-cutting

- **Job:** `PRODUCT.md` principle — every list and page ships its zero state as a
  first-class thing, not an afterthought.
- **Surfaces:** no branches · no open merges · unchanged branch (empty Divergence) ·
  freshly seeded database · a table with no indexes / no constraints.
- **Sketch:** the sheet frame and title strip stay; the body carries one plain sentence
  of what is not here yet and the one action that changes it (e.g. "No branches yet.
  Cut one from `main` to start a schema change." + **New branch from main**). Mono,
  `--ink-soft`, no illustration, no oversized icon.
- **On-world:** consistent with merge-review's existing loading/error shells
  (`ReviewShell.tsx`) — frame kept, body swapped, never a blank page.

## 5 · Build sequence

### V0 — breadth first, on-world skeletons

1. **App shell** — add a router, the sheet-index rail, route table. Wire the built
   merge-review in at `/merge/:id`. *Unblocks everything.*
2. **Sign-in gate** — `/`, redirect logic.
3. **Dashboard** — `/db`, the facts `<dl>` + two short lists.
4. **Branches list** — `/branches`, rows + create + delete.
5. **Branch workspace** — `/branch/:name`: schema cards + in-place structured editor +
   Divergence sub-sheet (two-way Comparison Table). The largest single piece.
6. **Merge-requests list** — `/merges`, rows + open-MR action.
7. **Empty states** — every list and page above.

### V1 — depth, production polish (priority order)

1. **Branch workspace / structured editor** to production polish — motion on edit-apply,
   the drop-blocked interaction, the pending-invalid feedback, responsive.
2. **Divergence view** polish — the rebase leader lines, revision-cloud ring draw-in.
3. **Dashboard** polish.
4. **Lists** (branches, merges) — motion, hover, responsive finish.
5. **Sign-in** polish.
6. **App-wide motion grammar + per-surface finish review + `DESIGN.md` grown** (§6).

## 6 · What this plan unblocks

- **Per-surface deep briefs.** Each surface above gets a full `/impeccable shape` brief
  (the seven-part structure) *when it is built*, not now — its "open questions" are the
  agenda for that brief.
- **`DESIGN.md` grown app-wide.** The user's intent is for `DESIGN.md` to grow sections
  for App shell + nav, List pattern, Detail pattern, Form pattern, and Auth pattern,
  with the merge-review section left as-is. **Recommended sequencing:** the *direction*
  for each pattern is sketched in §3–§4 here; the durable `DESIGN.md` sections are
  written from the *built* surfaces (per `new-work.md` — a rulebook written ahead of the
  build gets defended against reality), either as each pattern lands or in one
  consolidation pass at V1. Lock the shell direction (§3) first, since everything hangs
  off it.

## 7 · Open decisions parked (cross-cutting)

- **Shell:** locked — left sheet-index rail (§3). Rail width / collapse / identity /
  sub-sheet nesting still to resolve at build.
- **Router:** resolved — React Router v8 declarative (`BrowserRouter` +
  `Routes`/`Route`). See `app-flow-work-breakdown.md` decision 1. The route table
  in §3 is still the product table; do not add nested URLs for Divergence/History.
- **Identity surfacing:** `User` / `Organization` are modelled but the current flow
  never shows them. Decide per surface whether author names, and any org label, appear
  in the shell or only in lists and logs.
- **Structured editor commit model:** per-control apply (matches "one operation, one
  intent") vs. batched apply. Affects the editor, the operation log, and undo.
- **Divergence as sub-sheet vs. route:** planned as a sub-sheet of the branch
  workspace; revisit if it needs to be linkable on its own.
- **Stale-base re-validation** presentation (carried over from `shape-brief-v0-v1-flow`
  §7) — still open, belongs to the merge-requests list and `/merge/:id`.
