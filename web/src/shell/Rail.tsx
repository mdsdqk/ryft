/**
 * The sheet-index rail — the drawing set's binder. Top-level sheets always show;
 * opening a branch or a merge nests that item's sub-sheets under it. The current
 * sheet is boxed, the same marker the revision dial uses for its current step.
 *
 * The database line and the counts come from the data seam. With the fixture
 * they resolve before the first frame is meaningfully visible; once a real API
 * is wired, hoist this read to the app root so the rail and the dashboard share
 * one fetch.
 */

import { Link, matchPath, useRouter } from "../router/router.tsx";
import { source, useResource } from "../data/index.ts";

export function Rail() {
  const { path } = useRouter();
  const { data } = useResource(() => source.getOverview());
  const db = data?.database;

  const branchMatch = matchPath("/branch/:name", path);
  const mergeMatch = matchPath("/merge/:id", path);
  const onDatabase = path === "/db" || path === "/";

  return (
    <nav className="shl-rail" aria-label="Database sheets">
      <div className="shl-rail__set">ryft · schema under version control</div>
      <div className="shl-rail__db">{db?.name ?? "—"}</div>
      <div className="shl-rail__conn">
        {db
          ? `${db.connection} · ${db.tables} tables · ${db.trunk} @ rev ${db.trunkRevision}`
          : "loading…"}
      </div>

      <ul className="shl-rail__nav">
        <li>
          <Link to="/db" aria-current={onDatabase ? "page" : undefined}>
            Database
          </Link>
        </li>
        <li>
          <Link to="/branches">
            Branches{" "}
            {data && <span className="shl-ct">{data.branches.length}</span>}
          </Link>
          {branchMatch && (
            <ul className="shl-rail__sub" aria-label={`${branchMatch.name} sheets`}>
              <li>
                <Link to={`/branch/${encodeURIComponent(branchMatch.name!)}`}>
                  Schema
                </Link>
              </li>
              <li>
                <span aria-disabled="true">Divergence</span>
              </li>
              <li>
                <span aria-disabled="true">History</span>
              </li>
            </ul>
          )}
        </li>
        <li>
          <Link to="/merges">
            Merges {data && <span className="shl-ct">{data.merges.length}</span>}
          </Link>
          {mergeMatch && (
            <ul className="shl-rail__sub" aria-label="Merge sheets">
              <li>
                <Link to={`/merge/${encodeURIComponent(mergeMatch.id!)}`}>
                  Review
                </Link>
              </li>
            </ul>
          )}
        </li>
      </ul>

      <p className="shl-rail__hint">
        Open a branch or a merge and its sheets nest here.
      </p>
    </nav>
  );
}
