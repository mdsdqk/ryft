/**
 * On-world placeholder for a surface that is routed but not yet built. Keeps the
 * drafting-room frame so navigating to it never shows a blank page, and says
 * plainly what is planned and where.
 */

import type { ReactNode } from "react";

import { EmptyState, SurfaceSheet } from "./kit/index.ts";

export function PlannedSheet({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <SurfaceSheet title={title}>
      <EmptyState>{children}</EmptyState>
    </SurfaceSheet>
  );
}
