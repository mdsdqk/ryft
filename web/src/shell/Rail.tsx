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

import { Link, useLocation, useMatch } from "react-router";

import { source, useResource } from "../data/index.ts";

export function Rail() {
  const { pathname, search } = useLocation();
  const freshlySeeded =
    (pathname === "/db" || pathname === "/") &&
    new URLSearchParams(search).has("empty");
  const { data } = useResource(() => source.getOverview(), [freshlySeeded]);
  const db = data?.database;
  const branchCount = freshlySeeded ? 0 : data?.branches.length;
  const mergeCount = freshlySeeded ? 0 : data?.merges.length;
  const branchSheet = new URLSearchParams(search).get("sheet") ?? "schema";

  const branchMatch = useMatch("/branch/:name");
  const mergeMatch = useMatch("/merge/:id");
  const onDatabase = pathname === "/db" || pathname === "/";
  const onBranches = useMatch({ path: "/branches", end: true });
  const onMerges = useMatch({ path: "/merges", end: true });

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
          <Link
            to="/branches"
            aria-current={onBranches ? "page" : undefined}
          >
            Branches{" "}
            {data && <span className="shl-ct">{branchCount}</span>}
          </Link>
          {branchMatch && (
            <ul
              className="shl-rail__sub"
              aria-label={`${branchMatch.params.name} sheets`}
            >
              <li>
                <Link
                  to={`/branch/${encodeURIComponent(branchMatch.params.name!)}`}
                  aria-current={branchSheet === "schema" ? "page" : undefined}
                >
                  Schema
                </Link>
              </li>
              <li>
                <Link
                  to={`/branch/${encodeURIComponent(branchMatch.params.name!)}?sheet=divergence`}
                  aria-current={branchSheet === "divergence" ? "page" : undefined}
                >
                  Divergence
                </Link>
              </li>
              <li>
                <span aria-disabled="true">History</span>
              </li>
            </ul>
          )}
        </li>
        <li>
          <Link to="/merges" aria-current={onMerges ? "page" : undefined}>
            Merges {data && <span className="shl-ct">{mergeCount}</span>}
          </Link>
          {mergeMatch && (
            <ul className="shl-rail__sub" aria-label="Merge sheets">
              <li>
                <Link
                  to={`/merge/${encodeURIComponent(mergeMatch.params.id!)}`}
                  aria-current="page"
                >
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
