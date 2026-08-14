"use client";

import {
  RouteError,
  type RouteErrorBoundaryProps,
} from "@/components/RouteError";

export default function DocumentErrorPage({ retry }: RouteErrorBoundaryProps) {
  return (
    <RouteError
      backHref="/dashboard"
      backLabel="All workspaces"
      description="The document view could not finish opening. Retry the request, or return to your workspace index."
      retry={retry}
      title="This document is out of view."
    />
  );
}
