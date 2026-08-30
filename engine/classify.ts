/**
 * classify — the two-pass conflict classifier (`docs/merge-engine.md` §2, §5, §9).
 *
 * Input: the two derived deltas, `Δ_ours` and `Δ_theirs`, from
 * `diffSnapshots(base, ours)` / `diffSnapshots(base, theirs)`, plus any stored
 * `Resolution`s. Output: the classified conflicts, the informational notes
 * (overlaps, rebases, id remaps), and `mergeDelta` — the subset of `Δ_ours` to
 * replay onto `theirs`, already adjusted for overlaps and for whichever
 * resolutions were supplied.
 *
 * Pass 1 keys every op onto a slot `(key, aspect)` and pairs the two sides slot
 * by slot: divergent retype, add-vs-add, rename-vs-rename, divergent index
 * definition, the catch-all, and overlap.
 *
 * Pass 2 reconciles across slots — drop-vs-modify (a `drop*` on one side against
 * an op whose *subject* is that id on the other) and dependency conflict (a
 * surviving op that *references* an id the other side dropped). Pass 1 wins:
 * pass 2 skips objects already carrying a pass-1 conflict.
 *
 * Primary keys are handled up front by `classifyPrimaryKeys`, because a one-side
 * PK replacement is two ops (`dropPrimaryKey` + `addPrimaryKey`) on one slot.
 *
 * This is a spike. Detection covers all seven classes. Resolution application is
 * complete for classes 1, 3 (identity-slot form), 4, 6, 7; classes 2 and the
 * name-collision form of 3 and 5 apply a best-effort compensating op and are
 * marked inline.
 */

import type { Operation } from "./operations.js";
import type { ColumnType, PrimaryKey } from "./schema.js";
import type {
  Conflict,
  ConflictClass,
  IdRemap,
  ObjectKind,
  OverlapNote,
  RebasedChange,
  Resolution,
  Severity,
} from "./merge-types.js";

export interface ClassifyResult {
  conflicts: Conflict[];
  /** Conflicts with no matching `Resolution`. When > 0 the merge is held. */
  unresolvedCount: number;
  /**
   * Δ_merge (≈ Δ_ours'): ops to replay onto `theirs`. Meaningful only when
   * `unresolvedCount === 0`.
   */
  mergeDelta: Operation[];
  /**
   * Δ_theirs': `deltaTheirs` pruned symmetrically to `mergeDelta` — a resolved
   * conflict that `ours` (or an explicit type) won has the losing `theirs` op
   * removed. The commutativity oracle applies THIS, not the raw `deltaTheirs`,
   * so a resolution that discards a `theirs` op does not re-appear in one
   * application order (`docs/merge-engine.md` §8).
   */
  theirsDelta: Operation[];
  rebased: RebasedChange[];
  overlaps: OverlapNote[];
  remaps: IdRemap[];
}

type Side = "ours" | "theirs";

// ── structural equality (deterministic) ────────────────────────────────────

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = canon((v as Record<string, unknown>)[k]);
    }
    return o;
  }
  return v;
}
function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

// ── per-op facts ──────────────────────────────────────────────────────────

const SEVERITY: Record<ConflictClass, Severity> = {
  "divergent-retype": "clear",
  "add-vs-add": "clear",
  "rename-vs-rename": "clear",
  "divergent-index-definition": "clear",
  "drop-vs-modify": "clear",
  "dependency-conflict": "subtle",
  "divergent-definition": "clear",
};

/** The id the op acts on, and that object's kind + owning table. */
function subject(op: Operation): { id: string; kind: ObjectKind; table: string | null } {
  switch (op.type) {
    case "createTable":
      return { id: op.table.id, kind: "table", table: op.table.id };
    case "dropTable":
      return { id: op.table.id, kind: "table", table: op.table.id };
    case "renameTable":
      return { id: op.tableId, kind: "table", table: op.tableId };
    case "addColumn":
      return { id: op.column.id, kind: "column", table: op.tableId };
    case "dropColumn":
      return { id: op.column.id, kind: "column", table: op.tableId };
    case "renameColumn":
    case "retypeColumn":
    case "setNullable":
    case "setDefault":
      return { id: op.columnId, kind: "column", table: op.tableId };
    case "addPrimaryKey":
    case "dropPrimaryKey":
      return { id: op.primaryKey.id, kind: "primaryKey", table: op.tableId };
    case "changePrimaryKey":
      return { id: op.primaryKeyId, kind: "primaryKey", table: op.tableId };
    case "addIndex":
    case "dropIndex":
      return { id: op.index.id, kind: "index", table: op.tableId };
    case "changeIndex":
      return { id: op.indexId, kind: "index", table: op.tableId };
    case "addUnique":
    case "dropUnique":
      return { id: op.unique.id, kind: "unique", table: op.tableId };
    case "changeUnique":
      return { id: op.uniqueId, kind: "unique", table: op.tableId };
    case "addForeignKey":
    case "dropForeignKey":
      return { id: op.fk.id, kind: "foreignKey", table: op.tableId };
    case "changeForeignKey":
      return { id: op.fkId, kind: "foreignKey", table: op.tableId };
  }
}

