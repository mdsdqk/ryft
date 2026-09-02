/**
 * Project `diffSnapshots(base, head)` into the shared `ComparisonGrid`'s section
 * model for the Divergence sub-sheet (grill Q4/Q10): grouped by table (outer),
 * then by object kind. Two-way — `on main` (the base state) against `on this
 * branch`. No `△N`: a derived delta has no log identity, so rows carry the
 * change-kind label and the strikethrough only.
 */

import type { ReactNode } from "react";

import type {
  Column,
  ForeignKey,
  Index,
  PrimaryKey,
  SchemaDocument,
  Table,
  Unique,
} from "@engine/schema.js";
import type { IndexDef } from "@engine/operations.js";
import { diffSnapshots } from "@engine/diff.js";

import type { GridCell, GridRow, GridSection } from "../kit/index.ts";
import { deltaWarnings, warningKindLabel } from "./deltaWarnings.ts";
import {
  columnSpec,
  foreignKeySpec,
  indexSpec,
  primaryKeySpec,
  sqlType,
  uniqueSpec,
  type NameOf,
} from "./format.ts";

type GroupKey = "columns" | "indexes" | "constraints";
const GROUP_ORDER: GroupKey[] = ["columns", "indexes", "constraints"];
const GROUP_TITLE: Record<GroupKey, string> = {
  columns: "Columns",
  indexes: "Indexes",
  constraints: "Constraints",
};

function nameResolver(doc: SchemaDocument): NameOf {
  const names = new Map<string, string>();
  for (const t of doc.tables) {
    names.set(t.id, t.name);
    for (const c of t.columns) names.set(c.id, c.name);
  }
  return (id) => names.get(id) ?? id;
}

function indexDefSpec(def: IndexDef, nameOf: NameOf): string {
  return `${def.unique ? "unique " : ""}(${def.columnIds.map(nameOf).join(", ")})`;
}

/** `old` struck through, then the new value emphasised — DESIGN.md's rename form. */
const renamed = (from: string, to: string): ReactNode => (
  <>
    <s>{from}</s> → <b>{to}</b>
  </>
);
const changed = (from: string, to: string): ReactNode => (
  <>
    {from} → <b>{to}</b>
  </>
);

/** the branch-side label chip + detail, in the `--ours` role */
const ours = (label: string, detail: ReactNode): GridCell => ({
  label,
  labelTone: "ours",
  detail,
});
/** a plain base-state cell (no chip) */
const was = (detail: ReactNode): GridCell => ({ detail });

type Bucket = { name: string; groups: Map<GroupKey, GridRow[]> };

