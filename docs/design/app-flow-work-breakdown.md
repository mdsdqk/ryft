# ryft — app-flow work breakdown

Turns `shape-brief-app-flow.md` (the plan) into work units that different people or
agents can pick up in parallel. Each unit names the files it owns, what it depends on,
the open questions it is allowed to treat as settled, and what "done" means.

- **Plan / intent:** `docs/design/shape-brief-app-flow.md` — §3 route table, §4 per-surface
  detail, §5 sequence. This document does not restate it; a unit reads its own row here
  **and** the matching §4 entry.
- **Product truth:** `PRODUCT.md`. **Visual world:** `DESIGN.md` + `web/src/styles/`.
- **Status:** the app shell (router, rail, route table, sign-in gate, merge-review wired)
  is built and on `main`. Everything below is unbuilt or a stub.

## How to use this

1. Pick one work unit. Do not start a unit whose **Depends on** is unmet.
2. Read this row, the §4 entry it points at, and `DESIGN.md`.
3. Touch only the files under **Owns**. For anything under **Shared write-points**, follow
   the convention in that section.
4. Meet the **Acceptance** checklist before handing back. Draft the unit's `DESIGN.md`
   section into `docs/design/.scratch/design-<section>.md`; `WU-G` merges it.

## Cross-cutting decisions

Resolved decisions bind every unit. "Proposed" means a builder may proceed on the stated
answer, but the project owner should confirm — flag it in the handoff, do not re-litigate
mid-unit.

| # | Question | State | Answer |
|---|---|---|---|
| 1 | Client router | **Resolved** | Hand-rolled `web/src/router/router.tsx`. Do not add `react-router`. |
| 2 | Divergence: sub-sheet or route | **Resolved** | Sub-sheet of `/branch/:name` (rail nests `Schema · Divergence · History`). Not its own route. |
| 3 | Structured-editor commit model | **Proposed** | Per-control apply — each control commits one operation on change/confirm, no batched "save". Matches PRODUCT.md "one operation, one intent" and keeps undo unambiguous. |
| 4 | Identity surfacing | **Proposed** | Author names appear in lists, the operation log, and merge review. No org label in V0 (single organisation). `User`/`Organization` stay modelled, not shown. |
| 5 | Data access | **Proposed** | Introduce a seam `web/src/data/` — one interface per resource (`branches`, `merges`, `database`, `branchSchema`), a fixture implementation now, a real Hono/Drizzle implementation later (out-of-band track below). Surfaces import the seam, never `demo.ts` directly, from WU-0 onward. |
| 6 | `?scenario=` on merge-review | **Resolved** | Keep for V0. Real fetch-by-`:id` lands with the data seam's real implementation. |
| 7 | Production deep links | **Deferred** | SPA needs a host rewrite (`vercel.json` or equivalent). Belongs to the deploy pass, not a surface unit. |
| 8 | List sort / filter | **Proposed** | Not in V0. Revisit at V1 for `/branches` and `/merges` only. |

## Shared write-points

Files more than one unit will touch. Follow the convention or you will create conflicts.

- **`web/src/shell/routes.tsx`** — every surface unit adds one import and one branch to the
  flat `if`-ladder in `Routes`. Keep it a flat ladder in route-table order (§3). A conflict
  here is a one-line re-add; never restructure the function in a surface unit.
- **CSS** — `web/src/styles/shell.css` is shell chrome only (app bar, rail, stage, sign-in,
  placeholder sheet). **WU-0 moves the surface patterns already sitting in it** (`.shl-facts`,
  `.shl-rows`, `.shl-row*`) into the shared kit. From then on **each surface unit adds a
  co-located `web/src/surfaces/<Surface>.css`** imported by its component — no shared surface
  stylesheet, no cross-unit CSS conflicts.
- **`web/src/data/`** (after WU-0) — one file per resource. A unit adds fields to its own
  resource's fixture; it does not restructure another unit's resource.
- **`web/src/shell/Rail.tsx`** — only `WU-E` edits it (branch sub-sheets are already stubbed;
  wire `Divergence` / `History` when those parts land). No other unit touches it.
- **`web/src/shell/demo.ts`** — folded into `web/src/data/` fixtures by WU-0; after that it is
  deleted, not extended.
- **`DESIGN.md`** — one section per owner (table below). Two units never edit the same section.
- **`PRODUCT.md`, `shape-brief-app-flow.md`, this file** — read-only for surface units. Only a
  coordination change (resolving an open question, re-sequencing) edits them.

## DESIGN.md section ownership

`shape-brief-app-flow.md` §6: durable sections are written **from built surfaces**, not ahead
of them. Each unit drafts its section; `WU-G` consolidates and harmonises.

| `DESIGN.md` section | Written by | From |
|---|---|---|
| App shell + nav | WU-G | the committed shell |
| List pattern | **WU-A** | `/branches` |
| Detail pattern | **WU-E1** | branch schema view |
| Form pattern | **WU-E2** | structured editor |
| Auth pattern | **WU-C** | sign-in |
| Merge review | — | unchanged |

