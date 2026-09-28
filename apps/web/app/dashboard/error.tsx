"use client";

import type { RouteErrorBoundaryProps } from "@/components/RouteError";
import { WorkspaceRouteError } from "@/modules/workspaces/workspace-route-error";

export default function DashboardErrorPage({ retry }: RouteErrorBoundaryProps) {
  return (
    <WorkspaceRouteError
      backHref="/"
      backLabel="Back to home"
      className="min-h-0 flex-1"
      description="Your workspaces are safe. Try again, or return to the home page."
      retry={retry}
      title="Your workspaces didn’t load."
    />
  );
}
