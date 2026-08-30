/**
 * The database overview — the surface you land on after signing in, since there
 * is no database to choose. V0 renders the shape of it from demonstration data
 * (docs/design/shape-brief-app-flow.md §4): an overview fact block, the open
 * merges, and the branches. Create / delete, empty-state variants, and the live
 * API are later steps.
 */

import { Link } from "../router/router.tsx";
import { demoBranches, demoDatabase, demoMerges } from "../shell/demo.ts";

/** the dashboard summarises; the full list lives on /branches */
const BRANCH_PREVIEW = 6;

export function Dashboard() {
  const db = demoDatabase;
  const branchPreview = demoBranches.slice(0, BRANCH_PREVIEW);
  const branchOverflow = demoBranches.length - branchPreview.length;
  return (
    <article className="mr-sheet">
      <header className="mr-titlestrip">
        <div className="mr-titlestrip__id">
          <h1 className="mr-titlestrip__h1">{db.name}</h1>
          <p className="mr-titlestrip__path">
            {db.connection} · schema <b>{db.name}</b> · trunk <b>{db.trunk}</b> at
            revision {db.trunkRevision}
          </p>
          <p className="mr-titlestrip__demo">Demonstration data</p>
        </div>
      </header>

      <div className="shl-body">
        <section className="shl-zone">
          <div className="shl-zone__k">Overview</div>
          <dl className="shl-facts">
            <div>
              <dt>Tables</dt>
              <dd>{db.tables}</dd>
            </div>
            <div>
              <dt>Columns</dt>
              <dd>{db.columns}</dd>
            </div>
            <div>
              <dt>Indexes</dt>
              <dd>{db.indexes}</dd>
            </div>
            <div>
              <dt>Constraints</dt>
              <dd>{db.constraints}</dd>
            </div>
            <div>
              <dt>Main changed</dt>
              <dd>{db.trunkChangedOn}</dd>
            </div>
            <div>
              <dt>Open merges</dt>
              <dd>{demoMerges.length}</dd>
            </div>
          </dl>
        </section>

        <section className="shl-zone">
          <div className="shl-zone__k">
            Open merges <span className="shl-ct">{demoMerges.length}</span>
          </div>
          <div className="shl-rows">
            {demoMerges.map((m) => (
              <div className="shl-row" key={m.id}>
                <div className="shl-row__main">
                  <Link to={`/merge/${encodeURIComponent(m.id)}`}>
                    {m.source} <span aria-hidden="true">→</span> {m.target}
                  </Link>
                  <span className="shl-row__meta">
                    {m.author} · opened {m.openedOn} · {m.operations} operations
                  </span>
                </div>
                <span
                  className={`shl-status${m.status === "held" ? " shl-status--held" : ""}`}
                >
                  <span
                    className={`shl-dot${m.status === "held" ? " shl-dot--held" : ""}`}
                  />
                  {m.status === "held"
                    ? `Held · ${m.conflicts} conflict${m.conflicts === 1 ? "" : "s"}`
                    : "Clean"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="shl-zone">
          <div className="shl-zone__k">
            Branches <span className="shl-ct">{demoBranches.length}</span>
          </div>
          <div className="shl-rows">
            {branchPreview.map((b) => (
              <div className="shl-row" key={b.name}>
                <div className="shl-row__main">
                  <Link to={`/branch/${encodeURIComponent(b.name)}`}>{b.name}</Link>
                  <span className="shl-row__meta">
                    {b.author} · cut {b.cutOn}
                  </span>
                </div>
                {b.divergence > 0 ? (
                  <span className="shl-tri">
                    <span aria-hidden="true">△</span> {b.divergence}
                  </span>
                ) : (
                  <span className="shl-tri shl-tri--none">no changes</span>
                )}
              </div>
            ))}
            {branchOverflow > 0 && (
              <div className="shl-row shl-row--more">
                <Link to="/branches">
                  {branchOverflow} more branch{branchOverflow === 1 ? "" : "es"} →
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}
