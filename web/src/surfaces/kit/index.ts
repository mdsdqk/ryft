/**
 * Surface kit — shared building blocks for the list and detail surfaces.
 * A surface composes these; it does not re-derive rows, sheets, or notices.
 * See docs/design/app-flow-work-breakdown.md (WU-0).
 */

import "./kit.css";

export { SurfaceSheet, SurfaceBody } from "./SurfaceSheet.tsx";
export { Zone } from "./Zone.tsx";
export { SheetList, Row, MoreRow } from "./SheetList.tsx";
export { FactList, type Fact } from "./FactList.tsx";
export { StatusPill, type StatusTone } from "./StatusPill.tsx";
export { Tri } from "./Tri.tsx";
export { EmptyState, Loading, type EmptyLayout } from "./EmptyState.tsx";
export {
  ComparisonGrid,
  type GridColHead,
  type GridCell,
  type GridRow,
  type GridGroup,
  type GridSection,
  type GridFilter,
} from "./ComparisonGrid.tsx";