/** `(key, aspect)` identity slot. `null` for PK ops (handled separately). */
function identitySlot(op: Operation): { key: string; aspect: string } | null {
  const s = subject(op);
  switch (op.type) {
    case "createTable":
    case "dropTable":
      return { key: `tbl:${s.id}`, aspect: "presence" };
    case "renameTable":
      return { key: `tbl:${s.id}`, aspect: "name" };
    case "addColumn":
    case "dropColumn":
      return { key: `col:${s.id}`, aspect: "presence" };
    case "renameColumn":
      return { key: `col:${s.id}`, aspect: "name" };
    case "retypeColumn":
      return { key: `col:${s.id}`, aspect: "type" };
    case "setNullable":
      return { key: `col:${s.id}`, aspect: "nullable" };
    case "setDefault":
      return { key: `col:${s.id}`, aspect: "default" };
    case "addIndex":
    case "dropIndex":
      return { key: `idx:${s.id}`, aspect: "presence" };
    case "changeIndex":
      return { key: `idx:${s.id}`, aspect: "definition" };
    case "addUnique":
    case "dropUnique":
      return { key: `uq:${s.id}`, aspect: "presence" };
    case "changeUnique":
      return { key: `uq:${s.id}`, aspect: "definition" };
    case "addForeignKey":
    case "dropForeignKey":
      return { key: `fk:${s.id}`, aspect: "presence" };
    case "changeForeignKey":
      return { key: `fk:${s.id}`, aspect: "definition" };
    default:
      return null;
  }
}

/** `(namespace, name)` name slot, or `null`. */
function nameSlot(op: Operation): string | null {
  switch (op.type) {
    case "createTable":
      return `tname:${op.table.name}`;
    case "renameTable":
      return `tname:${op.to}`;
    case "addColumn":
      return `cname:${op.tableId}:${op.column.name}`;
    case "renameColumn":
      return `cname:${op.tableId}:${op.to}`;
    default:
      return null;
  }
}

/** The value compared for overlap / divergence on an identity slot. */
function payload(op: Operation): unknown {
  switch (op.type) {
    case "renameTable":
    case "renameColumn":
    case "setNullable":
    case "setDefault":
      return op.to;
    case "retypeColumn":
      return op.to;
    case "changeIndex":
    case "changeUnique":
    case "changeForeignKey":
      return op.to;
    case "addColumn":
      return { ...op.column, id: undefined };
    case "addIndex":
      return { ...op.index, id: undefined };
    case "addUnique":
      return { ...op.unique, id: undefined };
    case "addForeignKey":
      return { ...op.fk, id: undefined };
    case "dropColumn":
      return { drop: "column", of: { ...op.column, id: undefined } };
    case "dropTable":
      return { drop: "table", of: op.table.name };
    case "dropIndex":
      return { drop: "index" };
    case "dropUnique":
      return { drop: "unique" };
    case "dropForeignKey":
      return { drop: "fk" };
    case "createTable":
      return { create: op.table.name };
    default:
      return null;
  }
}

/**
 * The ancestor (`base`) value for a conflict, read off an op's `from` payload.
 * Both sides diffed the same `base`, so either side's op gives the same answer.
 * `null` when the op carries no prior value (an `add*` — the object did not exist).
 */
