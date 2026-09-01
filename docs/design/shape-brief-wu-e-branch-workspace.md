# ryft — WU-E · Branch workspace — shape brief (final)

Focused `/impeccable shape` pass + targeted grill, 2026-09-01. Scope: `/branch/:name`.
Companion to `shape-brief-app-flow.md` §4 (stands) and `app-flow-work-breakdown.md` WU-E.
A plan — not code, not a direction contract. The visual world is inherited unchanged from
`DESIGN.md` ("The Revised Drawing"); this pass resolved composition and interaction only.
Two concept questions were settled from a rendered mockup
(`docs/design/mockups/wu-e-concepts.html`); seventeen were settled in the grill (§8).

---

## 1 · Job and audience

- **Route:** one route, `/branch/:name`. Rail sub-sheets: **Schema** · **Divergence**
  (`History` disabled, V1). Sub-sheet switch is a query param — `?sheet=schema|divergence`,
  default `schema` — not a route-table entry (decision 2). Switching is rail-only; the
  title strip carries the branch name and the merge-request action, no sub-sheet tabs.
- **Mode:** Operate — the visitor evolves a branch's schema and gets it ready to merge.
- **Who & when:** the core working surface. An engineer who has cut a branch from `main`
  and needs to rename / add / retype / drop a column, add or change an index, or create /
  drop a table — then see how the branch diverges from `main` and open a merge request.
  After merge-review, the most important surface in the product: it is where renames get
  recorded *as renames*, which is the entire positioning.
- **Uniquely true here:** every edit is one recorded `Operation` against a stable object
  id; a rename is a first-class operation, never a drop + add. The card is a live schema
  document — not a form, not a migration file.

## 2 · Outcome and proof

- **Primary tasks:** (a) read this branch's current schema as table cards; (b) change it
  through in-card structured controls, each edit committing one operation; (c) see the
  two-way divergence from `main`; (d) open a merge request.
- **Success:** a schema change made in a few in-place edits, each visibly recorded, with
  divergence correct — including a rename followed across an index.
- **Real evidence / content:** fixture branch `contact-fields` off `main@8f2c1a`, through
  the data seam (fixture + http, §6). Schema of 3–40 tables. The worked `users` table
  carries a rename (`email` → `email_address`), a retype (`phone` varchar(20) →
  varchar(32)), an add (`verified_at`), and an index add on the renamed column
  (`uq_users_email`), demonstrating rename-rebase inside one branch.

## 3 · Selected direction

- **Visual authority:** `DESIGN.md`, unchanged. Table card = the Cards/Containers spec
  already there — `1.5px --ink` frame, square, title strip with object name + stable id,
  Columns → Indexes → Constraints. Applied edits stamp the row with `△N` in the `--ours`
  role. Divergence reuses the merge-review comparison as an extracted primitive.
- **Structural thesis — Schema:** one always-editable view, no view/edit toggle. Each row
  shows its read-only spec at rest, so the card reads as a schema. **Hover (pointer) or
  focus-within reveals a single `Edit` control** (mono, right-aligned, `--ink-faint` →
  `--ink`) — a plain visibility change, no animation. **Click anywhere on the row, or
  Enter/Space on the `Edit` button, expands that row in place** into its editor (name
  field, type select, nullable select, and — where in scope — a drop control), one row
  open at a time. Focus moves to the first control on expand; `Esc` collapses and returns
  focus to `Edit`. Each control commits its own operation (§8 Q15).
- **Structural thesis — Divergence:** the client fetches `head` + `base` for the branch,
  runs `diffSnapshots(base, head)` **client-side** (the engine is framework-free and
  importable), and projects the derived `Operation[]` into a comparison grid — **grouped
  by table (outer), object-kind within** — `on main` (the base state) vs `on this branch
  — ours`. Base column always renders the base state (`—` only for adds). No `theirs`
  column, no conflict queue, **no `△N`** (a derived delta has no log identity — §8 Q10):
  rows carry the change-kind label and `<s>old</s> → <b>new</b>`. Filter chips
  (`Changes only` / `All N`), collapsible table groups, bounded scroll.
