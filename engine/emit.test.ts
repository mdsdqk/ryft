/**
 * SQL-generation matrix — `docs/engine-test-catalog.md` §2.
 *
 * Every row of `__fixtures__/migration-scenarios.ts` runs through
 * `emitMigration`. For each we assert:
 *   - the emitted statement `kind`s, in order (where the fixture pins them);
 *   - `before` ordering pairs — "first match of A precedes first match of B",
 *     matched against a statement's JSON form or its serialized SQL;
 *   - `contains` — verbatim substrings the migration SQL must include;
 *   - that `verifyPrefixes` accepts the ordered statements (every prefix leaves
 *     the schema referentially sound — ADR 0003 §4).
 */

import { describe, expect, test } from "vitest";
import { emitMigration, serialize, type DdlStatement } from "./emit.js";
import { verifyPrefixes } from "./replay.js";
import { migrationScenarios } from "./__fixtures__/migration-scenarios.js";

describe("SQL-generation matrix", () => {
  test.each(migrationScenarios.map((s) => [s.name, s] as const))("%s", (_name, s) => {
    const migration = emitMigration(s.source, s.target);
    const kinds = migration.statements.map((st) => st.kind);

    if (s.expect.kinds) {
      expect(kinds).toEqual(s.expect.kinds);
    }

    // one haystack string per statement: its JSON form + its SQL, so a fixture
    // can assert `before` on either representation
    const hay = migration.statements.map((st) => `${JSON.stringify(st)} ${serialize(st)}`);
    for (const [a, b] of s.expect.before ?? []) {
      const ia = hay.findIndex((h) => h.includes(a));
      const ib = hay.findIndex((h) => h.includes(b));
      expect(ia, `nothing matches ${a}`).toBeGreaterThanOrEqual(0);
      expect(ib, `nothing matches ${b}`).toBeGreaterThanOrEqual(0);
      expect(ia, `${a} @${ia} must precede ${b} @${ib}`).toBeLessThan(ib);
    }

    for (const frag of s.expect.contains ?? []) {
      expect(migration.sql, `SQL missing: ${frag}`).toContain(frag);
    }

    // emitMigration already runs this internally before serializing; re-run
    // explicitly so a prefix failure is its own assertion.
    if (s.expect.prefixesValid) {
      expect(() => verifyPrefixes(s.source, migration.statements)).not.toThrow();
    } else {
      expect(() => verifyPrefixes(s.source, migration.statements)).toThrow();
    }
  });

  test("a rename always renders as ALTER … RENAME, never DROP + ADD", () => {
    const m = emitMigration(
      migrationScenarios[0].source,
      migrationScenarios[0].target,
    );
    expect(m.sql).toContain('RENAME COLUMN "email" TO "email_address"');
    expect(m.sql).not.toMatch(/DROP COLUMN "email"[\s\S]*ADD COLUMN "email_address"/);
  });

  test("a genuine drop carries destructive: true", () => {
    const byName = (n: string) => migrationScenarios.find((s) => s.name === n)!;

    const colDrop = emitMigration(byName("drop a column with no dependents").source, byName("drop a column with no dependents").target).statements;
    expect(colDrop).toHaveLength(1);
    expect((colDrop[0] as { destructive?: boolean }).destructive).toBe(true);

    const tableDrop = emitMigration(byName("drop a table").source, byName("drop a table").target).statements;
    expect(tableDrop).toHaveLength(1);
    expect((tableDrop[0] as { destructive?: boolean }).destructive).toBe(true);
  });

  test("the drop half of a change* pair is NOT flagged destructive", () => {
    // `changeIndex` expands to an adjacent [dropIndex, createIndex] redefinition
    // (ADR 0003 §3). The drop there is mechanical, not a real removal, so 0008's
    // warning pass must not treat it as a destructive change.
    const s = migrationScenarios.find((x) => x.name.startsWith("change an index"))!;
    const [drop, create] = emitMigration(s.source, s.target).statements;
    expect(drop.kind).toBe("dropIndex");
    expect(create.kind).toBe("createIndex");
    expect((drop as { destructive?: boolean }).destructive).toBe(false);
  });
});