## Work units

### WU-0 · Shared foundations *(serial, first, blocks all surface units)*

- **Goal:** the shared surface kit + data seam, so parallel units do not each reinvent rows,
  sheets, empty states, or data access.
- **Owns:** new `web/src/surfaces/kit/` — `SurfaceSheet` (the `<article class="mr-sheet">` +
  title-strip wrapper, optional primary-action slot), `SheetList` + `Row` (from Dashboard's
  inline `.shl-rows`/`.shl-row`), `FactList` (from `.shl-facts`), `EmptyState`,
  `StatusPill` (dot + word, never colour alone). New `web/src/data/` seam (decision 5) with
  fixture implementations migrated from `web/src/shell/demo.ts`; delete `demo.ts`. Move the
  surface CSS out of `shell.css` into `web/src/surfaces/kit/kit.css`.
- **Depends on:** nothing. **Blocks:** WU-A, WU-B, WU-D, WU-E.
- **Settled:** decisions 3, 4, 5 (confirm with owner in handoff).
- **Acceptance:** Dashboard refactored onto the kit with no visual change (screenshot diff);
  `tsc` clean; impeccable detector clean; kit components have the five states wired as props.

### WU-A · Branches list — `/branches` *(parallel after WU-0)*

- **Goal:** every branch on the database; create from `main`; delete.
- **Reads:** §4 "Branches — the list".
- **Owns:** `web/src/surfaces/Branches.tsx` + `Branches.css`; `web/src/data/branches.*`;
  one line in `routes.tsx`.
- **Depends on:** WU-0. **Blocks:** WU-B and WU-D (they consume the list pattern it defines).
- **Defines:** `DESIGN.md` **List pattern**.
- **Settled open questions:** create → inline form / popover in the title strip; delete →
  confirm inline, name what is lost; an open merge request on a branch **blocks** its delete
  and says why; sort/filter → out (decision 8).
- **Acceptance:** rows (name, author, cut date, `△N` / "no changes", open, delete); create;
  delete with confirm; empty ("no branches yet" + the create action); loading; error;
  keyboard + visible focus; AA; not-colour-alone; responsive; on-world; `tsc` + detector
  clean; List-pattern section drafted.

### WU-B · Merge requests list — `/merges` *(after WU-A)*

- **Goal:** every open merge request; enter one to review it.
- **Reads:** §4 "Merge requests — the list".
- **Owns:** `web/src/surfaces/Merges.tsx` + `Merges.css`; `web/src/data/merges.*`; one line
  in `routes.tsx`.
- **Depends on:** WU-A (consumes the List pattern; does not define one).
- **Settled open questions:** the "open a merge request" action lives on the **branch
  workspace**, not here; ordering is oldest-first (merge-queue semantics).
- **Acceptance:** rows (`source → main`, author, opened, status via `StatusPill`); enter
  review; empty; loading; error; keyboard; AA; not-colour-alone; responsive; on-world;
  `tsc` + detector clean.

### WU-C · Sign-in polish + auth pattern — `/` *(parallel after WU-0; most independent)*

- **Goal:** raise the built sign-in stub to V1 and record the auth pattern.
- **Reads:** §4 "Sign in — the username gate".
- **Owns:** `web/src/surfaces/SignIn.tsx` + `SignIn.css`.
- **Depends on:** WU-0 only (light — no kit needed). **Blocks:** nothing.
- **Defines:** `DESIGN.md` **Auth pattern**.
- **Settled open questions:** unknown username → proceed with an inline "this creates a new
  user" note, no modal; impersonation non-goal → the existing one-line statement stays.
- **Acceptance:** states (empty, typing, submitting, unknown-name note, error); motion (V1,
  minimal/mechanical); responsive; keyboard; AA; `tsc` + detector clean; Auth-pattern
  section drafted.

### WU-D · Dashboard — `/db` *(after WU-A; parallel with WU-B)*

- **Goal:** the database overview, on the real kit rather than its current inline markup.
- **Reads:** §4 "Dashboard / database — the overview".
- **Owns:** `web/src/surfaces/Dashboard.tsx` + `Dashboard.css`; `web/src/data/database.*`;
  reuses `Row` from WU-A's pattern.
- **Depends on:** WU-0, WU-A.
- **Settled open questions:** a "new branch" action appears here too (mirrors `/branches`);
  no `main` schema preview in V0 — link out to the branch workspace.
- **Acceptance:** fact list; open-merges list; recent-branches list capped with a "more →"
  link; empty (freshly seeded database); loading; error; keyboard; AA; responsive; on-world;
  `tsc` + detector clean.

### WU-E · Branch workspace — `/branch/:name` *(parallel with A/B/C/D; internally sequenced)*