- **Component extraction:** lift a dumb `<ComparisonGrid columns={…} rows={…} />`
  (cells, optional leader line, optional per-row render slot) into
  `web/src/surfaces/kit/`. Merge-review composes its conflict badges / queue links into
  the slot; Divergence passes none. `/merge/:id` must render pixel-identical after the
  refactor — E3 ships with before/after screenshots.
- **Sequence (internal):** E1 schema view (read-only cards; drafts `DESIGN.md` **Detail
  pattern**) → E2 structured editor (drafts **Form pattern**) → E3 divergence sub-sheet +
  the `ComparisonGrid` extraction (parallel-safe) → E4 open-merge-request action.
- **Focal moment:** applying a rename and watching the `△N` land on the row *and* a line
  append to the operation list — the product's whole claim in one interaction.

## 4 · Scope and boundaries

- **Fidelity:** V0 band (`shape-brief-app-flow.md` §2) — correct structure, on-world,
  every state including empty, fully keyboard-operable, AA. **No motion, minimal
  micro-interaction, no signature animation.** The hover/focus reveal is a visibility
  toggle.
- **Breadth:** the whole `/branch/:name` route — Schema + Divergence sub-sheets + the
  open-MR action. `History` sub-sheet is out (V1).
- **Editable operations (V0 — §8 Q2):** `renameColumn`, `retypeColumn`, `setNullable`,
  `dropColumn`, `addColumn`, `addIndex`, `changeIndex`, `dropIndex`, `createTable`,
  `dropTable`. **Out of V0:** primary-key edits, foreign-key add/change/drop, unique
  add/change/drop, `setDefault`, `renameTable` — all shown read-only (§8 Q11).
- **Untouched:** the merge-review surface's behaviour and appearance at `/merge/:id` —
  only its comparison markup is lifted into the shared kit, and only so that surface
  stays pixel-identical. `PRODUCT.md`, `shape-brief-app-flow.md`,
  `app-flow-work-breakdown.md` are read-only here.
- **Anti-goals:** no view/edit mode toggle; no batched "Save" and no row-level "Apply"
  button (per-control apply); no cascading drops; no commit-graph spine or unified-diff
  dump in Divergence; no third accent hue; no `409` ever shown to the user for the
  open-MR action.

## 5 · States and ranges

- **Schema:** loading · error · unchanged branch (no `△` anywhere) · mid-edit (rows
  stamped) · a row open in its editor · an invalid pending edit held with an inline
  message from `validateOperation`, not committed · a drop with dependents — inline
  confirm, then the `drop-blocked` `OpError` renders its `dependents[]` as "remove these
  first: …", never cascaded · a non-blocking warning (`narrowing-retype`,
  `not-null-no-default`, `drop-destructive`) surfaced on the row after commit ·
  save-in-flight (awaited POST) on one control · many tables (3–40) · a wide table (5–40
  columns, 2–15 indexes / constraints).
- **Divergence:** loading · error · **empty (unchanged branch)** — first-class zero
  state: sheet frame kept, "This branch matches `main` — nothing to merge.", no MR action
  · typical (a handful of changed rows across a few tables) · a rename rebased into an
  index (leader line, `--ok`).
- **Route:** `/branch/<unknown>` → not-found: sheet frame + "No branch named `x`." + a
  link to `/branches`.
- **Exercise flags (§8 Q13):** `?empty`, `?wide`, `?error`, `?loading`. `?many` is a
  fixture toggle, not a documented flag.
- **Ranges:** branch name to `BRANCH_NAME_MAX` (39); object names to Postgres' 63; type
  specs exact-match strings (`varchar(255)` ≠ `varchar(256)`).

## 6 · Interaction and layout

- **Topology:** left rail carries `SCHEMA · DIVERGENCE` under the active branch; the
  sheet body holds the active sub-sheet. Title strip: branch name + the contextual
  merge-request action (§8 Q16).
- **Schema hierarchy:** sheet-level `+ create table` → per-card strip (name, stable id,
  `+ column`, `+ index`, `drop table`) → group headers (Columns / Indexes / Constraints)
  → rows. One row's editor open at a time; opening another closes the first, discarding
  its uncommitted control state silently (§8 Q9). Add / create use the same inline
  expand-in-place editor (§8 Q14); a new table needs a name + one column.
