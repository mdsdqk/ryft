import { PlannedSheet } from "./PlannedSheet.tsx";

export function Merges() {
  return (
    <PlannedSheet title="Merges">
      Every open merge request on the database. Planned in{" "}
      <code>docs/design/shape-brief-app-flow.md</code> §4 and sequenced as V0
      step 6. Open a review from the dashboard&rsquo;s <b>Open merges</b> list —
      the merge-review surface itself is built.
    </PlannedSheet>
  );
}
