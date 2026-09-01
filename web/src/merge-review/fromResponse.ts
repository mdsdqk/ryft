/**
 * `MergeRequestResponse` (raw engine output over the HTTP wire) → `MergeReview`
 * (the screen's view model). The transform `docs/backend-contract.md` §4 says
 * the client owns — "the same shape `web/src/merge-review/fixture.ts` builds
 * from literals now." This is that transform.
 *
 * Scope (pragmatic & honest, not full fixture parity):
 *  - `revisions`/`rows` are scoped to one "primary" table — the one most ops
 *    touch — matching the model's single-table screen (`MergeReview.table`).
 *    An op on a different table (rare) is dropped rather than mis-rendered.
 *  - No per-op author/timestamp exists server-side; every `RevisionRef` carries
 *    `res.author`/`res.openedAt`. `theirs`-side revisions have no attributable
 *    author (they landed via whatever merged into `target` before this MR was
 *    opened), so they're credited to `target` itself, not fabricated.
 *  - `fabricationOrder.statements` render the real migration IR with no
 *    △-tag / side / rebased provenance — `emitMigration`'s `DdlStatement`
 *    carries none (confirmed: only resolved names + `destructive`).
 *  - `add-vs-add` renders as two independent conflicting rows (one per side's
 *    new object) rather than one fixture-style composite row — both still
 *    point at the same conflict card.
 *  - `gates` (what a conflict blocks downstream) are derived structurally:
 *    indexes/uniques/foreign keys in `ours`/`theirs` whose columns include the
 *    conflicted column. Best-effort; empty when nothing references it.
 */

import type { SchemaDocument, ColumnType } from "@engine/schema.js";
import type { Operation } from "@engine/operations.js";
import { diffSnapshots } from "@engine/diff.js";
import { serialize } from "@engine/emit.js";
import type { Migration } from "@engine/emit.js";
import type {
  Conflict as EngineConflict,
  ConflictClass as EngineConflictClass,
  MergeReport,
  RebasedChange,
} from "@engine/merge-types.js";

import {
  changedObjectId,
  columnSpec,
  foreignKeySpec,
  indexSpec,
  primaryKeySpec,
  summarizeOp,
  uniqueSpec,
  sqlType,
  type NameOf,
} from "../surfaces/branch/format.ts";
import { retypeDetail, conflictLabel } from "./format.ts";
import type {
  ChangeKind,
  ComparisonRow,
  Conflict,
  ConflictClass,
  ConflictOption,
  DdlBlocked,
  DdlStatement,
  MergeReview,
  ObjectGroup,
  Party,
  RevisionRef,
  RevisionStatus,
  RowResolution,
  SideChange,
} from "./model.ts";

/** The `GET /merge-requests/:id` (and every resolution-mutation) response body. */
export type MergeRequestResponseBody = {
  id: string;
  source: string;
  target: string;
  author: string;
  openedAt: string;
  base: SchemaDocument;
  ours: SchemaDocument;
  theirs: SchemaDocument;
  report: MergeReport;
  migration: Migration | null;
  queue: { status: "queued" | "open" | "held" | "merged"; position: number; ahead: number; behind: number };
  stale: boolean;
  appliedResolutions: Array<{
    conflictId: string;
    choice: "ours" | "theirs" | "type";
    type: ColumnType | null;
    snapshot: { base: unknown; ours: unknown; theirs: unknown };
  }>;
  droppedResolutions: Array<{ conflictId: string; why: "changed" | "absent" }>;
};

// ── class-name mapping (engine's 7 values → the view's 7; §B1 of the plan) ──

const CLASS_MAP: Record<EngineConflictClass, ConflictClass> = {
  "divergent-retype": "divergent-retype",
  "add-vs-add": "add-vs-add",
  "rename-vs-rename": "rename-vs-rename",
  "divergent-index-definition": "divergent-index",
  "drop-vs-modify": "drop-vs-modify",
  "dependency-conflict": "dependency",
  "divergent-definition": "divergent-definition",
};

/** `${class}:${sortedIds.join("+")}` — parsed back into its parts. */
function parseConflictId(id: string): { cls: EngineConflictClass; objectIds: string[] } {
  const i = id.indexOf(":");
  return { cls: id.slice(0, i) as EngineConflictClass, objectIds: id.slice(i + 1).split("+") };
}

