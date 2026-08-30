import { useParams } from "react-router";

import { PlannedSheet } from "./PlannedSheet.tsx";

export function BranchWorkspace() {
  const { name } = useParams();
  return (
    <PlannedSheet title={name ?? ""}>
      The branch workspace — schema table cards, the in-card structured editor
      that records every edit as an operation, and a two-way divergence view
      against <code>main</code>. This is the largest V0 surface (step 5 in{" "}
      <code>docs/design/shape-brief-app-flow.md</code> §5) and is not part of the
      shell slice.
    </PlannedSheet>
  );
}
