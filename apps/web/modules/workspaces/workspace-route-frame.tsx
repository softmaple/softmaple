"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/** The home has its own chrome; existing editor/settings layouts stay intact. */
export function WorkspaceRouteFrame({
  workspaceSlug,
  children,
  legacy,
}: {
  workspaceSlug: string;
  children: ReactNode;
  legacy: ReactNode;
}) {
  const pathname = usePathname();
  return pathname === `/workspace/${workspaceSlug}` ? children : legacy;
}
