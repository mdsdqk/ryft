/**
 * One `getOverview` read for the whole signed-in shell. The rail and the
 * `/db` dashboard both need the database line + branch/merge counts; without a
 * shared read each mounts its own `useResource` and the screen fires `/overview`
 * twice (more under StrictMode). `OverviewProvider` wraps the shell so both
 * consume the same resource — `useResource` still re-runs on the data epoch, so
 * a create/delete or the `?empty` toggle refreshes every consumer at once.
 */

import { createContext, useContext, type ReactNode } from "react";

import { source, useResource, type Overview, type Resource } from "../data/index.ts";

const OverviewContext = createContext<Resource<Overview> | null>(null);

export function OverviewProvider({ children }: { children: ReactNode }) {
  const resource = useResource(() => source.getOverview());
  return (
    <OverviewContext.Provider value={resource}>{children}</OverviewContext.Provider>
  );
}

export function useOverview(): Resource<Overview> {
  const ctx = useContext(OverviewContext);
  if (!ctx) throw new Error("useOverview must be used within <OverviewProvider>");
  return ctx;
}