/** The `resolutionModes` a class accepts — mirrors `engine/classify.ts`'s own
 * per-class assignment, so a resolved conflict (whose engine `Conflict` is
 * gone) can still render its option set. */
function resolutionModesFor(cls: EngineConflictClass): Array<"ours" | "theirs" | "type"> {
  if (cls === "divergent-retype") return ["ours", "theirs", "type"];
  if (cls === "dependency-conflict") return ["theirs"];
  return ["ours", "theirs"];
}

// ── name resolution ──────────────────────────────────────────────────────

function buildNameOf(...docs: SchemaDocument[]): NameOf {
  const names = new Map<string, string>();
  for (const doc of docs) {
    for (const t of doc.tables) {
      names.set(t.id, t.name);
      for (const c of t.columns) names.set(c.id, c.name);
      for (const ix of t.indexes) names.set(ix.id, ix.name);
      for (const u of t.uniques) names.set(u.id, u.name);
      for (const fk of t.foreignKeys) names.set(fk.id, fk.name);
      if (t.primaryKey) names.set(t.primaryKey.id, t.primaryKey.name);
    }
  }
  return (id) => names.get(id) ?? id;
}

// ── op → table / group / SideChange ─────────────────────────────────────

function tableIdOf(op: Operation): string {
  return op.type === "createTable" || op.type === "dropTable" ? op.table.id : op.tableId;
}

function objectGroupOf(op: Operation): ObjectGroup | null {
  switch (op.type) {
    case "addColumn":
    case "dropColumn":
    case "renameColumn":
    case "retypeColumn":
    case "setNullable":
    case "setDefault":
      return "columns";
    case "addIndex":
    case "dropIndex":
    case "changeIndex":
      return "indexes";
    case "addPrimaryKey":
    case "dropPrimaryKey":
    case "changePrimaryKey":
    case "addUnique":
    case "dropUnique":
    case "changeUnique":
    case "addForeignKey":
    case "dropForeignKey":
    case "changeForeignKey":
      return "constraints";
    default:
      return null; // table-level: out of scope for a single-table row grid
  }
}

const KIND_MAP: Record<Operation["type"], ChangeKind> = {
  createTable: "create-table",
  dropTable: "drop-table",
  renameTable: "rename-table",
  addColumn: "add-column",
  dropColumn: "drop-column",
  renameColumn: "rename",
  retypeColumn: "retype",
  setNullable: "set-nullable",
  setDefault: "set-default",
  addPrimaryKey: "add-pk",
  dropPrimaryKey: "drop-pk",
  changePrimaryKey: "change-pk",
  addIndex: "add-index",
  dropIndex: "drop-index",
  changeIndex: "change-index",
  addUnique: "add-unique",
  dropUnique: "drop-unique",
  changeUnique: "change-unique",
  addForeignKey: "add-fk",
  dropForeignKey: "drop-fk",
  changeForeignKey: "change-fk",
};

const defSpec = (def: { unique?: boolean; columnIds: readonly string[] }, nameOf: NameOf): string =>
  `${def.unique ? "unique " : ""}(${def.columnIds.map(nameOf).join(", ")})`;

function sideChangeFor(op: Operation, revision: number, nameOf: NameOf): SideChange {
  const kind = KIND_MAP[op.type];
  switch (op.type) {
    case "renameColumn":
      return { kind, revision, detail: "", wasName: op.from, newName: op.to };
    case "renameTable":
      return { kind, revision, detail: "", wasName: op.from, newName: op.to };
    case "retypeColumn":
      return { kind, revision, detail: retypeDetail(op.from, op.to) };
    case "setNullable":
      return { kind, revision, detail: op.to ? "drop not null" : "set not null" };
    case "setDefault":
      return { kind, revision, detail: op.to === null ? "drop default" : `default → ${op.to}` };
    case "addColumn":
    case "dropColumn":
      return { kind, revision, detail: columnSpec(op.column) };
    case "addIndex":
    case "dropIndex":
      return { kind, revision, detail: indexSpec(op.index, nameOf) };
    case "changeIndex":
      return { kind, revision, detail: `→ ${defSpec(op.to, nameOf)}` };
    case "addPrimaryKey":
    case "dropPrimaryKey":
      return { kind, revision, detail: primaryKeySpec(op.primaryKey, nameOf) };
    case "changePrimaryKey":
      return { kind, revision, detail: `(${op.from.map(nameOf).join(", ")}) → (${op.to.map(nameOf).join(", ")})` };
    case "addUnique":
    case "dropUnique":
      return { kind, revision, detail: uniqueSpec(op.unique, nameOf) };
    case "changeUnique":
      return { kind, revision, detail: `→ ${defSpec(op.to, nameOf)}` };
    case "addForeignKey":
    case "dropForeignKey":
      return { kind, revision, detail: foreignKeySpec(op.fk, nameOf) };
    case "changeForeignKey":
      return { kind, revision, detail: `→ (${op.to.columnIds.map(nameOf).join(", ")}) → ${nameOf(op.to.refTableId)}` };
    case "createTable":
      return { kind, revision, detail: `create table ${op.table.name}` };
    case "dropTable":
      return { kind, revision, detail: `drop table ${op.table.name}` };
  }
}

