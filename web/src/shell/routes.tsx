/**
 * The route table. Six surfaces plus a catch-all. `/` is the username gate when
 * signed out and a redirect to `/db` when signed in; every other route requires
 * a session and bounces to `/` without one.
 */

import { Navigate, Route, Routes } from "react-router";

import { useSession } from "../session/session.ts";

import { SignIn } from "../surfaces/SignIn.tsx";
import { Dashboard } from "../surfaces/Dashboard.tsx";
import { Branches } from "../surfaces/Branches.tsx";
import { Merges } from "../surfaces/Merges.tsx";
import { BranchWorkspace } from "../surfaces/BranchWorkspace.tsx";
import { MergeReviewRoute } from "../surfaces/MergeReviewRoute.tsx";
import { PlannedSheet } from "../surfaces/PlannedSheet.tsx";

function NotFound() {
  return (
    <PlannedSheet title="No such sheet">
      That route does not exist. The database sheets — Database, Branches,
      Merges — are in the rail.
    </PlannedSheet>
  );
}

export function AppRoutes() {
  const { username } = useSession();

  if (!username) {
    return (
      <Routes>
        <Route path="/" element={<SignIn />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/db" replace />} />
      <Route path="/db" element={<Dashboard />} />
      <Route path="/branches" element={<Branches />} />
      <Route path="/merges" element={<Merges />} />
      <Route path="/branch/:name" element={<BranchWorkspace />} />
      <Route path="/merge" element={<MergeReviewRoute />} />
      <Route path="/merge/:id" element={<MergeReviewRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
