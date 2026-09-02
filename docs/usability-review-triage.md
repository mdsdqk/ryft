# Usability Review — Triage & Plan

Source: raw review from a real human user + reviewer's own notes, plus a short
interview. This file maps every point to code, groups the work, and proposes a
sequenced plan with effort bands. **No code has been changed yet.**

Effort bands: **S** ≈ ≤½ day · **M** ≈ ½–2 days · **L** ≈ 2 days+.
"Needs decision" = a product/model call is required before implementation.

---

## The through-line

Most of the review is one complaint wearing several hats: **the drafting-room
metaphor ("The Revised Drawing", DESIGN.md §Creative North Star) leaks invented
vocabulary into a tool whose users already speak SQL and Git.** "Cut", "sheets",
"drawing", "fabrication order", "revision status / received / in-check / cleared
/ released", "issue plate" are one coherent invented system — which is exactly
why piecemeal renaming is risky. Recommendation: treat vocabulary as **one work
unit** (Theme A), land it behind a single ADR, and keep the *visual* drafting
language (bone ground, hatch, square corners, one shadow) untouched — the words
are the problem, not the paper.

Second through-line: **real functional gaps** around the merge-request lifecycle
(no close, no closed/deleted lists, queue state mis-described, branch edits after
MR open are invisible). These are Themes D and F and are independent of the
vocabulary work.

---

## Theme A — Vocabulary & copy

One pass, one ADR. Almost all of this is string/label edits. All open decisions
here are now resolved (see **Decisions — RESOLVED**).