The largest unit and the one that sets the detail + form patterns. One agent owns the whole
unit; the sub-parts are its internal order. **E3 may run as a parallel sub-unit** (it reuses
the merge-review comparison component and shares no files with E1/E2).

- **Reads:** §4 "Branch workspace — schema cards + structured editor + divergence".
- **Owns:** `web/src/surfaces/branch/` (all of it) + `branch/*.css`;
  `web/src/data/branchSchema.*`; `web/src/shell/Rail.tsx` (wire the sub-sheets);
  one line in `routes.tsx`.
- **Depends on:** WU-0. **Blocks:** WU-F.
- **Defines:** `DESIGN.md` **Detail pattern** (E1) and **Form pattern** (E2).

  - **E1 — schema view:** table cards (the Cards spec in `DESIGN.md`), read-only. Columns →
    indexes → constraints per card; object name + stable id; `△N` marker on changed rows.
  - **E2 — structured editor:** in-card form controls — rename, retype, drop a column;
    add column / add index; create / drop table. Per-control apply (decision 3); each
    applied edit appends to the operation log (reuse `OperationLog`). A drop with dependents
    is refused inline with an explicit "remove these first" list — never cascaded.
  - **E3 — divergence sub-sheet:** the merge-review `ComparisonTable` run **two-way**
    (`on main` vs `on this branch`), base stated, grouped, filter chips, bounded scroll. No
    `theirs` column, no conflict queue. Rename renders `<s>old</s> → <b>new</b>`.
  - **E4 — open merge request:** primary action on the Divergence sub-sheet and in the
    title strip.
- **Settled open questions:** schema + editor is one always-editable view (no view/edit
  toggle); `History` sub-sheet is V1; "open MR" lives on Divergence + title strip.
- **Acceptance:** per sub-part — real content at the §4 ranges (3–40 tables, wide tables);
  states (unchanged branch = empty Divergence, mid-edit, drop-blocked, invalid pending
  edit, loading, error, saving); keyboard; AA; not-colour-alone; responsive; on-world;
  `tsc` + detector clean; Detail- and Form-pattern sections drafted.

### WU-F · Empty-states pass *(after A, B, D, E)*

- **Goal:** `PRODUCT.md` principle — every list and page ships a first-class zero state.
- **Owns:** small edits across the built surfaces; the `EmptyState` kit component.
- **Depends on:** WU-A, WU-B, WU-D, WU-E (needs their real structure).
- **Acceptance:** no branches; no open merges; unchanged branch; freshly seeded database;
  a table with no indexes / no constraints — each keeps the sheet frame, carries one plain
  sentence + the one action that changes it, no illustration.

### WU-G · DESIGN.md consolidation *(after WU-E and one of WU-A/WU-C)*

- **Goal:** merge the drafted pattern sections into `DESIGN.md`, harmonised, from built code.
- **Owns:** `DESIGN.md` (the shell, list, detail, form, auth sections; merge-review section
  untouched); its `.impeccable/design.json` sidecar.
- **Depends on:** the drafts from WU-A, WU-C, WU-E in `docs/design/.scratch/`.
- **Acceptance:** every section describes what is in the code, not intent; the design-system
  detector runs clean over the app.

## Parallelisation map

```
WU-0  ─────────────────────────────────────────────────────────────────┐
      (serial, first)                                                  │
                                                                       ▼
      ┌──────────────┬──────────────────────────┬─────────────────────────────┐
      │ WU-C  auth   │ WU-A  branches (list ptn) │ WU-E  branch workspace      │
      │ (independent)│        │                  │  E1 detail ─ E2 form        │
      │              │        ▼                  │  E3 divergence (parallel)   │
      │              │ WU-B  merges              │  E4 open-MR                 │
      │              │ WU-D  dashboard           │                             │
      └──────┬───────┴──────────┬───────────────┴──────────────┬──────────────┘
             │                  │                              │
             └──────────────────┴───────────► WU-F  empty states
                                                    │
             WU-C / WU-A / WU-E drafts ───────────► WU-G  DESIGN.md
```

- **Disjoint by design:** WU-C owns *auth*, WU-A/B/D own the *list* pattern, WU-E owns
  *detail* + *form*. Different files, different `DESIGN.md` sections, different data
  resources — so WU-C, WU-A, and WU-E can start together the moment WU-0 lands.
- WU-B and WU-D wait for WU-A only because they consume its List pattern.

## Out-of-band tracks

Not surface units; run alongside on their own schedule.

- **API + persistence** — Hono API, Neon Postgres, Drizzle (`PRODUCT.md` §Stack). Fills in
  the real implementations behind the `web/src/data/` seam (decision 5). Until it exists the
  whole UI is fixture-bound, which is a valid V0 state.
- **Deploy** — Vercel build for `web/` + the SPA rewrite (decision 7) + the seeded demo
  instance. Owns any `vercel.json` / host config.
