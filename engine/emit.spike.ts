/**
 * Migration-generation spike runner.
 *
 *   pnpm spike engine/emit.spike.ts
 *
 * Runs every scenario in `__fixtures__/migration-scenarios.ts` through
 * `emitMigration` and checks the emitted statement kinds, the ordering
 * assertions, and the intermediate-state replay check against what the scenario
 * expects. Exits non-zero on any mismatch. This is the rough spike, not the
 * table-test suite (ticket 0006).
 */

import { emitMigration, serialize } from "./emit.js";
import { verifyPrefixes } from "./replay.js";
import { migrationScenarios } from "./__fixtures__/migration-scenarios.js";

let failures = 0;

for (const s of migrationScenarios) {
  const problems: string[] = [];
  let sql = "";

  try {
    const migration = emitMigration(s.source, s.target);
    sql = migration.sql;
    const gotKinds = migration.statements.map((st) => st.kind);

    if (JSON.stringify(gotKinds) !== JSON.stringify(s.expect.kinds)) {
      problems.push(`kinds [${gotKinds}] ≠ [${s.expect.kinds}]`);
    }

    // Ordering assertions. Each [a, b]: the first statement matching `a` must
    // precede the first matching `b`. A statement "matches" if the substring is
    // in its JSON form OR its serialized SQL, so a fixture can assert on either.
    const hay = migration.statements.map((st) => `${JSON.stringify(st)} ${serialize(st)}`);
    for (const [a, b] of s.expect.before ?? []) {
      const ia = hay.findIndex((h) => h.includes(a));
      const ib = hay.findIndex((h) => h.includes(b));
      if (ia < 0) problems.push(`before: nothing matches ${JSON.stringify(a)}`);
      else if (ib < 0) problems.push(`before: nothing matches ${JSON.stringify(b)}`);
      else if (ia >= ib) problems.push(`before: ${JSON.stringify(a)} @${ia} not before ${JSON.stringify(b)} @${ib}`);
    }

    for (const frag of s.expect.contains ?? []) {
      if (!sql.includes(frag)) problems.push(`contains: SQL is missing ${JSON.stringify(frag)}`);
    }

    // Intermediate-state check. `emitMigration` already ran it (it would have
    // thrown above); re-run explicitly so the spike reports it as its own line,
    // and so a `prefixesValid: false` fixture can assert the failure.
    try {
      verifyPrefixes(s.source, migration.statements);
      if (!s.expect.prefixesValid) problems.push("prefixes: expected an intermediate-state failure, got none");
    } catch (e) {
      if (s.expect.prefixesValid) problems.push(`prefixes: ${(e as Error).message}`);
    }
  } catch (err) {
    problems.push(`threw: ${(err as Error).message}`);
  }

  const mark = problems.length === 0 ? "ok  " : "FAIL";
  if (problems.length) failures++;
  console.log(`${mark}  ${s.name}${problems.length ? `  — ${problems.join("; ")}` : ""}`);
  if (problems.length && sql) console.log(sql.replace(/^/gm, "        "));
}

console.log(`\n${migrationScenarios.length - failures}/${migrationScenarios.length} scenarios passed`);
process.exit(failures ? 1 : 0);
