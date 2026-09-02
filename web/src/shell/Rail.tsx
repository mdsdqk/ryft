/**
 * The left index rail — the app's primary navigation. Top-level entries always
 * show; opening a branch or a merge request nests that entity's views under it,
 * with the open entity named in a heading row so the sub-list reads as "inside
 * this branch", not as a sub-menu of the list page. The current view is boxed,
 * the same marker the revision dial uses for its current step.
 *
 * The database line and the counts come from `useOverview` — one `getOverview`
 * read hoisted to `OverviewProvider` in the shell, shared with the `/db`
 * dashboard so the screen fetches `/overview` once.
 */

import { Link, useLocation, useMatch } from "react-router";

import { useOverview } from "./overview.tsx";

export function Rail() {
  const { pathname, search } = useLocation();
  const freshlySeeded =
    (pathname === "/db" || pathname === "/") &&
    new URLSearchParams(search).has("empty");
  const { data } = useOverview();
  const db = data?.database;
  const branchCount = freshlySeeded ? 0 : data?.branches.length;
  const mergeCount = freshlySeeded ? 0 : data?.merges.length;
  const branchSheet = new URLSearchParams(search).get("sheet") ?? "schema";

  const branchMatch = useMatch("/branch/:name");
  const mergeMatch = useMatch("/merge/:id");
  const onDatabase = pathname === "/db" || pathname === "/";
  const onBranches = useMatch({ path: "/branches", end: true });
  const onMerges = useMatch({ path: "/merges", end: true });

  const openBranch = branchMatch?.params.name
    ? decodeURIComponent(branchMatch.params.name)
    : null;
  const openMergeId = mergeMatch?.params.id
    ? decodeURIComponent(mergeMatch.params.id)
    : null;
  const openMerge =
    openMergeId != null
      ? data?.merges.find((m) => m.id === openMergeId) ?? null
      : null;

  return (
    <nav className="shl-rail" aria-label="Main navigation">
      <div className="shl-rail__set">ryft · schema under version control</div>
      <div className="shl-rail__db">{db?.name ?? "—"}</div>
      <div className="shl-rail__conn">
        {db
          ? `${db.connection} · ${db.tables} tables · ${db.trunk} · rev ${db.trunkRevision} · updated ${db.trunkChangedOn}`
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
          {openBranch && (
            <ul
              className="shl-rail__sub"
              aria-label={`${openBranch} — open branch`}
            >
              <li className="shl-rail__open">
                <span className="shl-rail__open-k">Branch</span>
                <span className="shl-rail__open-nm">{openBranch}</span>
              </li>
              <li>
                <Link
                  to={`/branch/${encodeURIComponent(openBranch)}`}
                  aria-current={branchSheet === "schema" ? "page" : undefined}
                >
                  Schema
                </Link>
              </li>
              <li>
                <Link
                  to={`/branch/${encodeURIComponent(openBranch)}?sheet=divergence`}
                  aria-current={branchSheet === "divergence" ? "page" : undefined}
                >
                  Divergence
                </Link>
              </li>
            </ul>
          )}
        </li>
        <li>
          <Link to="/merges" aria-current={onMerges ? "page" : undefined}>
            Merge requests {data && <span className="shl-ct">{mergeCount}</span>}
          </Link>
          {openMergeId && (
            <ul
              className="shl-rail__sub"
              aria-label={`${
                openMerge ? `${openMerge.source} → ${openMerge.target}` : openMergeId
              } — open merge request`}
            >
              <li className="shl-rail__open">
                <span className="shl-rail__open-k">Merge request</span>
                <span className="shl-rail__open-nm">
                  {openMerge
                    ? `${openMerge.source} → ${openMerge.target}`
                    : openMergeId}
                </span>
              </li>
              <li>
                <Link
                  to={`/merge/${encodeURIComponent(openMergeId)}`}
                  aria-current="page"
                >
                  Review
                </Link>
              </li>
            </ul>
          )}
        </li>
      </ul>
    </nav>
  );
}