// ── conflict payload → prose ─────────────────────────────────────────────

function describePayload(payload: unknown, nameOf: NameOf): string {
  if (payload == null) return "—";
  if (typeof payload === "string") return payload; // a rename's `to` name
  if (typeof payload === "boolean") return payload ? "nullable" : "not null";
  if (typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.kind === "string" && ("n" in p || "precision" in p || p.kind)) {
      try {
        return sqlType(p as ColumnType);
      } catch {
        /* not actually a ColumnType — fall through */
      }
    }
    if ("dropped" in p) return "the referenced object was dropped";
    if ("drop" in p) return `dropped (${String(p.drop)})`;
    if (Array.isArray(p.columnIds)) return `(${(p.columnIds as string[]).map(nameOf).join(", ")})`;
    if (typeof p.name === "string") return p.name;
  }
  return String(payload);
}

function conflictTitle(cls: ConflictClass, objectLabel: string): string {
  switch (cls) {
    case "divergent-retype":
      return `${objectLabel} retyped differently on both sides`;
    case "add-vs-add":
      return `both sides added an object at ${objectLabel}`;
    case "rename-vs-rename":
      return `${objectLabel} renamed differently on both sides`;
    case "divergent-index":
      return `${objectLabel} defined differently on both sides`;
    case "drop-vs-modify":
      return `${objectLabel} dropped on one side, modified on the other`;
    case "dependency":
      return `${objectLabel} depends on something the other side removed`;
    case "divergent-definition":
      return `${objectLabel} defined differently on both sides`;
  }
}

function optionsFor(modes: Array<"ours" | "theirs" | "type">, ours: unknown, theirs: unknown, nameOf: NameOf): ConflictOption[] {
  const opts: ConflictOption[] = [];
  let hint = 1;
  if (modes.includes("ours")) opts.push({ id: "ours", kind: "ours", hint: String(hint++), label: `keep ours — ${describePayload(ours, nameOf)}` });
  if (modes.includes("theirs")) opts.push({ id: "theirs", kind: "theirs", hint: String(hint++), label: `keep theirs — ${describePayload(theirs, nameOf)}` });
  if (modes.includes("type")) opts.push({ id: "custom", kind: "custom", hint: String(hint++), label: "Specify target type…" });
  return opts;
}

/** Indexes / uniques / foreign keys (in either doc) whose columns include `columnId`. */
function dependentsOf(columnId: string, doc: SchemaDocument): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const t of doc.tables) {
    for (const ix of t.indexes) if (ix.columnIds.includes(columnId)) out.push({ id: ix.id, label: ix.name });
    for (const u of t.uniques) if (u.columnIds.includes(columnId)) out.push({ id: u.id, label: u.name });
    for (const fk of t.foreignKeys) if (fk.columnIds.includes(columnId)) out.push({ id: fk.id, label: fk.name });
  }
  return out;
}

// ── the transform ────────────────────────────────────────────────────────

