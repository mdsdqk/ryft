/**
 * The route table. Six surfaces plus a catch-all. `/` is the username gate when
 * signed out and a redirect to `/db` when signed in; every other route requires
 * a session and bounces to `/` without one.
 */

import { useEffect } from "react";

import { matchPath, useRouter } from "../router/router.tsx";
import { useSession } from "../session/session.ts";

import { SignIn } from "../surfaces/SignIn.tsx";
import { Dashboard } from "../surfaces/Dashboard.tsx";
import { Branches } from "../surfaces/Branches.tsx";
import { Merges } from "../surfaces/Merges.tsx";
import { BranchWorkspace } from "../surfaces/BranchWorkspace.tsx";
import { MergeReviewRoute } from "../surfaces/MergeReviewRoute.tsx";
import { PlannedSheet } from "../surfaces/PlannedSheet.tsx";

function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

function NotFound() {
  return (
    <PlannedSheet title="No such sheet">
      That route does not exist. The database sheets — Database, Branches,
      Merges — are in the rail.
    </PlannedSheet>
  );
}

export function Routes() {
  const { path } = useRouter();
  const { username } = useSession();

  if (path === "/" || path === "") {
    return username ? <Redirect to="/db" /> : <SignIn />;
  }

  // every surface past the gate needs a session
  if (!username) return <Redirect to="/" />;

  if (path === "/db") return <Dashboard />;
  if (path === "/branches") return <Branches />;
  if (path === "/merges") return <Merges />;

  const branch = matchPath("/branch/:name", path);
  if (branch) return <BranchWorkspace name={branch.name!} />;

  if (path === "/merge" || matchPath("/merge/:id", path)) {
    return <MergeReviewRoute />;
  }

  return <NotFound />;
}
