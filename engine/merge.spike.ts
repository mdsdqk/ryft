/**
 * Merge engine spike runner.
 *
 *   pnpm spike engine/merge.spike.ts
 *
 * Runs every scenario in `__fixtures__/scenarios.ts` through `threeWayMerge` and
 * checks the verdict, the conflict classes, and the informational counts against
 * what the scenario expects. Exits non-zero on any mismatch. This is the rough
 * spike the ticket asks for, not the table-test suite (ticket 0006).
 */

import { threeWayMerge } from "./merge.js";
import { scenarios } from "./__fixtures__/scenarios.js";

let failures = 0;

for (const s of scenarios) {
  const { merged, report } = threeWayMerge(s.base, s.ours, s.theirs, s.resolutions);
  const gotClasses = report.conflicts.map((c) => c.class).sort();
  const wantClasses = (s.expect.classes ?? []).slice().sort();

  const problems: string[] = [];
  if (report.verdict !== s.expect.verdict) {
    problems.push(`verdict ${report.verdict} ≠ ${s.expect.verdict}`);
  }
  if (s.expect.classes && JSON.stringify(gotClasses) !== JSON.stringify(wantClasses)) {
    problems.push(`classes [${gotClasses}] ≠ [${wantClasses}]`);
  }
  if (s.expect.minRebased && report.rebased.length < s.expect.minRebased) {
    problems.push(`rebased ${report.rebased.length} < ${s.expect.minRebased}`);
  }
  if (s.expect.minOverlaps && report.overlaps.length < s.expect.minOverlaps) {
    problems.push(`overlaps ${report.overlaps.length} < ${s.expect.minOverlaps}`);
  }
  if (report.verdict === "unclassified-divergence" && s.expect.verdict !== "unclassified-divergence") {
    problems.push(`divergence: ${report.divergence?.detail}`);
  }
  // invariant: merged is non-null iff verdict is clean
  if ((merged !== null) !== (report.verdict === "clean")) {
    problems.push(`merged ${merged === null ? "null" : "set"} but verdict ${report.verdict}`);
  }
  // invariant: every conflict carries a stable id and a populated base where the op has one
  for (const c of report.conflicts) {
    if (!c.id.startsWith(c.class)) problems.push(`conflict id "${c.id}" not prefixed by class`);
    const baseBearing = c.class === "divergent-retype" || c.class === "rename-vs-rename" || c.class === "divergent-index-definition";
    if (baseBearing && !c.id.includes("+") && c.base === null) problems.push(`${c.class} has base: null`);
  }

  const mark = problems.length === 0 ? "ok  " : "FAIL";
  if (problems.length) failures++;
  console.log(
    `${mark}  ${s.name.padEnd(52)}  ${report.verdict.padEnd(22)}` +
      `${gotClasses.length ? ` [${gotClasses}]` : ""}${problems.length ? `  — ${problems.join("; ")}` : ""}`,
  );
}

console.log(`\n${scenarios.length - failures}/${scenarios.length} scenarios passed`);
process.exit(failures ? 1 : 0);
