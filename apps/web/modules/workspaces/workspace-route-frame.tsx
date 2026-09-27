"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/** The home has its own chrome; settings have their own chrome; the editor retains its layout. */
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
  return pathname === `/workspace/${workspaceSlug}` ||
    pathname === `/workspace/${workspaceSlug}/settings`
    ? children
    : legacy;
}
