# ADR 0009 — DDL verification harness

Status: accepted (design lock). **Stretch band — not expected to ship in V0/V1.** No code
ships here. This records the design so the harness can be built if budget allows (ticket 0007
makes the call); until then, the correctness of `emit`'s output is covered by tests.

Builds on ADR 0003 (`emitMigration`, the `DdlStatement` IR, `serialize`), ADR 0004 (the merge
request lifecycle; the `GET` response's `migration` field) and ADR 0008 (`validateDocument`).

## Context

The generated DDL is a *rendering* of what a merge does, shown on the merge-review screen —
nothing executes it, and `main`'s schema document is the schema of record (`decisions.md` §
"The generated DDL is a rendering of the merge, not a deliverable"). So this harness is not
"dry-run the migration you will deploy"; it is a **correctness check on `emit`** — does a real
Postgres accept what `emit` produced. That is a real question because `emit` is the
second-most-complex piece in the engine and the pure in-memory replay only proves `emit`
agrees with *ryft's* model of Postgres, not with Postgres.

## 1. Apply-only: run the DDL, report whether Postgres accepts it

The harness, given a merge request:

1. Render `theirs` as `CREATE` DDL — `emitMigration({ database, tables: [] }, theirs).sql`
   (a diff from the empty document is all creates). No new rendering code.
2. Render the migration — `emitMigration(theirs, merged).sql`.
3. In one transaction on the shadow branch (§4): apply (1), then apply (2).
4. **Pass** iff every statement applied with no error. **Fail** → the failing statement text
   and Postgres's error message. `ROLLBACK` either way.

There is **no introspection** and **no compare-to-`merged`**. The harness answers "is this
DDL something a real Postgres runs", not "does running it produce exactly `merged`".

**Why not introspect and compare.** The wrong-schema bug class — `emit` produces DDL that
runs but yields a different schema than `merged` — is already covered: `replay.ts`'s
intermediate-state check, and ticket 0006's pure `applyDelta(theirs, delta) === merged`
table-tests. Adding "a real Postgres confirms the in-memory apply" is belt-and-suspenders,
and it costs the entire `information_schema` / `pg_catalog` → `SchemaDocument` mapping plus a
normalization ruleset (id-stripping, default canonicalization, member-order handling). Not
worth it for a stretch-band check. If it is ever wanted, it is a stretch extension of this
harness, not the baseline.

**Considered and rejected.** The ticket's original "seed `theirs`, apply, introspect back,
compare structurally to `merged`". Rejected per above — the comparison's value is already
delivered by pure tests, and the introspection round-trip it requires is a large build.

**Consequences.** No introspection round-trip exists, so the raw-SQL import path (stretch)
does not get "a free SQL importer" out of this harness — it would need its own
Postgres→document introspection (`decisions.md` § "Deliberately cut" — the SQL console; map § Not yet specified).

## 2. Triggered by a manual "Validate" button, never automatically

A `POST /merge-requests/:id/verify` endpoint, available only when the merge request is clean
(no open conflicts — a migration exists only for a clean merge, ADR 0002). The merge-review
screen shows a **Validate** button; pressing it calls the endpoint synchronously and the
button shows a spinner until the verdict returns.

The dry run is **not a merge gate**. A merge request can be merged with no verification run,
or with a stale or failed one — the check is advisory evidence (`decisions.log.md` § "Merge
requests are dry-run against a real Postgres before you merge"), and it is stretch.

**Why manual and synchronous.** With the shadow branch already warm (§4) the whole run is
sub-second, so an explicit button with a spinner is the honest, simplest model. It removes
the automatic-on-creation latency, the `verifying…` state, background jobs, and `GET`-time
triggering — none of which a stretch, advisory check justifies.

**Considered and rejected.** Automatic on merge-request creation (latency on the request
path, and the migration is recomputed every read anyway so a creation-time result goes
stale); lazy on first `GET` with client polling (machinery a stretch check does not earn).

## 3. The result is a persistent property of the merge request

`merge_requests` carries a nullable `verification` blob:
`{ status: "verified" | "failed" | "unverifiable", detail: string | null, checkedAt: string }`.
`POST .../verify` writes it. `GET /merge-requests/:id` returns it as-is.

It is **not a cache** — there is no TTL and no re-run on read. It is set once by an explicit
action and stays until the thing it describes changes. It is **cleared to `null`** exactly
when the migration it verified would change: whenever the merge request's frozen triple is
refreshed (ADR 0004 §5 — a merge attempt, or promotion to `open`) or any resolution is saved
or deleted. Those are already the events that disturb the merge request.

**Why no migration hash.** The blob's presence is itself the "valid for the current state"
signal, because every event that would change the generated migration also clears the blob.
A stored hash would be redundant bookkeeping.

**Consequences.** This is an addition to ADR 0004's `merge_requests` table (it had no
verification field). It is nullable and stretch, so it is a no-op until the harness is built.

## 4. One shared shadow branch, per-run schema

- **One** Neon "shadow" branch for the whole instance, created lazily — the first `verify`
  call that finds no live shadow branch creates one, with a **24-hour `expires_at`** so Neon
  reclaims it with nothing to schedule or clean up. The next day's first `verify` finds it
  gone and makes a fresh one.
- **Each run works in its own throwaway schema**: `CREATE SCHEMA verify_<runId>`,
  `SET search_path TO verify_<runId>`, apply the DDL (which is written unqualified, so it
  lands there), then `DROP SCHEMA verify_<runId> CASCADE` in a `finally`. Concurrent runs
  cannot collide, and there is no per-run branch provisioning.
- The **test suite** uses the same pattern — one shared branch for the run, one schema per
  scenario.

**Why.** Neon caps branch count and each branch takes seconds to provision. A branch per run
(or per test) blows the quota and the time budget; a long-lived branch with per-run schemas
gives isolation at `CREATE SCHEMA` speed.

**Considered and rejected.** A fresh branch per verification with a `finally` delete —
simplest isolation, but the provisioning cost and quota pressure are real, and the per-run
schema gives the same isolation for far less.

## 5. Opportunistic: degrades, never blocks

- **Tests** `skip` (not fail) when `NEON_API_KEY` is absent, so `npm test` runs offline. In
  CI they run and must pass *if* the key is configured; otherwise skipped, build still green.
  The pure engine table-tests (ticket 0006) are the real correctness gate.
- **Product**: with no key, or Neon unreachable, or a timeout, `POST .../verify` returns
  `status: "unverifiable"` with a reason; the merge-review screen says validation is
  unavailable; the merge is unaffected.

## 6. V0/V1 correctness of `emit` is a pure test

Because the harness is stretch, the V0/V1 guarantee that `emit` is correct does not depend on
Neon. It is a pure, in-memory test owned by ticket 0006: apply the emitted change to `theirs`
via `applyDelta` / `replay` and assert the result equals `merged`, across the scenario
catalogue. The Neon-backed version of that same assertion is this harness, run
opportunistically (§5) — a stronger check when it is available, never a required one.