function baseValue(op: Operation): unknown {
  switch (op.type) {
    case "renameTable":
    case "renameColumn":
    case "setNullable":
    case "setDefault":
    case "retypeColumn":
      return op.from;
    case "changeIndex":
    case "changeUnique":
    case "changeForeignKey":
      return op.from;
    case "changePrimaryKey":
      return op.from;
    case "dropColumn":
      return { ...op.column, id: undefined };
    case "dropTable":
      return op.table.name;
    case "dropIndex":
      return { ...op.index, id: undefined };
    case "dropUnique":
      return { ...op.unique, id: undefined };
    case "dropForeignKey":
      return { ...op.fk, id: undefined };
    case "dropPrimaryKey":
      return { ...op.primaryKey, id: undefined };
    default:
      return null;
  }
}

/** Ids this op *references* (for dependency-conflict detection). Owning table included. */
function refs(op: Operation): string[] {
  switch (op.type) {
    case "addIndex":
      return [op.tableId, ...op.index.columnIds];
    case "changeIndex":
      return [op.tableId, ...op.to.columnIds];
    case "addUnique":
      return [op.tableId, ...op.unique.columnIds];
    case "changeUnique":
      return [op.tableId, ...op.to.columnIds];
    case "addForeignKey":
      return [op.tableId, ...op.fk.columnIds, op.fk.refTableId, ...op.fk.refColumnIds];
    case "changeForeignKey":
      return [op.tableId, ...op.to.columnIds, op.to.refTableId, ...op.to.refColumnIds];
    case "addColumn":
    case "renameColumn":
    case "retypeColumn":
    case "setNullable":
    case "setDefault":
      return [op.tableId];
    case "createTable":
      return op.table.foreignKeys.flatMap((fk) => [fk.refTableId, ...fk.refColumnIds]);
    default:
      return [];
  }
}

const isDrop = (op: Operation): boolean => op.type.startsWith("drop");
const isAddOrCreate = (op: Operation): boolean =>
  op.type.startsWith("add") || op.type === "createTable";

function aspectToClass(aspect: string): ConflictClass {
  switch (aspect) {
    case "type":
      return "divergent-retype";
    case "name":
      return "rename-vs-rename";
    case "definition":
      return "divergent-index-definition"; // overridden to catch-all for uq/fk by caller
    default:
      return "divergent-definition";
  }
}

// ── conflict id (stable across re-runs) ───────────────────────────────────

function conflictId(cls: ConflictClass, ids: string[]): string {
  return `${cls}:${[...ids].sort().join("+")}`;
}

// ── primary keys ─────────────────────────────────────────────────────────

interface PkIntent {
  /**
   * The table's PK after this side's edits, or `null` if the side dropped it.
   * Only `id` + `columnIds` are needed here; a `changePrimaryKey` op does not
   * carry the constraint `name`, and PK classification does not use it.
   */
  after: Pick<PrimaryKey, "id" | "columnIds"> | null;
  ops: Operation[];
}

function pkIntentByTable(delta: Operation[]): Map<string, PkIntent> {
  const m = new Map<string, PkIntent>();
  for (const op of delta) {
    if (op.type !== "addPrimaryKey" && op.type !== "dropPrimaryKey" && op.type !== "changePrimaryKey") {
      continue;
    }
    const cur = m.get(op.tableId) ?? { after: null, ops: [] };
    cur.ops.push(op);
    if (op.type === "addPrimaryKey") cur.after = op.primaryKey;
    else if (op.type === "dropPrimaryKey") cur.after = null;
    else cur.after = { id: op.primaryKeyId, columnIds: op.to };
    m.set(op.tableId, cur);
  }
  return m;
}

