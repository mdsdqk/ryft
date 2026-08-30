/**
 * threeWayMerge — the semantic three-way merge entry point (`docs/merge-engine.md`).
 *
 * Pure and stateless. Given `base` / `ours` / `theirs` schema documents and any
 * stored `Resolution`s, it derives the two deltas, classifies them, and — when
 * nothing is left unresolved — composes `merged` and proves it with the
 * commutativity post-condition.
 *
 *   merged is non-null  ⟺  report.verdict === "clean"
 *
 * A `conflicts` verdict returns `merged: null` and the queue. An
 * `unclassified-divergence` verdict returns `merged: null` and a reason — either
 * the two application orders disagreed, or a delta would not replay.
 */

import { diffSnapshots } from "./diff.js";
import { applyDelta, DeltaApplyError } from "./apply.js";
import { classify } from "./classify.js";
import type { SchemaDocument } from "./schema.js";
import type { Resolution, MergeReport } from "./merge-types.js";

export interface MergeOutcome {
  merged: SchemaDocument | null;
  report: MergeReport;
}

export function threeWayMerge(
  base: SchemaDocument,
  ours: SchemaDocument,
  theirs: SchemaDocument,
  resolutions: Resolution[] = [],
): MergeOutcome {
  const deltaOurs = diffSnapshots(base, ours);
  const deltaTheirs = diffSnapshots(base, theirs);

  const c = classify(deltaOurs, deltaTheirs, resolutions);
  const base_report = {
    conflicts: c.conflicts,
    rebased: c.rebased,
    overlaps: c.overlaps,
    remaps: c.remaps,
  };

  if (c.unresolvedCount > 0) {
    return { merged: null, report: { verdict: "conflicts", ...base_report } };
  }

  // Composition + commutativity oracle, all guarded — a throw is the same signal
  // as a hole in the enumeration (docs/merge-engine.md §8).
  //
  // The oracle applies the two EFFECTIVE deltas — Δ_merge (≈ Δ_ours') and
  // Δ_theirs' (theirs pruned of resolution losers, from `classify`) — to `base`
  // in both orders. `merged` is taken as one order; the check is that the other
  // order agrees. With no resolutions Δ_theirs' === Δ_theirs and `merged` matches
  // the §3 "compose onto theirs" definition.
  try {
    const theirsPrime = applyDelta(c.theirsDelta, base);
    const merged = applyDelta(c.mergeDelta, theirsPrime); // order: theirs' then ours'
    const other = applyDelta(c.theirsDelta, applyDelta(c.mergeDelta, base)); // ours' then theirs'

    if (!docsEqual(merged, other)) {
      return {
        merged: null,
        report: {
          verdict: "unclassified-divergence",
          ...base_report,
          divergence: {
            kind: "unclassified-divergence",
            reason: "non-commutative",
            detail: "applying each side's effective delta to base in either order gives different results",
            divergingObjects: divergingObjects(merged, other),
          },
        },
      };
    }

    return { merged, report: { verdict: "clean", ...base_report } };
  } catch (err) {
    if (err instanceof DeltaApplyError) {
      return {
        merged: null,
        report: {
          verdict: "unclassified-divergence",
          ...base_report,
          divergence: {
            kind: "unclassified-divergence",
            reason: "apply-error",
            detail: `${err.message} (op: ${err.op.type})`,
            divergingObjects: [],
          },
        },
      };
    }
    throw err;
  }
}

// ── order-insensitive document equality (docs/merge-engine.md §8) ──────────

/**
 * Canonicalise a document for comparison: sort `tables` and each table's
 * `columns` / `indexes` / `uniques` / `foreignKeys` by id, so two legitimate
 * application orders compare equal. Column order *within* an index or primary key
 * is significant and is left untouched. `database` is a display label and is
 * dropped from the comparison.
 */
function canonicalDoc(doc: SchemaDocument): unknown {
  const byId = <T extends { id: string }>(xs: readonly T[]) =>
    [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    tables: byId(doc.tables).map((t) => ({
      id: t.id,
      name: t.name,
      columns: byId(t.columns),
      primaryKey: t.primaryKey, // columnIds order preserved
      foreignKeys: byId(t.foreignKeys),
      uniques: byId(t.uniques).map((u) => ({ id: u.id, columnIds: [...u.columnIds].sort() })),
      indexes: byId(t.indexes), // columnIds order preserved
    })),
  };
}

/** Recursively key-sorted JSON — does not depend on object key insertion order. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function docsEqual(a: SchemaDocument, b: SchemaDocument): boolean {
  return stableStringify(canonicalDoc(a)) === stableStringify(canonicalDoc(b));
}

/** Table ids whose canonical state differs between the two application orders. */
function divergingObjects(
  a: SchemaDocument,
  b: SchemaDocument,
): Array<{ kind: "table"; id: string; table?: string }> {
  const ca = (canonicalDoc(a) as { tables: Array<{ id: string }> }).tables;
  const cb = (canonicalDoc(b) as { tables: Array<{ id: string }> }).tables;
  const mapB = new Map(cb.map((t) => [t.id, stableStringify(t)]));
  const out: Array<{ kind: "table"; id: string }> = [];
  for (const t of ca) {
    if (mapB.get(t.id) !== stableStringify(t)) out.push({ kind: "table", id: t.id });
  }
  for (const t of cb) {
    if (!ca.some((x) => x.id === t.id)) out.push({ kind: "table", id: t.id });
  }
  return out;
}