| # | Review point | Where in code | Change | Effort |
|---|---|---|---|---|
| 1a, 3, 4 | "Cut" is slang; want "create" / "branched" | `web/src/surfaces/Branches.tsx` (`CreatePlate` label "Cut from main", button "Cut"/"Cutting…", `lossCopy`, notices "cut from"), `Dashboard.tsx` (same `CreatePlate`), `Branches.css`/`Dashboard.css` class names `*-create`, `BranchWorkspace.tsx` subtitle "cut from main", `Rail.tsx`, `Merges.tsx` header comments, `data/*` notice strings, CONTEXT.md, decisions.md, DESIGN.md | "Cut from main" → **"New branch"** with helper "Branched from `main`" (satisfies point 3's "hint somewhere"); button "Create"; "cut date" → "created" / "branched"; verb in prose → "branched from `main`" | M |
| 1d | "Merges" → "Merge requests" | `Rail.tsx` ("Merges" nav + count), `Merges.tsx` (`SurfaceSheet title="Merges"`, empty copy, `countLine`), `Dashboard.tsx` Zone "Open merges", `routes.tsx`/`AppShell.tsx` doc title already says "Merge requests" (inconsistent today) | Rename nav + sheet title + zone to "Merge requests"; keep route path `/merges` | S |
| 1c, 1h | "Sheets" is undefined jargon; rail hint unnecessary | `Rail.tsx` (`aria-label="Database sheets"`, `"…sheets nest here."` hint, `${name} sheets` sub-labels), `routes.tsx` NotFound "No such sheet" / "database sheets", `PlannedSheet.tsx` | Drop the word "sheet" from user-facing nav copy; remove the `shl-rail__hint` paragraph; aria-labels → "`<name>` views" or just the branch name | S |
| 1e | "Demonstration data" tag is redundant — seeded is how the product works | `web/src/surfaces/kit/SurfaceSheet.tsx` (`demo` prop → `.mr-titlestrip__demo`), call sites in `Branches.tsx`, `Dashboard.tsx`, `Merges.tsx`, `BranchWorkspace.tsx`, plus `MergeReview.tsx` `mr-titlestrip__demo` (that one is different — "worked sample, not this MR's data" — keep) | Remove the `demo` prop and all four call-site usages; keep the SignIn.tsx workspace explainer; keep MergeReview's "demonstration review" note | S |
| 1f | "Main changed" → "Latest update to main" | `Dashboard.tsx` `FactList` fact label `"Main changed"` (value `db.trunkChangedOn`) | Relabel to "`main` last updated" | S |
| 1g | "Object · stable id" column header unclear; "stable id" is internal; "object" doesn't fit a DB | `web/src/surfaces/kit/ComparisonGrid.tsx` `gutterLabel`; passed as `"Object · stable id"` from `merge-review/components/ComparisonTable.tsx` and `surfaces/branch/Divergence.tsx` | Header → **"Table object"** (or just "Object"); drop "· stable id" from the header. Keep the small dimmed id under each row (`mr-row__id`) but stop naming it in the header. Consider tooltip on the id. | S |
| "Object stable id meaning?" | same as 1g — also the id shown per-row in `ConflictQueue.tsx` (`mr-cf__oid`) and per-card in `TableCard.tsx` (`bw-card__id`) | Add a one-time explanatory affordance (hover title="identifier that follows this object across renames") rather than surfacing the raw phrase | S |
| 1b | "revs" — is `main @ rev 41` functional? What increments it? | `Rail.tsx` `` `${db.trunk} @ rev ${db.trunkRevision}` ``, `Dashboard.tsx` subtitle "at revision {db.trunkRevision}", `data/database.ts` `trunkRevision: 41` (hardcoded fixture), `data/types.ts` | **DECIDED: drop it now.** Remove "@ rev N" from the rail and the dashboard subtitle; show "`main` · last updated `<date>`" instead. A proper **revision-highlighting** feature (a real revision counter / "what changed in `main` at revision N") is filed as **stretch, lowest priority** — see Theme H. | S |
| 1i | MR lifecycle words are weird — want "opened / under review / reviewed / merged" | `web/src/merge-review/format.ts` `STATUS_SEQUENCE` + `STATUS_LABEL` (`received / in-check / cleared / released`), `model.ts` `RevisionStatus` type, `RevisionDial.tsx`, `fromResponse.ts` mapping (`open`/`held`→"in-check", `queued`→"received", `merged`→"released"), API enum `queued/open/held/merged` | **DECIDED: `Queued / Under review / Reviewed / Merged`.** Rename the *view-model* status labels and the `RevisionStatus` union + `STATUS_LABEL` + dial; API enum stays. Remove the "revision status" framing → just "Status". | M |
| 1j | Details pane: "Drawing" row unclear; "Merge" should be "Merging"; no rebase concept | `web/src/merge-review/components/TitleBlock.tsx` rows `["Drawing", …]`, `["Merge", …]`, `["Rebased", …]`, `["Checker", …]` | "Drawing" → **"Table"**; "Merge" → **"Merging"** (`source → target`); "Checker" → **"Review"**; drop or rename the "Rebased" row (see note — rebase *is* a real internal concept per ADR 0004 §5's implicit rebase, but it is not user-facing; relabel to "Auto-adjusted" or remove) | S |
| "Test main ours / theirs is weird" | reviewer's own note: standard VCS vocab, **leave it** | `ComparisonGrid` col heads `On ours` / `On theirs` | **Won't fix** (reviewer's call) | — |
| "Id uuid not null — can be more structured / easier to read" | column spec rendering: `web/src/surfaces/branch/format.ts` `columnSpec()` and `fields.tsx`; DDL in `FabricationOrder.tsx` | Format column specs as aligned columns (name · type · nullability · default) instead of a run-on string; monospace table alignment. Overlaps Theme G. | M |

**Theme A total: ~M+ as one unit.** Deliverable: one ADR ("App vocabulary:
adopt SQL/Git terms, retire the drafting metaphor's invented words") + the edits
+ doc sync (CONTEXT.md, DESIGN.md, decisions.md).

**Visual scope note (per user):** the drafting *visual* language stays — the ADR
changes words only — **except** the spots where this review explicitly flags a
visual change, which ride along in this theme: the "Object · stable id" header +
per-row id treatment (1g), column-spec alignment for "id uuid not null"
(shared with Theme G), and the TitleBlock row relabelling (1j). Everything else
visual (bone ground, hatch, square corners, one shadow, type scale) is untouched.

---

## Theme B — Collapsibility & the shared schema table

Points 5, 6, 7, 8 — all about the schema table behaving inconsistently between
the branch **Schema** view and everywhere that uses `ComparisonGrid`.

**Current state:**
- `ComparisonGrid` (used by merge-review Zone A **and** branch **Divergence**)
  *already* has collapsible groups + optional collapsible sections
  (`web/src/surfaces/kit/ComparisonGrid.tsx`, `Chevron`, `collapsed` set).
- The branch **Schema** view (`SchemaView.tsx` → `TableCard.tsx`) is a *different*
  component tree. Its `.bw-group` blocks (Columns / Indexes / Constraints) and
  the table cards themselves are **not collapsible**.
- No "Collapse all / Expand all" anywhere.

| # | Point | Work | Effort |
|---|---|---|---|
| 5 | Schema table in Branches vs Merge requests should share structure (collapse etc.), differing only in the three-way vs single column | `TableCard`/`SchemaView` do not compose `ComparisonGrid`. Options: (a) make `TableCard` groups collapsible with the same `Chevron`/pattern extracted into a shared `kit/CollapsibleGroup.tsx`; (b) larger — re-express the read-only Schema view as a one-sided `ComparisonGrid`. Recommend (a): the Schema view is *editable* (inline editors per row), which `ComparisonGrid` is not built for. Extract the collapse primitive, not the whole table. | M (a) / L (b) |
| 6 | All table sections collapsible like in Branches [Divergence] | Add collapse state to `.bw-group` in `TableCard.tsx` (Columns / Indexes / Constraints headers become buttons); reuse extracted `CollapsibleGroup` | M |
| 8 | In a branch's Schema, every table collapsible, and every section within it | Add per-card collapse to `TableCard.tsx` (`.bw-card__strip` header toggles body); nest section collapse under it | M |
| 7 | "Collapse all" / "Expand all" buttons | Lift collapse state from local `useState` in `ComparisonGrid` and `TableCard` to the parent surface (or a small context), add a two-button control near the sheet title / zone heading. Applies to: branch Schema (`SchemaView.tsx` header `bw-main__k`), branch Divergence (`Divergence.tsx`), merge-review Zone A (`ComparisonTable.tsx`). Provide a shared `useCollapseGroup` hook so the buttons drive every group. | M |

**Theme B total: ~M–L.** One shared collapse primitive + hook, then wire the
three surfaces. Sequencing: extract primitive → branch Schema (6, 8) → collapse-all
(7) → confirm Divergence/merge-review parity (5).

---

## Theme C — Side-rail navigation clarity (point 9)

`web/src/shell/Rail.tsx`. When a specific branch or MR is open, the rail opens a
sub-list (Schema / Divergence / History for a branch; Review for an MR) but:
- never names *which* branch/MR is open — reads like a sub-nav of the list page;
- **History** is a dead `<span aria-disabled>` with no destination;
- MR sub-item is just "Review" with no id.

| Fix | Detail | Effort |
|---|---|---|
| Show the open entity | Under "Branches", when `branchMatch`, render the branch name as a heading row (or breadcrumb "Branches › `orders-rework`") above Schema/Divergence. Same for MR: "Merge requests › `feature → main`". | S |
| Kill or justify "History" | Per CONTEXT.md there is **no history** in the model. Remove the disabled row entirely (don't ship a permanently-dead nav item). | S |
| Visual nesting cue | Indent + a connector so the sub-items read as "inside this branch", not "more top-level pages". CSS in `shell.css` (`shl-rail__sub`). | S |
| `aria-current` correctness | Sub-links already compute `branchSheet`; keep. | — |

**Theme C total: S.**

---

## Theme D — Merge-request lifecycle & queue semantics

| # | Point | Where | Fix | Effort |
|---|---|---|---|---|
| 10 | Queued MRs can't "Release to Main" (blocked by MR ahead); button label wrong | `web/src/merge-review/components/FabricationOrder.tsx` — `canRelease` is `false` for queued so **no button shows**, and the status line falls through to "Held — N unresolved conflicts" which is wrong for a clean-but-queued MR. `MergeReview.tsx` `canRelease = mergeId && live.status === "in-check" && isMergeable`. `model.ts` `MergeReview` has **no queue position**; `MergeSummary` (`data/merges.ts`) does (`position`). | (1) Thread `queuePosition` / `ahead` into the `MergeReview` view model (`model.ts`, `fromResponse.ts`, fixture). (2) In `FabricationOrder`, when status is queued: replace the release button area with a disabled state "**Queued · position #N** — blocked by N request(s) ahead"; suppress the "Held — conflicts" text. (3) Rename the primary CTA "Release to main" → **"Merge to `main`"** (and "Releasing…" → "Merging…"). Ties into Theme A 1i. | M |
| 12 | Edit a branch after its MR is open → change doesn't appear in the MR | Design tension, not a plain bug. CONTEXT.md: MR **freezes** base/ours/theirs at creation. decisions.md ADR 0004 §5: `ours`/`theirs` are refreshed only **on a merge attempt or on promotion to `open`**. So stale-vs-branch is by design; the "Stale base" status (`data/merges.ts` `status: "stale"`) covers the *target* moving, not *ours*. | **DECIDED: auto-refresh `ours`.** On `GET /merge-requests/:id` (or on MR-screen mount), re-freeze `ours` from the source branch's current head and re-run the three-way. Guard: if resolutions already exist and the refresh would drop them, surface which ones dropped (there is already `droppedResolutions` plumbing in the engine output per decisions.md line 621) rather than silently discarding. Needs: server re-freeze on read + `fromResponse` handling the dropped-resolution notice. | M |
| 1i / RevisionDial | "Revision status" dial + "received/in-check/cleared/released" | `RevisionDial.tsx`, `format.ts`, `model.ts` — see Theme A 1i | (folded into A) | — |

---

## Theme E — App-bar layout (point 11)

`web/src/shell/AppShell.tsx` — the username `.app-bar__user` sits **between** the
theme button group (`.app-bar__theme`) and the Sign-out button, which looks
sandwiched.

Reviewer offered two fixes; recommend a small combination:
- Move `.app-bar__session` (username + Sign out) to be a single trailing cluster,
  with the theme group before it — i.e. reorder so it's `[theme group] [gap]
  [username · Sign out]`. Today the order is already theme → session, so the
  "sandwich" is really *within* the session cluster (name then button). Put the
  username **above** or **before** as a label, or move it into a hover/aria on an
  avatar-less initials chip.
- Simplest: make the username a quiet left-aligned label of the session cluster
  with a divider, not an inline sibling of the button. CSS-only in `shell.css`
  (`.app-bar__session`, `.app-bar__user`).
- Optional (reviewer's option 1): add a sun/contrast icon before the theme group
  so it reads as a labelled control.

**Theme E total: S**, mostly CSS.

---

## Theme F — Missing states / pages / features

| # | Ask | Current state | Work | Effort |
|---|---|---|---|---|
| F1 + F3 | **Close** an MR + a place to see **closed** merge requests | API enum is `queued/open/held/merged` — **no `closed`/`abandoned` state**. `DELETE /merge-requests/:id` (`api/_server/routes/merge-requests.ts:276`) **hard-deletes** and handles queue promotion. `listOpenMergeSummaries` only returns open. Not wired into `web/src/data/source.ts`. | **DECIDED: soft-close** (the current API only supports hard delete, so this needs the schema work). Add `closed` (or `abandoned`) to the `merge_request_status` pgEnum + a drizzle migration; change the `DELETE` handler (or a new `POST /merge-requests/:id/close`) to set `status = closed`, keep the row, still run `promoteNext`. Add `closedAt`. Web: `source.closeMergeRequest(id)`, a guarded "Close request" action on the MR screen + Merges row, and a "Closed" filter/tab on `Merges.tsx` (`listMerges` gains a `state` param). Hard `DELETE` can stay as an admin-only path or be dropped. | M–L |
| F2 | A page for **deleted branches** (stretch) | `deleteBranch` hard-deletes; no tombstone. | Needs a `deleted_at` column or a tombstone table + list. Genuinely stretch. | L |
| F4 | **Read-only DDL / `CREATE TABLE` view** of a table's schema — backend folks prefer it (P1 within stretch). Also user: "if somebody wants to just read the table schema as SQL, keep that" and "where can I view my table" | `emit`/migration rendering exists (`docs/migration-generation.md`, `FabricationOrder` renders DDL). No per-table "show as DDL" on the branch Schema view. | Add a "View as SQL" toggle on each `TableCard` (or a sheet-level toggle) that renders the table's current head as `CREATE TABLE …` using the existing emitter against a single-table slice. High value, moderate effort. | M |
| user: "Where can I view my table" | `/branch/:name` Schema view *is* the table view, but discovery is poor — the user didn't find it. | Partly Theme C (rail names the branch + "Schema"). Also: `/db` dashboard could link "View `main` schema" prominently; branch rows could say "View schema". | S (with C) |

---

## Theme G — Density / "too much to read" / "page looks heavier"

User: "Too much data to read", "Page looks heavier/dense". This is real but must
be handled carefully: per project note, the small mono "plate" type is
**committed density**, not an accident — do **not** fix perceived heaviness by
inflating type sizes to clear a text-size floor.

Levers that reduce load without touching the type scale:
- **Collapsibility (Theme B)** is the primary lever — default more groups
  collapsed, especially unchanged ones. `ComparisonTable` already defaults its
  filter to "conflicts"/"changes only"; extend that instinct to the branch
  Schema view (collapse tables with no `△` marks by default).
- **Column-align the specs** (Theme A "id uuid not null" point) — aligned monospace
  columns read far lighter than run-on strings at the same size.
- **Divergence/Overview**: the `FactList` on `/db` shows six facts; fine. The
  merge-review screen is dense by design (four zones) — leave it, but make sure
  Zone A opens filtered.
- Whitespace/rhythm tuning in `app.css` / `branch.css` (row height, group
  spacing) — cheap, no type change.

**Theme G total: mostly absorbed by B + A.** Budget S for spacing/default-collapse
tuning on top.

---

## Theme H — Revision highlighting (stretch, lowest priority)

Filed out of the 1b decision (drop "@ rev N" now). A real feature: give `main` a
genuine revision counter (incremented on each merge into `main`) and a way to see
**what changed in `main` at revision N** — i.e. per-merge highlighting on the
trunk. This is the only place a "revision" number would be meaningful, and it
needs a `main`-history concept the declarative model deliberately omits today
(CONTEXT.md §Branching model). **Stretch, scheduled last** — do not build the
counter just to keep a label.

---

## Decisions — RESOLVED

- **1b** — drop "@ rev N" now, show `main` last-updated date. Revision highlighting → Theme H, stretch, last. ✅
- **1i** — `Queued / Under review / Reviewed / Merged`. ✅
- **F1/F3** — **soft-close**; requires adding a `closed` enum value + migration (current API only hard-deletes). ✅
- **D-12** — **auto-refresh `ours`** on MR read; surface dropped resolutions rather than discard silently. ✅
- **A scope** — visual drafting language stays; ADR changes words only, **except** the visual tweaks already flagged in overlapping items (1g header + row-id, column-spec alignment, TitleBlock rows). ✅

---

## Proposed sequence

1. **Theme C** (rail clarity) — ✅ done on `feat/usability-review-batch-1`.
2. **Theme E** (app-bar) — ✅ done.
3. **Theme A** (vocabulary) — ✅ done; ADR 0011 + `decisions.md` synced. The
   full column-spec *alignment* refactor was scoped down to keyword casing
   (`uuid · NOT NULL · DEFAULT`); grid-aligned sub-columns remain a follow-up.
4. **Theme B** (collapse primitive + collapse-all + branch Schema parity) —
   ✅ done; `web/src/surfaces/kit/collapse.tsx`. Theme G rode along
   (unchanged tables start folded).
5. **Theme D-10** (queue messaging on the MR screen) — ✅ done; `queue` added
   to the merge-review view model, Zone D shows a Queued branch.
6. **Theme F4** (read-only `CREATE TABLE` view per table) — ✅ done;
   `TableDdl.tsx`, "view SQL" toggle on every table card.
7. **Theme D-12** (auto-refresh `ours` when the branch moves) — ✅ done; `ours`
   re-freezes on every read for non-terminal requests, dropped resolutions
   surface as a non-blocking note. ADR 0012.
8. **Theme F1+F3** (soft-close MR) — ✅ done; `closed` status + `closed_at`,
   `POST …/close`, Open/Closed tabs on `/merges`, "Close request" in Zone D.
   ADR 0012.
9. **Theme F2** (deleted-branches) — ✅ done; archive-then-delete into
   `deleted_branches` (needed because `branches.name` is the PK),
   `GET /branches/deleted`, collapsed "Deleted branches" zone on `/branches`.
   ADR 0013. No restore endpoint (freed name may be re-taken) — follow-up.
10. **Theme H** (revision counter + highlighting) — ✅ done; `trunkRevision`
   derived from `main`'s merge-marker count (no schema change), a `revisions`
   list on `/overview`, a "Revisions" zone on `/db`, `· rev N` back on the rail.
   ADR 0014. Per-merge object-level highlighting not possible — the merge
   marker is thin; noted as a gap.

### Follow-ups surfaced during the build

- **A `closed` / `merged` merge request should not hold its source branch.**
  Intended behaviour: once no *active* (queued / open / held) MR references a
  branch, it is deletable. Today the `merge_requests.source_branch` FK from any
  surviving MR row (terminal ones included) blocks the archive-then-delete.
  Fix is a schema/route change — repoint or null those rows on archive, or make
  the FK `ON DELETE SET NULL`. **Low priority, stretch.** (ADR 0012 / 0013.)
- **No branch-restore from the archive** — confirmed out of scope. The freed
  name may already be re-taken, so restore is a create-or-conflict flow with
  its own UI. Not planned. (ADR 0013.)
- **Per-merge schema delta** for the Revisions list — not built. A revision
  entry shows *that* a merge landed and from where, not *what it changed*,
  because the only record of a past merge is the thin merge-marker row (MR id,
  source branch, author, timestamp). Showing the object-level diff for
  revision N would need `main`'s schema document snapshotted at each revision so
  `diffSnapshots(revN-1, revN)` could be rendered — i.e. reintroducing the
  per-revision history the declarative model deliberately omits. Bigger design
  change; noted as a gap. (ADR 0014.)
- The parallel subagents branched from `main`, not this branch, and git's
  shared stash stack across worktrees caused one cross-contamination incident
  (recovered). Consolidated here by cherry-pick with conflict resolution.
