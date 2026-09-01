/**
 * The branch's operation log, on the Schema sub-sheet — a compact vertical
 * timeline, ascending `seq`, one square node per entry in the `--ours` role.
 * This is the V0 "your edit landed" surface (grill Q7); it grows into the
 * persistent side panel in V1. Read-only here; the author `<select>` filter and
 * live append arrive with the editor (E2).
 */

import type { BranchOperationEntry } from "../../data/index.ts";
import { summarizeOp, type NameOf } from "./format.ts";

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : TIME.format(d);
}

export function OperationList({
  entries,
  nameOf,
}: {
  entries: BranchOperationEntry[];
  nameOf: NameOf;
}) {
  return (
    <section className="bw-ops" aria-labelledby="bw-ops-h">
      <h2 className="bw-ops__k" id="bw-ops-h">
        Operations
        <span className="bw-ops__ct">{entries.length}</span>
      </h2>
      {entries.length === 0 ? (
        <p className="bw-ops__empty">No edits on this branch yet.</p>
      ) : (
        <ol className="bw-ops__list">
          {entries.map((e) => (
            <li key={e.seq} className="bw-ops__entry">
              <span className="bw-ops__node" aria-hidden="true" />
              <span className="bw-ops__meta">
                <span className="bw-ops__tag">△{e.seq}</span>
                <span className="bw-ops__who">
                  {e.author} · {clock(e.at)}
                </span>
              </span>
              <span className="bw-ops__desc">{summarizeOp(e.op, nameOf)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
