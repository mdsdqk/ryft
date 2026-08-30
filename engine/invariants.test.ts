/**
 * Merge / migration invariants — `docs/engine-test-catalog.md` §3.
 *
 * These are swept over the §1 and §2 fixtures. Where a scenario table pins one
 * concrete result, an invariant pins a law that must hold for *every* row.
 *
 * `canon` normalises the two structurally-insignificant orderings before an
 * equality check: the order of `tables` in a document, and the order of
 * `columns` / `foreignKeys` / `uniques` / `indexes` within a table
 * (`engine/schema.ts` — Postgres appends, there is no reorder). It deliberately
 * leaves `primaryKey.columnIds` and `index.columnIds` alone: those *are*
 * significant.
 */

import { describe, expect, test } from "vitest";
import { threeWayMerge } from "./merge.js";
import { diffSnapshots } from "./diff.js";
import { applyDelta } from "./apply.js";
import { emitMigration } from "./emit.js";
import { verifyPrefixes } from "./replay.js";
import type { Delta } from "./operations.js";
import type { SchemaDocument } from "./schema.js";
import { scenarios } from "./__fixtures__/scenarios.js";
import { migrationScenarios } from "./__fixtures__/migration-scenarios.js";

const clone = <T>(v: T): T => structuredClone(v);
const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

function canon(doc: SchemaDocument | null): unknown {
  if (!doc) return null;
  return {
    ...doc,
    tables: byId(doc.tables).map((t) => ({
      ...t,
      columns: byId(t.columns),
      foreignKeys: byId(t.foreignKeys),
      uniques: byId(t.uniques),
      indexes: byId(t.indexes),
    })),
  };
}

const rows = <T extends { name: string }>(list: T[]) => list.map((s) => [s.name, s] as const);
const clean = scenarios.filter((s) => s.expect.verdict === "clean");
const conflicting = scenarios.filter((s) => s.expect.verdict === "conflicts");

/**
 * Excluded from the "emit(theirs → merged) is prefix-valid" sweep — see the
 * FINDING test below. `diffSnapshots` on a primary key whose *id* changed (a
 * wholesale object swap, not a `changePrimaryKey`) emits `addPrimaryKey` without
 * the matching `dropPrimaryKey`, so the migration fails its own prefix check.
 */
const EMIT_SWEEP_SKIP = new Set(["primary-key replacement (one side)"]);

// ── I1 ────────────────────────────────────────────────────────────────────
describe("I1 — identity: a branch with no changes merges to the other side untouched", () => {
  test.each(rows(clean))("%s", (_n, s) => {
    const a = threeWayMerge(s.base, s.ours, s.base);
    expect(a.report.verdict).toBe("clean");
    expect(canon(a.merged)).toEqual(canon(s.ours));

    const b = threeWayMerge(s.base, s.base, s.theirs);
    expect(b.report.verdict).toBe("clean");
    expect(canon(b.merged)).toEqual(canon(s.theirs));
  });
});

// ── I2 ────────────────────────────────────────────────────────────────────
describe("I2 — applying the derived delta to `theirs` reproduces `merged`", () => {
  test.each(rows(clean))("%s", (_n, s) => {
    const { merged } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
    const delta: Delta = diffSnapshots(s.theirs, merged!);
    const applied = applyDelta(clone(delta), clone(s.theirs));
    expect(canon(applied)).toEqual(canon(merged));
  });
});

// ── I3 ────────────────────────────────────────────────────────────────────
describe("I3 — re-diff empty: merging `merged` with itself is a no-op", () => {
  test.each(rows(clean))("%s", (_n, s) => {
    const { merged } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
    expect(diffSnapshots(merged!, merged!)).toEqual([]);
    const again = threeWayMerge(merged!, merged!, merged!);
    expect(again.report.verdict).toBe("clean");
    expect(canon(again.merged)).toEqual(canon(merged));
  });
});

