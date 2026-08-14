"use client";

import {
  RouteError,
  type RouteErrorBoundaryProps,
} from "@/components/RouteError";

export default function DashboardErrorPage({ retry }: RouteErrorBoundaryProps) {
  return (
    <RouteError
      backHref="/"
      backLabel="Back to home"
      className="min-h-[calc(100dvh-3.5rem)]"
      description="Your workspace list is still safe. Retry the request, or return to the public home page."
      retry={retry}
      title="The workspace index paused."
    />
  );
}
