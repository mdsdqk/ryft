# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React SPA + Hono API, both deployed on Vercel, with Neon Postgres and Drizzle for
persistence. React was chosen for reviewer familiarity rather than fluency; a swap to
Angular is permitted at a post-V0 velocity checkpoint. The diff/merge engine under
`engine/` is framework-agnostic TypeScript with zero framework imports and zero runtime
dependencies — it is the artifact meant to carry the submission and is exhaustively
table-tested.

## Users

The primary user is a team of engineers sharing a single Postgres database, where more
than one person changes the schema in the same period. The team already runs version
control for its application code. For the schema it has migration files — a change log
rather than a schema — and reconciliation happens either as a Git text conflict on a file
nobody wants to hand-edit, or in one person's head. Named people sit on each side of a
merge: one engineer renames a column, another adds an index against it.

This is a five-day engineering take-home, so a second audience is the reviewer setting the
project up from a cold clone and evaluating problem framing, product thinking, UX,
code quality, tests, documentation, and setup experience.

## Product Purpose

ryft puts a Postgres schema under version control. A user signs in, lands in the database,
and works with its schema the way they work with code: branch it, change the branch through
a structured editor, see exactly how the branch has diverged from the trunk, open a merge
request, resolve whatever conflicts the two sides created, and get ordered, runnable
Postgres DDL for the merge.

The object under version control is the schema — tables, columns, primary keys, foreign
keys, unique constraints, indexes — not the migration files that describe it and not the
row data inside it. Success is a merge that a text diff over a schema dump gets wrong: two
people adding unrelated columns to the same table, one dropping a column the other indexed,
or one renaming a column the other built on — each resolved correctly, the rename followed
across the branch instead of read as a drop and an add.

## Positioning

Every table, column, constraint, and index carries a stable synthetic id, assigned at
creation and preserved across rename and across merge. The three-way merge matches objects
by that id, not by name, so it follows a column across a rename. That is what makes
**rename-rebase** work: one branch renames `email` to `email_address`, another adds a
unique index on `email`, and the merge produces an index on `email_address` — not a
conflict, not a dropped column.

No other state-based schema tool does this. Atlas, Skeema, Prisma, and Alembic all read a
rename as drop-and-add, which destroys the column. The migration-file tools that advertise
"merge" (Django, Alembic) reconcile a DAG of migration files, not schemas. PlanetScale's
`schemadiff` does semantic three-way schema diffing but matches objects by name, so it too
cannot follow a rename. ryft's identity-by-id model is what makes a real three-way schema
merge — and rename-rebase specifically — tractable.

The conflict report is a typed data structure, not an interactive prompt, so the merge is
usable from an API, an agent, or CI, not only from the UI.

## Operating Context

- **One database.** A ryft instance manages a single Postgres namespace. There is no
  database selector — signing in lands the user directly in it. The schema under control is
  that namespace's tables, columns, primary keys, foreign keys, unique constraints, and
  indexes; row and table data is out of scope.
- **`main` is the trunk.** Every branch is cut from `main` and merges back into `main`;
  branching from a non-`main` branch is unsupported in V0/V1. The model is state-based:
  no commit graph and no history. A branch is its current schema document plus a base
  snapshot of `main` taken when the branch was cut. An operation log is kept for undo and
  audit only and is never read by the merge.
- **Identity is a username, no authentication.** The sign-in screen takes a username and
  takes it as truth: a known username resumes that user, an unknown one creates a new user
  and proceeds. No password, no session, no permission check. Impersonation is a documented
  non-goal. `User` and `Organization` are modelled from the start because the customer is a
  team; `engine/` never imports them.
- **Schema editing is UI-only.** Evolution happens in a structured editor, not a SQL
  console — each table is shown as an editable card, and rename / drop / add / retype /
  constraint / index changes are made in place through form controls on the card. Every
  edit is recorded as an operation. A per-branch SQL console and raw-SQL import are stretch
  scope and are not expected to ship in V0/V1.
- **The merge is serialized and re-validated.** An open merge request is checked against
  `main`'s current head at merge time, so a stale base and a concurrent-merge race are the
  same case. A pre-merge dry run against an ephemeral database is stretch.

## Surfaces

The product is this set of pages. The merge-review surface is built; the rest are planned
and inherit its visual world (`DESIGN.md`).

1. **Sign in** — a single field, a username; no password.
2. **The dashboard/database** — the database's overview / dashboard, and the landing surface after
   sign-in since there is no database to choose.
3. **Branches** — every branch on the database; create a new branch from `main`; delete a
   branch.
4. **Merge requests** — every open merge request on the database.
5. **Branch schema** — one branch's current schema, shown as editable table cards.
6. **Divergence** — how a branch has grown or diverged from `main`.
7. **Structured editor** — in-card form controls to rename / drop / add / retype a column,
   change constraints and indexes, and create / drop tables. No SQL editor.
8. **Merge review** *(built)* — the three-way comparison, conflict queue, operation log,
   and generated DDL. See `DESIGN.md` and `docs/design/shape-brief-v0-v1-flow.md`.
