/**
 * Merge scenario matrix — `docs/engine-test-catalog.md` §1.
 *
 * Every row of `__fixtures__/scenarios.ts` runs through `threeWayMerge`. The
 * table below asserts the verdict, the conflict classes, and the informational
 * counts; `structuralChecks` pins the exact merged document for the rows where
 * that is the point (rename-rebase, resolutions, overlaps).
 *
 * The commutativity oracle, the identity law, apply⇒merged, and re-diff-empty
 * are swept separately in `invariants.test.ts` (§3).
 */

import { describe, expect, test } from "vitest";
import { threeWayMerge } from "./merge.js";
import type { MergeReport } from "./merge-types.js";
import type { SchemaDocument } from "./schema.js";
import { seedIds, seedSchema } from "../examples/seed.schema.js";
import { scenarios, type Scenario } from "./__fixtures__/scenarios.js";

const usersOf = (d: SchemaDocument) => d.tables.find((t) => t.id === seedIds.users.table)!;
const postsOf = (d: SchemaDocument) => d.tables.find((t) => t.id === seedIds.posts.table)!;
const col = (d: SchemaDocument, tableId: string, colId: string) =>
  d.tables.find((t) => t.id === tableId)!.columns.find((c) => c.id === colId)!;

type Result = { merged: SchemaDocument | null; report: MergeReport };

/**
 * Structural assertions on `merged`, keyed by scenario name. Only the rows whose
 * catalogue entry has a "merged assertions" column appear here; the rest are
 * covered by verdict + classes alone.
 */
const structuralChecks: Record<string, (r: Result, s: Scenario) => void> = {
  "fast-forward (ours only)": ({ merged }, s) => expect(merged).toEqual(s.ours),
  "fast-forward (theirs only)": ({ merged }, s) => expect(merged).toEqual(s.theirs),
  "no-op merge (no edits either side)": ({ merged }) => expect(merged).toEqual(seedSchema),

  "false conflict — fully independent tables": ({ merged }) => {
    expect(usersOf(merged!).columns.some((c) => c.name === "nickname")).toBe(true);
    expect(postsOf(merged!).columns.some((c) => c.name === "slug")).toBe(true);
  },
  "false conflict — edit vs unrelated rename": ({ merged }) => {
    expect(postsOf(merged!).indexes.some((i) => i.id === "idx_pub_o")).toBe(true);
    expect(col(merged!, seedIds.users.table, seedIds.users.email).name).toBe("email_address");
  },

  "rename-rebase (ours renames, theirs indexes)": ({ merged }) => {
    const idx = usersOf(merged!).indexes.find((i) => i.id === "idx_email_addr")!;
    // reference is still held by the column's original id, not rewritten to a name
    expect(idx.columnIds).toEqual([seedIds.users.email]);
    expect(col(merged!, seedIds.users.table, seedIds.users.email).name).toBe("email_address");
  },
  "rename-rebase — NOT NULL follows rename": ({ merged }) => {
    const c = col(merged!, seedIds.users.table, seedIds.users.email);
    expect(c.name).toBe("email_address");
    expect(c.nullable).toBe(false);
  },
  "rename-rebase — foreign key follows rename": ({ merged }) => {
    const nl = merged!.tables.find((t) => t.id === "tbl_newsletter_0006")!;
    expect(nl.foreignKeys[0].refColumnIds).toEqual([seedIds.users.email]);
    expect(col(merged!, seedIds.users.table, seedIds.users.email).name).toBe("email_address");
  },
  "rename-rebase — table rename, dependent follows": ({ merged }) => {
    expect(postsOf(merged!).name).toBe("articles");
    expect(postsOf(merged!).indexes.some((i) => i.id === "idx_title_t")).toBe(true);
  },

  "divergent retype, resolved (take theirs)": ({ merged }) =>
    expect(col(merged!, seedIds.posts.table, seedIds.posts.viewCount).type).toEqual({ kind: "int" }),
  "divergent retype, resolved (take ours) — regression for the oracle-priming bug": ({ merged }) =>
    expect(col(merged!, seedIds.posts.table, seedIds.posts.viewCount).type).toEqual({ kind: "text" }),
  "divergent retype, resolved (explicit type) — oracle-priming regression": ({ merged }) =>
    expect(col(merged!, seedIds.posts.table, seedIds.posts.viewCount).type).toEqual({ kind: "bigint" }),
  "rename-vs-rename, resolved (take ours)": ({ merged }) =>
    expect(col(merged!, seedIds.users.table, seedIds.users.email).name).toBe("email_address"),

  "overlap — both add the identical index": ({ merged }) =>
    expect(postsOf(merged!).indexes.filter((i) => i.id === "idx_pub_shared")).toHaveLength(1),
  "degenerate overlap — both add an identical column": ({ merged }) =>
    expect(usersOf(merged!).columns.filter((c) => c.name === "locale")).toHaveLength(1),
  "degenerate overlap — remap recorded": ({ merged, report }) => {
    expect(usersOf(merged!).columns.filter((c) => c.name === "locale")).toHaveLength(1);
    expect(report.remaps.length).toBeGreaterThanOrEqual(1);
  },
};

describe("merge scenario matrix", () => {
  test.each(scenarios.map((s) => [s.name, s] as const))("%s", (_name, s) => {
    const { merged, report } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);

    expect(report.verdict).toBe(s.expect.verdict);

    if (s.expect.classes) {
      expect(report.conflicts.map((c) => c.class).sort()).toEqual([...s.expect.classes].sort());
    }
    if (s.expect.minRebased !== undefined) {
      expect(report.rebased.length).toBeGreaterThanOrEqual(s.expect.minRebased);
    }
    if (s.expect.minOverlaps !== undefined) {
      expect(report.overlaps.length).toBeGreaterThanOrEqual(s.expect.minOverlaps);
    }
    if (s.expect.minRemaps !== undefined) {
      expect(report.remaps.length).toBeGreaterThanOrEqual(s.expect.minRemaps);
    }

    // invariant restated per-row for a legible failure: merged is non-null iff clean
    expect(merged !== null).toBe(report.verdict === "clean");

    // every conflict id is prefixed by its class and is stable across a re-run
    for (const c of report.conflicts) expect(c.id.startsWith(c.class)).toBe(true);
    const rerun = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
    expect(rerun.report.conflicts.map((c) => c.id).sort()).toEqual(report.conflicts.map((c) => c.id).sort());

    structuralChecks[s.name]?.({ merged, report }, s);
  });

  test("every clean scenario without an explicit check still produced a document", () => {
    for (const s of scenarios) {
      if (s.expect.verdict !== "clean") continue;
      const { merged } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
      expect(merged, s.name).not.toBeNull();
    }
  });
});
