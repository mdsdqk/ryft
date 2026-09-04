# Scope — bands, budget, risks

Ticket 0007. The delivery bands weighted against the ~20-hour budget, the budget
reconciliation call, and the risk register. It does **not** restate what other docs own:

- **Product truth** — `PRODUCT.md` (users, purpose, capabilities, constraints).
- **Demo script** — `docs/first-run.md` §4–5 (golden path + full-coverage appendix).
- **The decisions and their reasoning** — `decisions.md` (the curated record; the brief at its
  top answers the problem statement's four questions) and `decisions.log.md` (the full running
  log).
- **The engine, persistence, robustness, verification designs** — ADRs 0001–0009.

## Where the budget went

~20 hours (5 days × 4h). Most of it is already spent, and on the right things:

| Block | State |
|---|---|
| Prior-art research (10 tools) + scope/slice charting | done — `decisions.md` brief, `.scratch/schema-vcs/` |
| The engine — `diff` → `classify` → `threeWayMerge` → `emit` → `replay`, framework-free, zero runtime deps | done — implemented + **223 tests** (`docs/engine-test-catalog.md`) |
| Persistence + API contract, first-run, robustness, DDL-verification — **design locks** | done — ADRs 0004, 0005, 0008, 0009 |
| Frontend — app shell, router, rail, merge-review screen, `/branches`, `/merges`, surface kit, data seam | done — fixture-bound |
| The engine's server surface — `validateOperation`, `applyOperation` | done — ticket 0010 checkpoint A, +32 tests |
| The V0 backend — Hono API on Neon/Drizzle for the golden path, deploy config | done — ticket 0010 (ADR 0010); `api/` package, +15 in-process tests |
| **Remaining** — wire `web/src/data/` to the API; build the structured editor (WU-E) | the frontend iteration (ADR 0010 §7) |

The depth play — the "above and beyond" — is the **engine**: the rename-rebase edge case
solved by stable-id identity, a typed conflict report usable from CI or an agent, and an
exhaustive table-test catalogue. That is finished. The build is the boring, necessary
remainder.

## The bands

### V0 — the thin real slice *(the deployed submission)*

The golden path (`docs/first-run.md` §4), wired against a **minimal** Hono API — real
persistence for exactly the demo, nothing more:

- seed `main` (deploy-time or `POST /workspace/reset`); username sign-in
- dashboard / branches list / merges list on real data
- create a branch from `main`
- structured editor → apply operations to a branch, persisted, with the drop-with-dependents
  block (`applyOperation` + `validateOperation`, ADR 0008 §1–§2)
- open a merge request — freeze `base` / `ours` / `theirs`
- three-way diff + classified conflicts + generated DDL rendering (engine, done)
- a clean merge writes `main.head` and appends the op-log marker

**Deliberately not in V0** — deferred to V1, and V0 assumes one merge request at a time:
the merge queue (stored `status`, `SELECT … FOR UPDATE`, FIFO promotion,
`previewed_main_version`, the kick-back body — ADR 0004 §3–§4); resolution *persistence* and
re-validation (`merge_request_resolutions`, ADR 0004 §6); `validateDocument` on the merged
candidate (ADR 0008 §5); the `POST .../verify` endpoint and `verification` blob (ADR 0009).

### V1 — full wire-up *(the natural next increment; does not fit the 20h)*

Everything ADR 0004 specifies: the merge queue and its transaction, the conflict-resolution
UI (divergent-retype picker + the rest) with `merge_request_resolutions` persistence and
fingerprint re-validation, `validateDocument` API-side, the full route surface.

### Stretch — not expected to land

DDL verification against an ephemeral Neon branch (ADR 0009 — manual "Validate" button); a
SQL console per branch; raw-SQL import with heuristic rename detection; a widening/safety
lattice for retypes; the branch History sub-sheet and undo.

### Cut — out of scope entirely

Row/table data versioning; multiple schemas or namespaces; views, enums, check constraints,
triggers, functions, partitions, row-level security; branch-of-branch merges; down-migrations
and rollback; connecting to or executing against a user's real database (ryft's schema
document *is* the schema of record — there is no downstream); authentication and permissions
(username-only, impersonation a documented non-goal); more than one target branch per merge
request.

## The budget reconciliation call

The ticket framed this as: robustness (~2–3h) and the DDL verification harness (~3h), both
added during review, compete with a second conflict-resolution UI. It resolved differently
than framed, because the ground shifted:

- **The DDL harness is stretch** (settled in ADR 0009). It is not competing for V0/V1 time —
  its only V0/V1 cost is the pure `emit` correctness test, which shipped in ticket 0006.
- **Robustness is not a competing feature** — `validateOperation` / `validateDocument` are
  foundational (the API's `applyOperation` is built on them), so `validateOperation` and the
  drop-block are **in V0**; `validateDocument` on the merge path moves to **V1** with the
  rest of the merge-request machinery.
- **The real competition is inside the build**: the entire API is unbuilt. So V0 is scoped
  down to the thin slice above (persist the golden path, skip the queue and resolution
  persistence), and the full ADR 0004 surface is V1.

Net: nothing was cut that was not already heading for stretch; V0 got narrower on the
persistence surface, not on the engine.

## Risk register

| Risk | Mitigation |
|---|---|
| **V0 API wiring overruns** | Fallback: deploy fixture-bound (engine + frontend, no persistence) rather than ship a half-wired backend. The engine, the 223 tests, and `decisions.md` carry the depth and framing criteria regardless of persistence. |
| **React ramp** (chosen for reviewer familiarity, not fluency) | The Angular-swap option is now closed — the shell, `/branches`, `/merges`, and merge-review are already built in React; the swap costs more than it saves. |
| **V1 does not happen → no resolution UI** | Divergent retype degrades to *detected and classified*, resolved by hand (edit the branch, re-open the MR). Rename-rebase still resolves automatically — it is engine behaviour, no UI. |
| **`emit` primary-key-id-swap gap** (ticket 0006 finding) | Low impact — the editor emits `changePrimaryKey` (same id), so the gap needs an unusual input path. Pinned with an `it.fails` test; the fix is a small `diffSnapshots` change (ADR 0003). |
| **Neon latency / availability** | Moot for V0 (no Neon on any path). For stretch DDL verification, the check is advisory and degrades to "unverifiable" (ADR 0009 §5). |