9. **Empty states** — first-class for every list and page: no branches yet, no open merge
   requests, an unchanged branch, a freshly seeded database.

## Capabilities and Constraints

- **Branches**: create from `main`, view schema, edit schema, delete. No branch rename in
  V0/V1; no branch-of-branch.
- **Schema operations**, all through the editor UI: add / drop / rename / retype a column;
  add / drop / change a primary key, unique constraint, index, or foreign key; create /
  drop a table. Drops are blocked on dependents rather than cascaded — the user removes the
  dependent objects first, as their own operations.
- **Type equivalence is exact-match**, parameters included (`varchar(255)` ≠
  `varchar(256)`). There is no widening/safety lattice; ranking retypes by safety is
  stretch.
- **Merge output** is forward-only Postgres DDL, dependency-ordered, in a single
  transaction; renames render as `ALTER … RENAME`, never drop-and-add. The engine will not
  return a merged schema it cannot prove clean.
- **Conflict handling**: divergent changes are sorted into named classes, each with a
  severity — *clear*, *subtle*, or *overlap*, a vocabulary adopted from PlanetScale's
  `schemadiff`. An identical change made on both sides is an *overlap*: applied once, not a
  conflict. The resolution UI covers taking one side or specifying a target type or name.
  The full class enumeration, the commutativity check, and the merge algorithm are
  design-exploration detail in `docs/adr/0002-semantic-merge-engine.md` and
  `docs/merge-engine.md`, not product scope here.
- **Explicitly out of scope**: row/table data, multiple databases or namespaces, check
  constraints, enums and custom types, triggers, views, functions, partitions, row-level
  security, branch-of-branch merges, down-migrations, connecting to a real database, and
  running the generated DDL anywhere.
- **Delivery bands**: V0 is the walking skeleton (seed, branch, edit, open MR, three-way
  diff, no-conflict merge, deployed). V1 adds conflict detection, classification, and the
  resolution UI. Stretch, not expected to land: SQL console, raw-SQL import with heuristic
  rename detection, migration dry-run.

## Brand Commitments

- The product name is **ryft** (lowercase).
- The voice of `decisions.md` — plain, precise, concrete, no marketing register, explains
  the "why", leaves reversals visible — is a **directional reference** for UI copy (labels,
  empty states, conflict explanations, errors), not a hard constraint. Surface work may
  deviate where a surface genuinely calls for it.
- The built merge-review surface's visual world ("The Revised Drawing" — a drafting-room
  revision sheet; Diazo light / Cyanotype dark palettes) is recorded in `DESIGN.md` and
  inherited by every later surface.

## Evidence on Hand

- **First surface, built**: the merge-review screen under `web/` (React SPA), with
  `DESIGN.md` and `.impeccable/design.json` recording its visual world, and reference
  mockups under `docs/design/mockups/`.
- **Engine**: `engine/schema.ts` + `engine/operations.ts` (types), `engine/diff.ts`
  (`diffSnapshots`) and `engine/apply.ts` (`applyDelta`) implemented; `classify` and
  `threeWayMerge` specified in `docs/adr/0002-semantic-merge-engine.md` and
  `docs/merge-engine.md` but not yet written.
- **Seed schema plus worked branch examples** under `examples/`; user/org domain types in
  `src/domain/`.
- **Prior-art research** against ten schema tools in
  `.scratch/schema-vcs/tickets/0000-prior-art-renames-and-merge.md` and its findings file.
- **Decision record**: `decisions.md` (running log with the required brief at the top),
  `CONTEXT.md` (glossary), `docs/adr/0001-core-representation.md` and
  `docs/adr/0002-semantic-merge-engine.md`, and the wayfinding map and ticket tree under
  `.scratch/schema-vcs/`.
- No real customers, testimonials, usage metrics, press, or benchmark data exist; future
  work must not fabricate any. The deployed instance is a demo seeded with one organisation
  and a few users.

## Product Principles

- **Reconcile the schema, not the files that describe it.** The artifact under version
  control is the schema state; migration files are output, not input.
- **Build the whole spine, narrow.** Branch, edit, diverge, merge, DDL — end to end — and
  leave everything outside that path out rather than half-building it.
- **Identity lives in a stable id, never a name.** Following an object across a rename,
  rename-rebase, and a smaller conflict surface all fall out of this one choice.
- **Never claim a clean merge the tool cannot prove.**
- **One operation, one intent.** Drops block on dependents rather than cascading, so every
  recorded edit is independently meaningful and undo is unambiguous.
- **Model the team even in the single-user slice.** Branches and merge requests are
  authored by named people; the three-way merge story is only legible with a person on each
  side.
- **Empty states are part of the product**, not an afterthought — every list and page
  ships its zero state.
- **Ship V0 before V1.** A functional product missing conflict resolution beats a
  non-functional complete one.
- **Degrade honestly.** On id-less imported input (stretch) the model falls back to name
  matching like every other tool, and the product says so rather than implying parity.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Every surface must be fully keyboard-operable with visible focus
and meet AA contrast; the diff, editor, and merge surfaces must expose their controls
(edit a column, take ours / take theirs / choose a target type) with screen-reader-
accessible names and state, and never convey status by colour alone.
