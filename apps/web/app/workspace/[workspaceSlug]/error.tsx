"use client";

import {
  RouteError,
  type RouteErrorBoundaryProps,
} from "@/components/RouteError";

export default function WorkspaceErrorPage({ retry }: RouteErrorBoundaryProps) {
  return (
    <RouteError
      backHref="/dashboard"
      backLabel="All workspaces"
      description="This workspace could not finish opening. Retry the request, or return to your workspace index."
      retry={retry}
      title="This workspace is out of view."
    />
  );
}
