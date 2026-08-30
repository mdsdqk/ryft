/**
 * The database overview — the surface you land on after signing in, since there
 * is no database to choose (docs/design/shape-brief-app-flow.md §4): an overview
 * fact block, the open merges, and a preview of the branches. Reads the seam;
 * create / delete and the empty-state variants are later steps (WU-D).
 */

import {
  mergeStatusLabel,
  mergeStatusTone,
  source,
  useResource,
} from "../data/index.ts";
import {
  EmptyState,
  FactList,
  Loading,
  MoreRow,
  Row,
  SheetList,
  StatusPill,
  SurfaceBody,
  SurfaceSheet,
  Tri,
  Zone,
} from "./kit/index.ts";

/** the dashboard summarises; the full list lives on /branches */
const BRANCH_PREVIEW = 6;

export function Dashboard() {
  const { data, loading, error, reload } = useResource(() =>
    source.getOverview(),
  );

  if (loading) {
    return (
      <SurfaceSheet title="Database">
        <Loading label="Loading the database…" />
      </SurfaceSheet>
    );
  }
  if (error || !data) {
    return (
      <SurfaceSheet title="Database">
        <EmptyState
          tone="error"
          title="Could not load the database"
          action={
            <button className="mr-btn mr-btn--primary" onClick={reload}>
              Try again
            </button>
          }
        >
          {error?.message ?? "The overview request returned nothing."}
        </EmptyState>
      </SurfaceSheet>
    );
  }

  const { database: db, branches, merges } = data;
  const branchPreview = branches.slice(0, BRANCH_PREVIEW);
  const branchOverflow = branches.length - branchPreview.length;

  return (
    <SurfaceSheet
      title={db.name}
      demo
      subtitle={
        <>
          {db.connection} · schema <b>{db.name}</b> · trunk <b>{db.trunk}</b> at
          revision {db.trunkRevision}
        </>
      }
    >
      <SurfaceBody>
        <Zone title="Overview">
          <FactList
            facts={[
              { label: "Tables", value: db.tables },
              { label: "Columns", value: db.columns },
              { label: "Indexes", value: db.indexes },
              { label: "Constraints", value: db.constraints },
              { label: "Main changed", value: db.trunkChangedOn },
              { label: "Open merges", value: merges.length },
            ]}
          />
        </Zone>

        <Zone title="Open merges" count={merges.length}>
          <SheetList>
            {merges.map((m) => (
              <Row
                key={m.id}
                to={`/merge/${encodeURIComponent(m.id)}`}
                primary={
                  <>
                    {m.source} <span aria-hidden="true">→</span> {m.target}
                  </>
                }
                meta={`${m.author} · opened ${m.openedOn} · ${m.operations} operations`}
                trailing={
                  <StatusPill tone={mergeStatusTone(m)}>
                    {mergeStatusLabel(m)}
                  </StatusPill>
                }
              />
            ))}
          </SheetList>
        </Zone>

        <Zone title="Branches" count={branches.length}>
          <SheetList>
            {branchPreview.map((b) => (
              <Row
                key={b.name}
                to={`/branch/${encodeURIComponent(b.name)}`}
                primary={b.name}
                meta={`${b.author} · cut ${b.cutOn}`}
                trailing={<Tri n={b.divergence} />}
              />
            ))}
            {branchOverflow > 0 && (
              <MoreRow to="/branches">
                {branchOverflow} more branch{branchOverflow === 1 ? "" : "es"} →
              </MoreRow>
            )}
          </SheetList>
        </Zone>
      </SurfaceBody>
    </SurfaceSheet>
  );
}