function classifyPrimaryKeys(
  ours: Operation[],
  theirs: Operation[],
  conflicts: Conflict[],
  overlaps: OverlapNote[],
  mergeDeltaKeep: Set<Operation>,
): void {
  const o = pkIntentByTable(ours);
  const t = pkIntentByTable(theirs);
  for (const [tableId, oi] of o) {
    const ti = t.get(tableId);
    if (!ti) {
      for (const op of oi.ops) mergeDeltaKeep.add(op); // one side only
      continue;
    }
    // both sides touched this table's PK
    const sameCols =
      (oi.after === null) === (ti.after === null) &&
      (oi.after === null || eq(oi.after.columnIds, ti.after!.columnIds));
    if (sameCols) {
      overlaps.push({ slot: `tbl:${tableId}:primaryKey`, kind: "primaryKey", objectId: tableId });
      // theirs already carries it; keep none of ours' PK ops
    } else {
      conflicts.push({
        id: conflictId("divergent-definition", [tableId, "pk"]),
        class: "divergent-definition",
        severity: "clear",
        object: { kind: "primaryKey", id: `${tableId}:pk`, table: tableId },
        base: null,
        ours: oi.after,
        theirs: ti.after,
        resolutionModes: ["ours", "theirs"],
      });
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────

export function classify(
  deltaOurs: Operation[],
  deltaTheirs: Operation[],
  resolutions: Resolution[] = [],
): ClassifyResult {
  const conflicts: Conflict[] = [];
  const overlaps: OverlapNote[] = [];
  const remaps: IdRemap[] = [];
  const rebased: RebasedChange[] = [];

  const nonPk = (d: Operation[]) =>
    d.filter(
      (op) =>
        op.type !== "addPrimaryKey" &&
        op.type !== "dropPrimaryKey" &&
        op.type !== "changePrimaryKey",
    );
  const oursNP = nonPk(deltaOurs);
  const theirsNP = nonPk(deltaTheirs);

  /** Ours ops kept for `mergeDelta` (start with all, remove as we go). */
  const keep = new Set<Operation>(oursNP);
  /** Subject ids carrying a conflict — pass 2 and mergeDelta both consult this. */
  const conflictedIds = new Set<string>();

  // primary keys first. Use the conflict's own `object.id` (a `${tableId}:pk`
  // token for a PK conflict), never `object.table` — adding the bare table id
  // here would make the final keep-filter drop an unrelated `renameTable`.
  classifyPrimaryKeys(deltaOurs, deltaTheirs, conflicts, overlaps, keep);
  for (const c of conflicts) conflictedIds.add(c.object.id);

  // ── pass 1a: identity slots ──────────────────────────────────────────────
  const idIndex = new Map<string, { ours?: Operation; theirs?: Operation; aspect: string }>();
  for (const op of oursNP) {
    const s = identitySlot(op);
    if (!s) continue;
    const k = `${s.key}:${s.aspect}`;
    idIndex.set(k, { ...(idIndex.get(k) ?? { aspect: s.aspect }), ours: op });
  }
  for (const op of theirsNP) {
    const s = identitySlot(op);
    if (!s) continue;
    const k = `${s.key}:${s.aspect}`;
    idIndex.set(k, { ...(idIndex.get(k) ?? { aspect: s.aspect }), theirs: op });
  }

  for (const [, entry] of idIndex) {
    if (!entry.ours || !entry.theirs) continue;
    const sub = subject(entry.ours);
    if (eq(payload(entry.ours), payload(entry.theirs))) {
      overlaps.push({ slot: entry.aspect, kind: sub.kind, objectId: sub.id });
      keep.delete(entry.ours); // already in theirs
      continue;
    }
    let cls = aspectToClass(entry.aspect);
    if (entry.aspect === "definition" && sub.kind !== "index") cls = "divergent-definition";
    conflicts.push({
      id: conflictId(cls, [sub.id]),
      class: cls,
      severity: SEVERITY[cls],
      object: { kind: sub.kind, id: sub.id, table: sub.table ?? undefined },
      base: baseValue(entry.ours),
      ours: payload(entry.ours),
      theirs: payload(entry.theirs),
      resolutionModes: cls === "divergent-retype" ? ["ours", "theirs", "type"] : ["ours", "theirs"],
    });
    conflictedIds.add(sub.id);
  }

  // ── pass 1b: name slots ────────────────────────────────────────────────
  const nameIndex = new Map<string, { ours?: Operation; theirs?: Operation }>();
  for (const op of oursNP) {
    const n = nameSlot(op);
    if (n) nameIndex.set(n, { ...(nameIndex.get(n) ?? {}), ours: op });
  }
  for (const op of theirsNP) {
    const n = nameSlot(op);
    if (n) nameIndex.set(n, { ...(nameIndex.get(n) ?? {}), theirs: op });
  }

  for (const [, entry] of nameIndex) {
    if (!entry.ours || !entry.theirs) continue;
    const so = subject(entry.ours);
    const st = subject(entry.theirs);
    if (so.id === st.id) continue; // same object, same target name — handled on identity slot
    if (conflictedIds.has(so.id) || conflictedIds.has(st.id)) continue;

    const bothAdd = isAddOrCreate(entry.ours) && isAddOrCreate(entry.theirs);
    if (bothAdd && so.kind === "column" && st.kind === "column") {
      const co = (entry.ours as Extract<Operation, { type: "addColumn" }>).column;
      const ct = (entry.theirs as Extract<Operation, { type: "addColumn" }>).column;
      if (eq({ ...co, id: undefined }, { ...ct, id: undefined })) {
        // degenerate overlap: keep theirs' column, drop ours', remap ours' id -> theirs'
        keep.delete(entry.ours);
        remaps.push({ kind: "column", from: co.id, to: ct.id });
        for (const op of oursNP) remapRefs(op, co.id, ct.id);
        continue;
      }
    }
    const cls: ConflictClass = bothAdd ? "add-vs-add" : "rename-vs-rename";
    conflicts.push({
      id: conflictId(cls, [so.id, st.id]),
      class: cls,
      severity: "clear",
      object: { kind: so.kind, id: so.id, table: so.table ?? undefined },
      base: baseValue(entry.ours), // null for two adds; the vacated name for a rename
      ours: payload(entry.ours),
      theirs: payload(entry.theirs),
      resolutionModes: ["ours", "theirs"],
    });
    conflictedIds.add(so.id);
    conflictedIds.add(st.id);
  }

  // ── pass 2: cross-reference ──────────────────────────────────────────────
  const droppedByTheirs = droppedIdSet(theirsNP);
  const renamedByTheirs = renameMap(theirsNP);
  const renamedByOurs = renameMap(oursNP);

  // class 5: drop-vs-modify
  for (const [side, mine, other] of [
    ["ours", oursNP, theirsNP],
    ["theirs", theirsNP, oursNP],
  ] as [Side, Operation[], Operation[]][]) {
    for (const d of mine.filter(isDrop)) {
      const ds = subject(d);
      if (conflictedIds.has(ds.id)) continue;
      const hit = other.find((op) => {
        const os = subject(op);
        if (isDrop(op) && os.id === ds.id) return false; // both drop → overlap, not this
        return os.id === ds.id || (ds.kind === "table" && os.table === ds.id);
      });
      if (!hit) continue;
      conflicts.push({
        id: conflictId("drop-vs-modify", [ds.id]),
        class: "drop-vs-modify",
        severity: "clear",
        object: { kind: ds.kind, id: ds.id, table: ds.table ?? undefined },
        base: baseValue(d),
        ours: side === "ours" ? payload(d) : payload(hit),
        theirs: side === "ours" ? payload(hit) : payload(d),
        resolutionModes: ["ours", "theirs"],
      });
      conflictedIds.add(ds.id);
      if (ds.kind === "table") {
        for (const op of oursNP) if (subject(op).table === ds.id) conflictedIds.add(subject(op).id);
      }
    }
  }

  // class 6a: a surviving ours op *references* an id theirs dropped
  for (const op of [...keep]) {
    const rs = refs(op);
    const brokenRef = rs.find((r) => droppedByTheirs.has(r));
    if (brokenRef) {
      const sub = subject(op);
      if (!conflictedIds.has(sub.id)) {
        conflicts.push({
          id: conflictId("dependency-conflict", [sub.id, brokenRef]),
          class: "dependency-conflict",
          severity: "subtle",
          object: { kind: sub.kind, id: sub.id, table: sub.table ?? undefined },
          base: null,
          ours: payload(op),
          theirs: { dropped: brokenRef },
          resolutionModes: ["theirs"], // take-ours revert path is a V1 cut
        });
        conflictedIds.add(sub.id);
      }
      keep.delete(op);
      continue;
    }
    // a referenced id theirs merely renamed still resolves — record the rebase
    for (const r of rs) {
      const rn = renamedByTheirs.get(r);
      if (rn) {
        rebased.push({ op, followedRename: { objectId: r, kind: rn.kind, from: rn.from, to: rn.to } });
      }
    }
  }

  // class 6b: an ours *drop* removes an id a surviving theirs op depends on. The
  // theirs op is already in `theirs` and cannot be pulled, so the conflict is
  // that ours' drop cannot land. Held until resolved. Symmetric to 6a — without
  // this, `applyDelta` leaves a dangling reference and the oracle (both orders
  // agree on the same invalid document) does not catch it.
  for (const d of oursNP.filter(isDrop)) {
    const ds = subject(d);
    if (conflictedIds.has(ds.id)) continue;
    const dependent = theirsNP.find((op) => !isDrop(op) && refs(op).includes(ds.id));
    if (!dependent) continue;
    conflicts.push({
      id: conflictId("dependency-conflict", [ds.id, subject(dependent).id]),
      class: "dependency-conflict",
      severity: "subtle",
      object: { kind: ds.kind, id: ds.id, table: ds.table ?? undefined },
      base: baseValue(d),
      ours: payload(d),
      theirs: payload(dependent),
      resolutionModes: ["theirs"], // spike: keep theirs' dependent, abandon ours' drop
    });
    conflictedIds.add(ds.id);
    keep.delete(d);
  }

  // drop every remaining ours op that touches a conflicted object
  for (const op of [...keep]) {
    if (conflictedIds.has(subject(op).id)) keep.delete(op);
  }

  // the symmetric rebase: a theirs op (already in `theirs`) that references an id
  // ours renamed still resolves by id — record it for the success wash
  for (const op of theirsNP) {
    for (const r of refs(op)) {
      const rn = renamedByOurs.get(r);
      if (rn && !droppedByTheirs.has(r)) {
        rebased.push({ op, followedRename: { objectId: r, kind: rn.kind, from: rn.from, to: rn.to } });
      }
    }
  }

  // ── resolutions ────────────────────────────────────────────────────────
  const byId = new Map(resolutions.map((r) => [r.conflictId, r]));
  let unresolvedCount = 0;
  const resolutionOps: Operation[] = [];
  /** Subject ids whose `theirs` op must be pruned from Δ_theirs' (it lost the resolution). */
  const theirsLosers = new Set<string>();

  /** Two-object conflicts (add-vs-add, name-collision rename) — spike holds these. */
  const isTwoObject = (c: Conflict) => c.id.includes("+");

  for (const c of conflicts) {
    const r = byId.get(c.id);
    if (!r || !c.resolutionModes.includes(r.choice)) {
      unresolvedCount++; // no resolution, or a `choice` this class does not accept
      continue;
    }
    if (c.object.kind === "primaryKey" || c.class === "add-vs-add" || isTwoObject(c)) {
      unresolvedCount++; // spike: PK-divergence and name-slot disposal are V1 cuts
      continue;
    }
    applyResolution(c, r, deltaOurs, deltaTheirs, resolutionOps);
    // whenever ours (or an explicit type) won, the matching theirs op loses and
    // must not re-appear in one application order of the commutativity oracle
    if (r.choice === "ours" || r.choice === "type") theirsLosers.add(c.object.id);
  }

  const isPkOp = (op: Operation) =>
    op.type === "addPrimaryKey" || op.type === "dropPrimaryKey" || op.type === "changePrimaryKey";
  const kept = [...oursNP.filter((op) => keep.has(op)), ...deltaOurs.filter((op) => isPkOp(op) && keep.has(op))];

  const mergeDelta = unresolvedCount === 0 ? [...kept, ...resolutionOps] : [];
  const theirsDelta =
    unresolvedCount === 0
      ? deltaTheirs.filter((op) => !theirsLosers.has(subject(op).id))
      : deltaTheirs;

  return { conflicts, unresolvedCount, mergeDelta, theirsDelta, rebased, overlaps, remaps };
}

// ── helpers ──────────────────────────────────────────────────────────────

function droppedIdSet(delta: Operation[]): Set<string> {
  const s = new Set<string>();
  for (const op of delta) {
    if (op.type === "dropTable") {
      s.add(op.table.id);
      for (const c of op.table.columns) s.add(c.id);
      for (const i of op.table.indexes) s.add(i.id);
      for (const u of op.table.uniques) s.add(u.id);
      for (const f of op.table.foreignKeys) s.add(f.id);
      if (op.table.primaryKey) s.add(op.table.primaryKey.id);
    } else if (op.type === "dropColumn") s.add(op.column.id);
    else if (op.type === "dropIndex") s.add(op.index.id);
    else if (op.type === "dropUnique") s.add(op.unique.id);
    else if (op.type === "dropForeignKey") s.add(op.fk.id);
    else if (op.type === "dropPrimaryKey") s.add(op.primaryKey.id);
  }
  return s;
}

function renameMap(delta: Operation[]): Map<string, { from: string; to: string; kind: ObjectKind }> {
  const m = new Map<string, { from: string; to: string; kind: ObjectKind }>();
  for (const op of delta) {
    if (op.type === "renameColumn") m.set(op.columnId, { from: op.from, to: op.to, kind: "column" });
    else if (op.type === "renameTable") m.set(op.tableId, { from: op.from, to: op.to, kind: "table" });
  }
  return m;
}

/**
 * Rewrite `from` -> `to` in an op's id-bearing fields, for the degenerate-overlap
 * remap. Covers member-column lists AND the `columnId` of a later attribute op on
 * the remapped column. `diffSnapshots` does not currently emit `addColumn` plus a
 * later attr op for one new column (a new column's attributes are all in the
 * `addColumn` payload), so the `columnId` arm is defensive today — but the remap
 * should not silently depend on that coupling.
 */
function remapRefs(op: Operation, from: string, to: string): void {
  const swap = (arr: string[]) => {
    for (let i = 0; i < arr.length; i++) if (arr[i] === from) arr[i] = to;
  };
  switch (op.type) {
    case "renameColumn":
    case "retypeColumn":
    case "setNullable":
    case "setDefault":
      if (op.columnId === from) op.columnId = to;
      break;
    case "addIndex":
      swap(op.index.columnIds);
      break;
    case "changeIndex":
      swap(op.to.columnIds);
      break;
    case "addUnique":
      swap(op.unique.columnIds);
      break;
    case "changeUnique":
      swap(op.to.columnIds);
      break;
    case "addForeignKey":
      swap(op.fk.columnIds);
      swap(op.fk.refColumnIds);
      break;
    case "changeForeignKey":
      swap(op.to.columnIds);
      swap(op.to.refColumnIds);
      break;
    case "changePrimaryKey":
      swap(op.to);
      break;
    default:
      break;
  }
}

/**
 * Turn a resolved conflict into compensating ops appended to `Δ_merge`. Works
 * with the symmetric pruning of `Δ_theirs'` (`theirsLosers`): when `ours` wins,
 * the caller has already removed the losing `theirs` op, so this only has to add
 * `ours`' intent — no "revert theirs" op is needed.
 *
 * Spike scope: complete for classes 1, 3 (identity-slot), 4, 5, 6, 7 (non-PK).
 * Class 2 and the name-collision form of class 3 are held as unresolved by the
 * caller (name-slot disposal across two distinct objects is a V1 cut).
 */
function applyResolution(
  c: Conflict,
  r: Resolution,
  deltaOurs: Operation[],
  deltaTheirs: Operation[],
  out: Operation[],
): void {
  const oursOp = deltaOurs.find((op) => subject(op).id === c.object.id);
  const theirsOp = deltaTheirs.find((op) => subject(op).id === c.object.id);

  switch (c.class) {
    case "divergent-retype": {
      if (r.choice === "theirs") return; // theirs' retype stays in Δ_theirs'
      const to: ColumnType =
        r.choice === "type" ? r.type : (oursOp as Extract<Operation, { type: "retypeColumn" }>).to;
      const from = (theirsOp as Extract<Operation, { type: "retypeColumn" }>).from;
      out.push({ type: "retypeColumn", tableId: c.object.table!, columnId: c.object.id, from, to });
      return;
    }
    case "rename-vs-rename": {
      if (r.choice === "theirs") return;
      if (oursOp && oursOp.type === "renameColumn") out.push(oursOp); // identity-slot form
      return;
    }
    case "divergent-index-definition":
    case "divergent-definition": {
      if (r.choice === "theirs") return;
      if (oursOp && (oursOp.type === "changeIndex" || oursOp.type === "changeUnique" || oursOp.type === "changeForeignKey")) {
        out.push(oursOp);
      }
      return;
    }
    case "drop-vs-modify": {
      // theirs' op for this object is pruned from Δ_theirs' when choice === "ours";
      // just carry ours' ops for the object.
      if (r.choice === "ours") {
        for (const op of deltaOurs.filter((op) => subject(op).id === c.object.id)) out.push(op);
      }
      return;
    }
    case "dependency-conflict":
      return; // choice: "theirs" — ours' broken op is simply omitted
    case "add-vs-add":
      return; // held as unresolved by the caller
  }
}
