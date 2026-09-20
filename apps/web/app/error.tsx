"use client";

import {
  RouteError,
  type RouteErrorBoundaryProps,
} from "@/components/RouteError";

export default function ErrorPage({ retry }: RouteErrorBoundaryProps) {
  return <RouteError variant="global" retry={retry} />;
}
