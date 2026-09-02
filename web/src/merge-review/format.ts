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
  "divergent-definition": "divergent definition",
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

/**
 * Display labels for the merge-request lifecycle (usability review 1i). The
 * internal `RevisionStatus` keys are unchanged — only what the screen shows.
 *   received  → the request is in the queue, behind others
 *   in-check  → at the front, being reviewed / resolved
 *   cleared   → reviewed, nothing outstanding, ready to merge
 *   released  → merged into the target
 *   closed    → withdrawn without merging (ADR 0012 §3) — deliberately absent
 *               from `STATUS_SEQUENCE`: it is a way off the line, not a step
 *               along it, so the dial marks it rather than advancing to it.
 */
const STATUS_LABEL: Record<RevisionStatus, string> = {
  received: "Queued",
  "in-check": "Under review",
  cleared: "Reviewed",
  released: "Merged",
  closed: "Closed",
};

export function statusLabel(s: RevisionStatus): string {
  return STATUS_LABEL[s];
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** A wall-clock time from an ISO string, in the viewer's locale. Display only. */
export function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : TIME_FMT.format(d);
}

/** A short date from an ISO string, in the viewer's locale. Display only. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : DATE_FMT.format(d);
}
