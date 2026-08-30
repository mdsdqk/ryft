/** Small pure renderers shared by the fixture and the components. */

import type { ColumnType } from "@engine/schema.js";
import type { ChangeKind, ConflictClass, RevisionStatus } from "./model.ts";

/** A `ColumnType` as its canonical Postgres spelling. */
export function sqlType(t: ColumnType): string {
  switch (t.kind) {
    case "varchar":
      return `varchar(${t.n})`;
    case "numeric":
      return `numeric(${t.precision}, ${t.scale})`;
    default:
      return t.kind;
  }
}

export function retypeDetail(from: ColumnType, to: ColumnType): string {
  return `${sqlType(from)} → ${sqlType(to)}`;
}

const CHANGE_LABEL: Record<ChangeKind, string> = {
  rename: "rename",
  retype: "retype",
  "add-column": "add",
  "drop-column": "drop",
  "set-nullable": "nullability",
  "set-default": "default",
  "add-index": "add index",
  "change-index": "modify index",
  "drop-index": "drop index",
  "add-unique": "add unique",
  "change-unique": "modify unique",
  "drop-unique": "drop unique",
  "add-fk": "add fk",
  "change-fk": "modify fk",
  "drop-fk": "drop fk",
  "add-pk": "add pk",
  "change-pk": "modify pk",
  "drop-pk": "drop pk",
  "create-table": "create table",
  "rename-table": "rename table",
  "drop-table": "drop table",
};

export function changeLabel(kind: ChangeKind): string {
  return CHANGE_LABEL[kind];
}

const CONFLICT_LABEL: Record<ConflictClass, string> = {
  "divergent-retype": "divergent retype",
  "add-vs-add": "add vs add",
  "rename-vs-rename": "rename vs rename",
  "divergent-index": "divergent index definition",
  "drop-vs-modify": "drop vs modify",
  dependency: "dependency conflict",
};

export function conflictLabel(cls: ConflictClass): string {
  return CONFLICT_LABEL[cls];
}

export const STATUS_SEQUENCE: readonly RevisionStatus[] = [
  "received",
  "in-check",
  "cleared",
  "released",
];

const STATUS_LABEL: Record<RevisionStatus, string> = {
  received: "Received",
  "in-check": "In check",
  cleared: "Cleared",
  released: "Released",
};

export function statusLabel(s: RevisionStatus): string {
  return STATUS_LABEL[s];
}

/** "09:14" from an ISO string, local time, display only. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