export function toDivergenceSections(
  base: SchemaDocument,
  head: SchemaDocument,
): { sections: GridSection[]; changeCount: number; destructiveCount: number } {
  const ops = diffSnapshots(base, head);
  const warnings = deltaWarnings(base, ops);
  const nameHead = nameResolver(head);
  const nameBase = nameResolver(base);

  const baseTable = (id: string): Table | undefined => base.tables.find((t) => t.id === id);
  const baseCol = (tid: string, cid: string): Column | undefined =>
    baseTable(tid)?.columns.find((c) => c.id === cid);
  const baseIndex = (tid: string, iid: string): Index | undefined =>
    baseTable(tid)?.indexes.find((i) => i.id === iid);
  const baseUnique = (tid: string, uid: string): Unique | undefined =>
    baseTable(tid)?.uniques.find((u) => u.id === uid);
  const basePk = (tid: string): PrimaryKey | null => baseTable(tid)?.primaryKey ?? null;
  const baseFk = (tid: string, fid: string): ForeignKey | undefined =>
    baseTable(tid)?.foreignKeys.find((f) => f.id === fid);

  const order: string[] = [
    ...head.tables.map((t) => t.id),
    ...base.tables.filter((t) => !head.tables.some((h) => h.id === t.id)).map((t) => t.id),
  ];
  const buckets = new Map<string, Bucket>();
  const push = (tableId: string, tableName: string, group: GroupKey, row: GridRow) => {
    let b = buckets.get(tableId);
    if (!b) {
      b = { name: tableName, groups: new Map() };
      buckets.set(tableId, b);
    }
    const rows = b.groups.get(group) ?? [];
    rows.push(row);
    b.groups.set(group, rows);
  };

  for (const op of ops) {
    switch (op.type) {
      case "createTable":
        push(op.table.id, op.table.name, "columns", {
          key: op.table.id,
          objectLabel: op.table.name,
          objectId: op.table.id,
          left: null,
          right: ours("create table", `${op.table.columns.length} column(s)`),
        });
        break;
      case "dropTable":
        push(op.table.id, op.table.name, "columns", {
          key: op.table.id,
          objectLabel: op.table.name,
          objectId: op.table.id,
          left: was(`${op.table.columns.length} column(s)`),
          right: ours("drop table", "removed"),
        });
        break;
      case "renameTable":
        push(op.tableId, op.to, "columns", {
          key: op.tableId,
          objectLabel: op.to,
          objectId: op.tableId,
          left: was(op.from),
          right: ours("rename table", renamed(op.from, op.to)),
        });
        break;
      case "addColumn":
        push(op.tableId, nameHead(op.tableId), "columns", {
          key: op.column.id,
          objectLabel: `${nameHead(op.tableId)}.${op.column.name}`,
          objectId: op.column.id,
          left: null,
          right: ours("add", columnSpec(op.column)),
        });
        break;
      case "dropColumn":
        push(op.tableId, nameHead(op.tableId), "columns", {
          key: op.column.id,
          objectLabel: `${nameHead(op.tableId)}.${op.column.name}`,
          objectId: op.column.id,
          left: was(columnSpec(op.column)),
          right: ours("drop", "removed"),
        });
        break;
      case "renameColumn": {
        const b = baseCol(op.tableId, op.columnId);
        push(op.tableId, nameHead(op.tableId), "columns", {
          key: op.columnId,
          objectLabel: `${nameHead(op.tableId)}.${op.to}`,
          objectId: op.columnId,
          left: was(b ? columnSpec(b) : op.from),
          right: ours("rename", renamed(op.from, op.to)),
        });
        break;
      }
      case "retypeColumn":
        push(op.tableId, nameHead(op.tableId), "columns", {
          key: op.columnId,
          objectLabel: `${nameHead(op.tableId)}.${nameHead(op.columnId)}`,
          objectId: op.columnId,
          left: was(sqlType(op.from)),
          right: ours("retype", changed(sqlType(op.from), sqlType(op.to))),
        });
        break;
      case "setNullable":
        push(op.tableId, nameHead(op.tableId), "columns", {
          key: op.columnId,
          objectLabel: `${nameHead(op.tableId)}.${nameHead(op.columnId)}`,
          objectId: op.columnId,
          left: was(op.from ? "null" : "not null"),
          right: ours("nullability", changed(op.from ? "null" : "not null", op.to ? "null" : "not null")),
        });
        break;
      case "setDefault":
        push(op.tableId, nameHead(op.tableId), "columns", {
          key: op.columnId,
          objectLabel: `${nameHead(op.tableId)}.${nameHead(op.columnId)}`,
          objectId: op.columnId,
          left: was(op.from ?? "no default"),
          right: ours("default", changed(op.from ?? "none", op.to ?? "none")),
        });
        break;
      case "addIndex":
        push(op.tableId, nameHead(op.tableId), "indexes", {
          key: op.index.id,
          objectLabel: op.index.name,
          objectId: op.index.id,
          left: null,
          right: ours("add index", indexSpec(op.index, nameHead)),
        });
        break;
      case "dropIndex": {
        const b = baseIndex(op.tableId, op.index.id);
        push(op.tableId, nameHead(op.tableId), "indexes", {
          key: op.index.id,
          objectLabel: op.index.name,
          objectId: op.index.id,
          left: was(indexSpec(b ?? op.index, nameBase)),
          right: ours("drop index", "removed"),
        });
        break;
      }
      case "changeIndex":
        push(op.tableId, nameHead(op.tableId), "indexes", {
          key: op.indexId,
          objectLabel: op.to.name,
          objectId: op.indexId,
          left: was(indexDefSpec(op.from, nameBase)),
          right: ours("modify index", indexDefSpec(op.to, nameHead)),
        });
        break;
      case "addUnique":
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.unique.id,
          objectLabel: op.unique.name,
          objectId: op.unique.id,
          left: null,
          right: ours("add unique", uniqueSpec(op.unique, nameHead)),
        });
        break;
      case "dropUnique": {
        const b = baseUnique(op.tableId, op.unique.id);
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.unique.id,
          objectLabel: op.unique.name,
          objectId: op.unique.id,
          left: was(uniqueSpec(b ?? op.unique, nameBase)),
          right: ours("drop unique", "removed"),
        });
        break;
      }
      case "changeUnique":
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.uniqueId,
          objectLabel: op.to.name,
          objectId: op.uniqueId,
          left: was(`(${op.from.columnIds.map(nameBase).join(", ")})`),
          right: ours("modify unique", `(${op.to.columnIds.map(nameHead).join(", ")})`),
        });
        break;
      case "addPrimaryKey":
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.primaryKey.id,
          objectLabel: op.primaryKey.name,
          objectId: op.primaryKey.id,
          left: null,
          right: ours("add pk", primaryKeySpec(op.primaryKey, nameHead)),
        });
        break;
      case "dropPrimaryKey": {
        const b = basePk(op.tableId);
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.primaryKey.id,
          objectLabel: op.primaryKey.name,
          objectId: op.primaryKey.id,
          left: was(b ? primaryKeySpec(b, nameBase) : "primary key"),
          right: ours("drop pk", "removed"),
        });
        break;
      }
      case "changePrimaryKey":
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.primaryKeyId,
          objectLabel: nameHead(op.tableId),
          objectId: op.primaryKeyId,
          left: was(`(${op.from.map(nameBase).join(", ")})`),
          right: ours("modify pk", `(${op.to.map(nameHead).join(", ")})`),
        });
        break;
      case "addForeignKey":
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.fk.id,
          objectLabel: op.fk.name,
          objectId: op.fk.id,
          left: null,
          right: ours("add fk", foreignKeySpec(op.fk, nameHead)),
        });
        break;
      case "dropForeignKey": {
        const b = baseFk(op.tableId, op.fk.id);
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.fk.id,
          objectLabel: op.fk.name,
          objectId: op.fk.id,
          left: was(b ? foreignKeySpec(b, nameBase) : "foreign key"),
          right: ours("drop fk", "removed"),
        });
        break;
      }
      case "changeForeignKey":
        push(op.tableId, nameHead(op.tableId), "constraints", {
          key: op.fkId,
          objectLabel: op.to.name,
          objectId: op.fkId,
          left: was(`→ ${nameBase(op.from.refTableId)} on delete ${op.from.onDelete}`),
          right: ours("modify fk", `→ ${nameHead(op.to.refTableId)} on delete ${op.to.onDelete}`),
        });
        break;
    }
  }

  // Attach the derived destructive / risk warnings to their row. `row.key` is
  // the changed object's stable id on every branch above — the same id
  // `deltaWarnings` keys on (ADR 0008 §6).
  let destructiveCount = 0;
  for (const b of buckets.values()) {
    for (const rows of b.groups.values()) {
      for (const row of rows) {
        const ws = warnings.get(String(row.key));
        if (!ws?.length) continue;
        row.warnings = ws.map((w) => (
          <>
            <b>{warningKindLabel(w.reason)}</b> — {w.message}
          </>
        ));
        if (ws.some((w) => w.reason === "drop-destructive")) destructiveCount += 1;
      }
    }
  }

  const sections: GridSection[] = [];
  let changeCount = 0;
  for (const tableId of order) {
    const b = buckets.get(tableId);
    if (!b) continue;
    const groups = GROUP_ORDER.filter((g) => (b.groups.get(g)?.length ?? 0) > 0).map((g) => {
      const rows = b.groups.get(g)!;
      changeCount += rows.length;
      return { key: g, title: `${GROUP_TITLE[g]} — ${rows.length}`, rows };
    });
    if (groups.length) sections.push({ key: tableId, title: b.name, groups });
  }
  return { sections, changeCount, destructiveCount };
}
