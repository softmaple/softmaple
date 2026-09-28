"use client";

import type { RouteErrorBoundaryProps } from "@/components/RouteError";
import { WorkspaceRouteError } from "@/modules/workspaces/workspace-route-error";

export default function WorkspaceErrorPage({ retry }: RouteErrorBoundaryProps) {
  return (
    <WorkspaceRouteError
      backHref="/dashboard"
      backLabel="All workspaces"
      description="Nothing in it was lost. Try again, or go back to all of your workspaces."
      retry={retry}
      title="This workspace didn’t open."
    />
  );
}