// ── I4 ────────────────────────────────────────────────────────────────────
describe("I4 — every generated migration is prefix-valid", () => {
  test.each(rows(migrationScenarios))("§2 %s", (_n, s) => {
    const m = emitMigration(s.source, s.target);
    expect(() => verifyPrefixes(s.source, m.statements)).not.toThrow();
  });

  test.each(rows(clean.filter((s) => !EMIT_SWEEP_SKIP.has(s.name))))(
    "emit(theirs → merged) for §1 %s",
    (_n, s) => {
      const { merged } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
      const m = emitMigration(s.theirs, merged!);
      expect(() => verifyPrefixes(s.theirs, m.statements)).not.toThrow();
    },
  );

  // FINDING (ticket 0006). When a primary key's *id* changes between two
  // snapshots — a wholesale swap of the `primaryKey` object rather than a
  // `changePrimaryKey` — `diffSnapshots` emits `addPrimaryKey` for the new one
  // but no `dropPrimaryKey` for the old, so `emitMigration` fails its own
  // intermediate-state check. `it.fails` pins the current behaviour: this test
  // passes *while the bug exists* and will start failing (correctly) once emit
  // emits the drop, or once the fixture is reshaped to a `changePrimaryKey`.
  // Owned by ADR 0003 to decide; recorded here so it is not invisible.
  test.fails("emit gap — primary-key id swap omits the DROP CONSTRAINT", () => {
    const s = scenarios.find((x) => x.name === "primary-key replacement (one side)")!;
    const { merged } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
    const m = emitMigration(s.theirs, merged!);
    verifyPrefixes(s.theirs, m.statements);
  });
});

// ── I5 ────────────────────────────────────────────────────────────────────
// Direct commutativity is checked on the rows whose two sides provably touch
// disjoint objects (or, for rename-rebase, commute by construction because the
// dependent reference is an id). The rest is covered by the engine's own
// runtime oracle, which the "no scenario trips it" test below asserts stays quiet.
const INDEPENDENT = [
  "fast-forward (ours only)",
  "fast-forward (theirs only)",
  "false conflict (independent same-table edits)",
  "false conflict — fully independent tables",
  "false conflict — edit vs unrelated rename",
  "rename-rebase (ours renames, theirs indexes)",
  "rename-rebase — NOT NULL follows rename",
  "rename-rebase — foreign key follows rename",
  "rename-rebase — table rename, dependent follows",
];

describe("I5 — commutativity", () => {
  test.each(INDEPENDENT.map((n) => [n] as const))(
    "%s: Δours;Δtheirs == Δtheirs;Δours == merged",
    (name) => {
      const s = scenarios.find((x) => x.name === name)!;
      const { merged } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
      const dOurs = diffSnapshots(s.base, s.ours);
      const dTheirs = diffSnapshots(s.base, s.theirs);
      const ourThenTheirs = applyDelta(clone(dTheirs), applyDelta(clone(dOurs), clone(s.base)));
      const theirsThenOurs = applyDelta(clone(dOurs), applyDelta(clone(dTheirs), clone(s.base)));
      expect(canon(ourThenTheirs)).toEqual(canon(theirsThenOurs));
      expect(canon(ourThenTheirs)).toEqual(canon(merged));
    },
  );

  test("no catalogue scenario produces unclassified-divergence", () => {
    for (const s of scenarios) {
      const { report } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
      expect(report.verdict, s.name).not.toBe("unclassified-divergence");
      expect(report.divergence, s.name).toBeUndefined();
    }
  });
});

// ── I6 ────────────────────────────────────────────────────────────────────
describe("I6 — `merged` is non-null iff the verdict is clean", () => {
  test.each(rows(scenarios))("%s", (_n, s) => {
    const { merged, report } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
    expect(merged !== null).toBe(report.verdict === "clean");
  });
});

// ── I7 ────────────────────────────────────────────────────────────────────
const BASE_BEARING = ["divergent-retype", "rename-vs-rename", "divergent-index-definition"];

describe("I7 — conflict identity", () => {
  test.each(rows(conflicting))("%s", (_n, s) => {
    const { report } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
    for (const c of report.conflicts) {
      expect(c.id.startsWith(c.class)).toBe(true);
      if (BASE_BEARING.includes(c.class) && !c.id.includes("+")) {
        expect(c.base).not.toBeNull();
      }
    }
    const rerun = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
    expect(rerun.report.conflicts.map((c) => c.id).sort()).toEqual(
      report.conflicts.map((c) => c.id).sort(),
    );
  });
});

// ── I8 ────────────────────────────────────────────────────────────────────
test("I8 — structural validity is a separate pass (nullable PK member)", () => {
  const s = scenarios.find((x) => x.name.startsWith("boundary — nullable PK member"))!;
  const { merged, report } = threeWayMerge(s.base, s.ours, s.theirs);
  expect(report.verdict).toBe("clean");

  // Stand-in for ticket 0008's validateDocument(), which is design-only. The
  // merge is order-independent and clean; the merged document nonetheless has a
  // nullable column in a primary key. That is 0008's to catch, not the merge's —
  // pinned here so the boundary does not silently move.
  const posts = merged!.tables.find((t) => t.name === "posts")!;
  const nullableInPk = posts.primaryKey!.columnIds.some(
    (id) => posts.columns.find((c) => c.id === id)!.nullable,
  );
  expect(nullableInPk).toBe(true);
});