- **Apply mechanic (§8 Q1, Q15):** on confirm — text control on Enter or blur (`Esc`
  reverts); `<select>` on change — the control enters a pending state and
  `POST /branches/:name/operations { ops:[op] }`. On `200` the server's `head` becomes
  truth and `headVersion` is retained; on `422`/error the control reverts and shows the
  message. `validateOperation(head, op)` runs client-side before confirm for inline
  feedback, so a server `422` is the rare belt-and-braces path. The expanded editor
  groups controls visually — it is not a form with one submit.
- **Destructive edits (§8 Q5):** `drop column` / `drop index` / `drop table` open an
  inline confirm strip, then run the validate → POST path. A `drop-blocked` result lists
  its dependents inline.
- **Undo (§8 Q6):** a single "undo last operation" affordance on the Schema sub-sheet,
  walking `seq` backward via `DELETE /branches/:name/operations?after=<seq>`. No arbitrary
  revert in V0.
- **Operation list (§8 Q7):** one compact, bounded-scroll list on the Schema sub-sheet,
  reusing merge-review's `OperationLog`, fed by `GET /branches/:name/operations` (and the
  `appliedSeqs` from each POST). It is the running "it landed" surface and grows into the
  V1 persistent side panel.
- **`△N` on rows (§8 Q10):** a changed row shows the highest `LogEntry.seq` of the ops
  that touched it; a LIFO undo removes tail entries and the counter continues from the new
  max.
- **Divergence:** filter chips, table-grouped collapsible rows, bounded internal scroll so
  the title strip and MR action stay in view. Changed rows ringed (`outline` +
  `--ours-wash`), consistent with merge-review's diverged-row treatment.
- **Responsiveness:** cards single-column below the app-flow breakpoints; the Divergence
  grid collapses its columns to stacked (`DESIGN.md` §Layout responsive), the `ours`
  header gaining a top rule in its role colour.
- **Transitions:** none beyond instant state changes (V0); `prefers-reduced-motion`
  honoured globally.

## 7 · Constraints and integration

- **Platform / delivery:** React SPA, React Router v8 declarative. One `<Route>` already
  exists (`/branch/:name` → `BranchWorkspace`); WU-E replaces the stub component.
  Co-located `web/src/surfaces/branch/*.css`; no shared surface stylesheet.
- **Data seam additions** (`web/src/data/`, fixture + http implementations, per the
  existing dual-source pattern):
  - `getBranchDetail(name): Promise<BranchDetail>` — `GET /branches/:name`
    (`head` + `base` `SchemaDocument`, `divergence`, `openMergeRequestId`).
  - `applyOperations(name, ops): Promise<{ head, appliedSeqs, headVersion }>` —
    `POST /branches/:name/operations`.
  - `undoAfter(name, seq): Promise<{ head, headVersion }>` —
    `DELETE /branches/:name/operations?after=<seq>` (endpoint shape owned by WU-E per
    `backend-contract.md` §3).
  - `listBranchOperations(name): Promise<LogEntry[]>` — `GET /branches/:name/operations`.
- **Engine-track coordination** (WU-E depends on these; land them in `engine/` first or
  add them as part of WU-E):
  - `freshId(kind, context): string` — pure, `crypto`-based random suffix, id format per
    `engine/schema.ts`. The client mints ids for `addColumn` / `addIndex` / `createTable`.
  - `validateOperation` hardening — an id-format + freshness rule so a malformed or
    colliding client id returns a typed `OpError` instead of being stored. The server
    re-runs `applyOperation`/`validateOperation` regardless (§8 Q3).
- **Accessibility:** WCAG 2.1 AA. The `Edit` affordance is a real `<button>` reachable by
  focus, not hover alone; the row is not itself a button. Editors fully keyboard-operable
  with visible focus; every control carries an accessible name and state. `△N`,
  drop-blocked status, and divergence direction never colour-alone (triangle + text /
  label + strikethrough). Divergence filter chips and group toggles expose pressed /
  expanded state.
