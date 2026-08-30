import { PlannedSheet } from "./PlannedSheet.tsx";

export function Branches() {
  return (
    <PlannedSheet title="Branches">
      Every branch on the database, with create-from-<code>main</code> and delete.
      Planned in <code>docs/design/shape-brief-app-flow.md</code> §4 and sequenced
      as V0 step 4 — this slice builds the shell and routing only. The dashboard
      lists the current branches in the meantime.
    </PlannedSheet>
  );
}
