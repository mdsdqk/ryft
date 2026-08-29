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

Put the database schema itself under version control — branch it, evolve it independently
(add, drop, rename, retype columns; change constraints and indexes; create and drop
tables), see exactly what diverged against the common ancestor, and merge it back with a
typed conflict report and ordered, runnable Postgres DDL out the other side. Success is a
merge that a text-level tool gets wrong — unrelated columns added to the same table, or a
column dropped on one branch and indexed on another — resolved correctly, and the
rename-rebase case handled without a conflict or a silent drop.

## Positioning

Object identity is a stable synthetic id carried by every table, column, constraint, and
index, assigned at creation and preserved across rename and across merge. The three-way
merge matches objects by id, not by name, so it follows a column across a rename. This is
what lets **rename-rebase** work: one branch renames `email` to `email_address`, another
adds a unique index on `email`, and the merge produces an index on `email_address` — not a
conflict, not an error, not a dropped column. PlanetScale's `schemadiff` is the only real
prior art for semantic three-way schema merge, and it matches by name, so it cannot do
this. Every non-interactive state-based tool (Atlas, Skeema, Prisma, Alembic) renders a
rename as drop-and-add. Every migration-file tool that advertises "merge" (Django,
Alembic) is reconciling the migration DAG, a different problem wearing the same word.

## Operating Context

- The schema under control is one Postgres namespace: tables, columns, primary keys,
  foreign keys, unique constraints, and indexes. Row and table *data* is out of scope.
- `main` is the trunk and the single shared ancestor. Every branch is cut from `main` and
  merges back into `main`; branching from a non-`main` branch is unsupported in V0/V1.
- The model is declarative / state-based, following PlanetScale: no commit graph, no
  history. A branch is its current schema document plus a base snapshot of its parent
  taken when the branch was cut. An operation log exists for undo and audit only and is
  never read by the merge.
- Schema evolution happens through a structured editor that records each edit — including
  renames — as an operation. A per-branch SQL console and raw-SQL import are the stretch
  ingestion path; on imported (id-less) schemas the model degrades to name matching like
  every other tool, and showing that degradation honestly is part of the argument.
- Merging is serialized through a merge queue: an MR is re-validated against `main`'s head
  when it reaches the front, so the stale-base case and the concurrent-merge race become
  one code path. For V0/V1 this is a serialized transaction with an optimistic version
  check, not a job runner.
- A pre-merge dry run (PlanetScale's shadow branch) applies the generated migration to an
  ephemeral Neon branch seeded with `theirs` and introspects the result back — stretch.

## Capabilities and Constraints

- **Conflict vocabulary** follows PlanetScale's *clear / subtle / overlap* severity
  terms. Six recognised classes: divergent retype, add-vs-add, rename-vs-rename, divergent
  index definition, drop-vs-modify (all *clear*), and dependency conflict (*subtle*). An
  *overlap* — both sides making the identical change — is applied once and is not a
  conflict.
- **Commutativity post-condition**: before declaring a clean merge, the engine verifies
  that applying each side's delta to `base` in either order yields the same document and
  that it equals the merged document. A failure is reported as an unclassified divergence
  and blocks the merge — the completeness check on the six enumerated classes.
- **Type equivalence** is exact-match including parameters: `varchar(255)` ≠
  `varchar(256)`, `numeric(10,2)` ≠ `numeric(10,3)`. There is no widening/safety lattice;
  the engine does not know `int` → `bigint` is safer than `int` → `text`. Ranking retypes
  by safety is a stretch item.
- **Migrations** are forward-only, dependency-ordered, wrapped in a single transaction
  (Postgres has transactional DDL). Renames render as `ALTER … RENAME`, never
  drop-and-add. Every prefix of a migration must leave the schema structurally sound,
  verified by step-by-step in-memory replay.
- **Drops are blocked on dependents, not cascaded**: the user removes an index, unique,
  primary key, or foreign key before dropping the column or table it depends on, as
  explicit operations.
- **Identity is a username with no authentication**. A landing screen takes a username;
  unknown creates a user in the single seeded organisation, known resumes as that user. No
  password, no session, no permission check; the current user id is held client-side and
  trusted by the server. Impersonation is a documented non-goal. `User` and `Organization`
  are modelled now because the target customer is a team and retrofitting an author column
  later is a migration; `engine/` never imports them.
- **Explicitly out of scope**: row/table data versioning, multiple namespaces, check
  constraints, enums and custom types, triggers, views, functions, partitions, row-level
  security, branch-of-branch merges, down-migrations, live database introspection, and
  executing generated migrations against a real database.
- **Delivery bands**: V0 is the walking skeleton (seed, branch, edit, open MR, semantic
  three-way diff, no-conflict merge, deployed). V1 adds conflict detection and
  classification for all classes plus a resolution UI for divergent retype and
  rename-rebase. Stretch: raw-SQL import with heuristic rename detection, drop-vs-modify
  resolution UI, migration dry-run.

## Brand Commitments

- The product name is **ryft** (lowercase).
- The voice of `decisions.md` — plain, precise, concrete, no marketing register, explains
  the "why", leaves reversals visible — is a **directional reference** for UI copy (labels,
  empty states, conflict explanations, errors), not a hard constraint. Surface work may
  deviate where a surface genuinely calls for it.

## Evidence on Hand

- **Seed schema plus worked branch examples** under `examples/` (`seed.schema.ts`,
  `branched.schema.ts`, `branched.log.ts`) — a small realistic schema and a
  `contact-fields` branch exercising rename + dependent index, feeding the engine tests.
- **Core engine types** in `engine/schema.ts` (schema document) and
  `src/domain/operations.ts` (operation log); user/org types in `src/domain/users.ts`.
- **Prior-art research** against ten schema tools, recorded in
  `.scratch/schema-vcs/tickets/0000-prior-art-renames-and-merge.md` and its findings file,
  and the PlanetScale Vitess branching architecture reference under `docs/.local/`.
- **Decision record**: `decisions.md` (running log with the required brief at the top),
  `CONTEXT.md` (glossary), `docs/adr/0001-core-representation.md`, and the wayfinding map
  and ticket tree under `.scratch/schema-vcs/`.
- No real customers, testimonials, usage metrics, press, or benchmark data exist; future
  work must not fabricate any. The deployed instance is a demo seeded with one
  organisation and three users.

## Product Principles

- **Reconcile the schema, not the files that describe it.** The artifact under version
  control is the schema state; migration files are output, not input.
- **Identity lives in a stable id, never in a name.** Every correctness property that
  matters — following an object across a rename, rename-rebase, the shrinking of the
  non-commutative surface — falls out of this one choice.
- **Never claim a clean merge the engine cannot prove.** The six conflict classes are only
  as complete as their enumeration; the commutativity post-condition is the oracle that
  catches what the enumeration missed.
- **One operation, one intent.** Drops block on dependents rather than cascading, so every
  recorded edit is independently meaningful and undo is unambiguous.
- **Model the team even in the single-user slice.** Branches and merge requests are
  authored by named people; the three-way merge story is only legible with a person on
  each side.
- **Ship V0 before V1.** A functional product missing conflict resolution beats a
  non-functional complete one.
- **Degrade honestly.** On id-less imported input the model falls back to name matching
  like every other tool, and the product says so rather than implying parity.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. The diff and merge surfaces must be fully keyboard-operable with
visible focus, meet AA contrast, and expose conflict controls (take ours / take theirs /
choose target type) with screen-reader-accessible names and state.