- **Reused components:** `ComparisonGrid` (new, extracted to `kit/`), `OperationLog`,
  `RevisionTriangle`, `SurfaceSheet` + kit `EmptyState` / `StatusPill`.
- **`DESIGN.md`:** E1 drafts the **Detail pattern**, E2 the **Form pattern**, each into
  `docs/design/.scratch/design-<section>.md` — not into `DESIGN.md` directly (WU-G
  consolidates from built code). The `ComparisonGrid` extraction is described inside the
  Detail-pattern draft; it does not own a section.

## 8 · Resolved by the grill

| # | Decision |
|---|---|
| Q1 | **Awaited apply.** Control → pending → `POST` batch of one → server `head` becomes truth. No local mutation ahead of the server. `validateOperation` runs client-side pre-confirm. |
| Q2 | **V0 editable ops:** rename / retype / setNullable / drop column; add column; add / change / drop index; create / drop table. Everything else read-only. |
| Q3 | **Client mints ids** via a new pure `engine/freshId`; `validateOperation` gains an id-format + freshness rule; server re-validates unconditionally. Not server-mint (keeps logged op == applied op, keeps seams symmetric). |
| Q4 | **Divergence:** table-grouped, object-kind within. **Seam:** dumb `<ComparisonGrid>` with a per-row render slot; merge-review composes its conflict UI into the slot. |
| Q5 | **`drop` is confirm-first** — inline confirm strip, then the validate → POST path. `drop-blocked` lists `dependents[]` inline. |
| Q6 | **Undo is LIFO only for V0** — "undo last operation" via `DELETE …/operations?after=<seq>`. Arbitrary revert is V1. |
| Q7 | **Minimal always-visible operation list** on the Schema sub-sheet (reused `OperationLog`), fed by the operations endpoint. Grows into the V1 side panel. |
| Q8 | **Single `Edit` affordance** on hover/focus-within — not a multi-button quick-action cluster. |
| Q9 | **Uncommitted edit on navigation → discard silently** (V0). A discard prompt is V1. |
| Q10 | **No `△N` in Divergence** (change-kind + strikethrough only). Schema-view `△N` = highest `seq` touching the row; LIFO undo continues the counter from the new max. |
| Q11 | **Card shows every schema object** (PK, FK, unique, default, nullability) read-only; controls only for the Q2 set. |
| Q12 | **`ComparisonGrid` lives in `web/src/surfaces/kit/`.** Merge-review imports it from the kit. |
| Q13 | **Exercise flags:** `?empty`, `?wide`, `?error`, `?loading`; real not-found on an unknown `:name`. `?many` is a fixture toggle. |
| Q14 | **Add / create = inline blank editor** (same expand-in-place grammar). `createTable` minimum: name + one column; no PK required. |
| Q15 | **Per-control immediate commit** (text: Enter/blur, Esc reverts; select: on change); each its own `POST` batch of one. Not a form with one submit. Warnings render post-commit, non-blocking. Edit-button a11y model as in §3. |
| Q16 | **Contextual merge-request button:** absent (`divergence === 0`) / **Open merge request** (`POST` → navigate to `/merge/:id`) / **View merge request** (`openMergeRequestId` set → link, no `POST`). |
| Q17 | **Sub-sheet switch = query param** `?sheet=schema\|divergence`, default `schema`, rail-only, no title-strip tabs. `History` stays disabled. DESIGN.md drafts → `docs/design/.scratch/`. |

## 9 · Still open (V1 / not blocking the build)

- Arbitrary-order operation revert (needs the History sub-sheet).
- The hover/focus quick-action cluster (rename / retype / drop shortcuts) — cheap V1 add
  if the single affordance proves too quiet.
- A discard-confirm prompt for an uncommitted edit on navigation.
- Primary-key / foreign-key / unique / default editing, and `renameTable`.
- Rail collapse behaviour below ~900px — owned by the shell, not WU-E.
- Motion grammar on edit-apply, the drop-blocked reveal, the rebase leader-line draw-in
  (V1 polish pass, `shape-brief-app-flow.md` §5).