export function mergeReviewFromResponse(res: MergeRequestResponseBody): MergeReview {
  const nameOf = buildNameOf(res.base, res.theirs, res.ours);

  const allOurs = diffSnapshots(res.base, res.ours);
  const allTheirs = diffSnapshots(res.base, res.theirs);

  // The primary table is whichever most of the combined delta touches — the
  // screen is single-table (`MergeReview.table`); an op on any other table is
  // dropped from `rows`/`revisions` rather than mis-rendered.
  const tableCounts = new Map<string, number>();
  for (const op of [...allOurs, ...allTheirs]) {
    const id = tableIdOf(op);
    tableCounts.set(id, (tableCounts.get(id) ?? 0) + 1);
  }
  const tableId =
    [...tableCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? res.theirs.tables[0]?.id ?? res.ours.tables[0]?.id ?? "";

  const oursOps = allOurs.filter((op) => tableIdOf(op) === tableId);
  const theirsOps = allTheirs.filter((op) => tableIdOf(op) === tableId);

  // ── revisions ──
  const revisions: RevisionRef[] = [];
  const oursParty: Party = { userId: res.author, name: res.author };
  const theirsParty: Party = { userId: res.target, name: res.target };
  let n = 0;
  for (const op of oursOps) {
    n += 1;
    revisions.push({ n, side: "ours", author: oursParty, at: res.openedAt, op, summary: summarizeOp(op, nameOf) });
  }
  for (const op of theirsOps) {
    n += 1;
    revisions.push({ n, side: "theirs", author: theirsParty, at: res.openedAt, op, summary: summarizeOp(op, nameOf) });
  }
  const revisionOf = new Map(revisions.map((r) => [r.op, r.n]));

  // ── conflict lookups (report.conflicts already excludes anything resolved —
  //    resolveMerge on the server re-runs threeWayMerge with the stored
  //    resolutions applied) ──
  // `report.conflicts` is the engine's full detected set — resolving a
  // conflict changes `verdict` but does not remove its entry (the engine
  // `Conflict` carries no `resolvedWith`). Exclude anything with a stored
  // resolution so it renders once, as a resolved card, not twice.
  const resolvedIds = new Set(res.appliedResolutions.map((a) => a.conflictId));
  const openConflicts = res.report.conflicts.filter((c) => !resolvedIds.has(c.id));
  const conflictsForObjectId = new Map<string, EngineConflict>();
  for (const c of openConflicts) {
    conflictsForObjectId.set(c.object.id, c);
    const { objectIds } = parseConflictId(c.id);
    for (const id of objectIds) conflictsForObjectId.set(id, c);
  }
  const rebasedByObjectId = new Map<string, RebasedChange>();
  for (const rb of res.report.rebased) rebasedByObjectId.set(changedObjectId(rb.op), rb);

  const resolvedNoteByObjectId = new Map<string, string>();
  for (const a of res.appliedResolutions) {
    const { objectIds } = parseConflictId(a.conflictId);
    const note = a.choice === "type" ? "resolved — retyped" : `resolved — kept ${a.choice}`;
    for (const id of objectIds) resolvedNoteByObjectId.set(id, note);
  }

  // objectId → the conflict it's gated behind, for column conflicts with
  // dependents (indexes/uniques/FKs referencing the conflicted column).
  const gatedByObjectId = new Map<string, string>();
  const gateLabelsByConflictId = new Map<string, string[]>();
  for (const c of openConflicts) {
    if (c.object.kind !== "column") continue;
    const deps = [...dependentsOf(c.object.id, res.ours), ...dependentsOf(c.object.id, res.theirs)];
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const d of deps) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      labels.push(d.label);
      if (!conflictsForObjectId.has(d.id)) gatedByObjectId.set(d.id, c.id);
    }
    gateLabelsByConflictId.set(c.id, labels);
  }

  // ── rows ──
  type Bucket = { group: ObjectGroup; ours?: Operation; theirs?: Operation };
  const buckets = new Map<string, Bucket>();
  for (const op of oursOps) {
    const group = objectGroupOf(op);
    if (!group) continue;
    const id = changedObjectId(op);
    const b = buckets.get(id) ?? { group };
    b.ours = op;
    buckets.set(id, b);
  }
  for (const op of theirsOps) {
    const group = objectGroupOf(op);
    if (!group) continue;
    const id = changedObjectId(op);
    const b = buckets.get(id) ?? { group };
    b.theirs = op;
    buckets.set(id, b);
  }

  const rows: ComparisonRow[] = [...buckets.entries()].map(([objectId, b]) => {
    const ours = b.ours ? sideChangeFor(b.ours, revisionOf.get(b.ours)!, nameOf) : null;
    const theirs = b.theirs ? sideChangeFor(b.theirs, revisionOf.get(b.theirs)!, nameOf) : null;

    let resolution: RowResolution;
    let leader: { text: string; tone: "ok" | "muted" } | undefined;

    const conflict = conflictsForObjectId.get(objectId);
    const gateConflictId = gatedByObjectId.get(objectId);
    const rebased = rebasedByObjectId.get(objectId);
    if (conflict) {
      resolution = { state: "conflict", conflictId: conflict.id };
    } else if (gateConflictId) {
      resolution = { state: "gated", byConflictId: gateConflictId, note: "held until the blocking conflict resolves" };
    } else if (rebased) {
      resolution = { state: "auto-merged", note: `rebased onto ${nameOf(rebased.followedRename.objectId)}` };
      leader = { text: `reference followed the rename ${rebased.followedRename.from} → ${rebased.followedRename.to}`, tone: "ok" };
    } else if (ours && theirs) {
      resolution = { state: "auto-merged", note: resolvedNoteByObjectId.get(objectId) ?? "merged on one id" };
    } else {
      resolution = { state: "clean" };
    }

    return {
      objectId,
      objectLabel: `${nameOf(tableId)}.${nameOf(objectId)}`,
      group: b.group,
      ours,
      theirs,
      resolution,
      ...(leader ? { leader } : {}),
    };
  });

  // ── conflict cards: open + resolved ──
  const openCards: Conflict[] = openConflicts.map((c) => {
    const cls = CLASS_MAP[c.class];
    const objectLabel = nameOf(c.object.id);
    return {
      id: c.id,
      cls,
      severity: c.severity,
      objectId: c.object.id,
      objectLabel,
      title: conflictTitle(cls, objectLabel),
      ours: { author: oursParty, detail: describePayload(c.ours, nameOf) },
      theirs: { author: theirsParty, detail: describePayload(c.theirs, nameOf) },
      options: optionsFor(c.resolutionModes, c.ours, c.theirs, nameOf),
      resolvedWith: null,
      gates: gateLabelsByConflictId.get(c.id) ?? [],
    };
  });
  const resolvedCards: Conflict[] = res.appliedResolutions.map((a) => {
    const { cls: engineCls, objectIds } = parseConflictId(a.conflictId);
    const cls = CLASS_MAP[engineCls];
    const objectLabel = objectIds.map(nameOf).join(" / ");
    const modes = resolutionModesFor(engineCls);
    return {
      id: a.conflictId,
      cls,
      severity: engineCls === "dependency-conflict" ? "subtle" : "clear",
      objectId: objectIds[0]!,
      objectLabel,
      title: conflictTitle(cls, objectLabel),
      ours: { author: oursParty, detail: describePayload(a.snapshot.ours, nameOf) },
      theirs: { author: theirsParty, detail: describePayload(a.snapshot.theirs, nameOf) },
      options: optionsFor(modes, a.snapshot.ours, a.snapshot.theirs, nameOf),
      resolvedWith: a.choice === "type" ? "custom" : a.choice,
      gates: [], // ConflictQueue only shows gates on an open conflict
    };
  });
  const conflicts = [...openCards, ...resolvedCards];

  // ── fabrication order ──
  const statements: DdlStatement[] = (res.migration?.statements ?? []).map((s) => ({
    sql: serialize(s),
    revision: null,
    side: null,
  }));
  const blocked: DdlBlocked[] = openConflicts.map((c) => {
    const cls = CLASS_MAP[c.class];
    const label = nameOf(c.object.id);
    const gates = gateLabelsByConflictId.get(c.id) ?? [];
    return {
      conflictId: c.id,
      reason: `${conflictLabel(cls)} on ${label}${gates.length ? ` — also gates ${gates.join(", ")}` : ""}`,
    };
  });

  const commutativity: MergeReview["commutativity"] =
    res.report.verdict === "clean" ? "passed" : res.report.verdict === "unclassified-divergence" ? "failed" : "pending";
  const status: RevisionStatus = "in-check"; // effectiveStatus() derives "cleared" once mergeable
  const autoMergedCount = rows.filter((r) => r.resolution.state === "auto-merged").length;

  return {
    source: res.source,
    target: res.target,
    base: res.target,
    table: nameOf(tableId),
    openedBy: oursParty,
    openedAt: res.openedAt,
    status,
    rows,
    conflicts,
    revisions,
    autoMergedCount,
    fabricationOrder: { statements, blocked, transactional: true },
    commutativity,
  };
}
