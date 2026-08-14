"use client";

import {
  RouteError,
  type RouteErrorBoundaryProps,
} from "@/components/RouteError";

export default function ErrorPage({ retry }: RouteErrorBoundaryProps) {
  return (
    <RouteError
      backHref="/"
      backLabel="Back to home"
      className="min-h-dvh"
      description="The page could not finish loading. Try the route again, or return to the public home page."
      retry={retry}
      title="The page lost its place."
    />
  );
}
