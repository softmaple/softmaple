"use client";

import type { FC } from "react";

import Link from "next/link";
import { Button } from "@softmaple/ui/components/button";
import { Home, Settings, Users } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

export type WorkspaceNavigationProps = {
  readonly onNavigate?: () => void;
  readonly workspaceSlug: string;
};
export const WorkspaceNavigation: FC<WorkspaceNavigationProps> = (props) => {
  const { onNavigate, workspaceSlug } = props;

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isSettings = pathname === `/workspace/${workspaceSlug}/settings`;
  const isActive = (path: string) => pathname === path;

  return (
    <div className="p-4 space-y-2">
      <Link href={`/workspace/${workspaceSlug}`} onClick={onNavigate}>
        <Button
          variant={
            isActive(`/workspace/${workspaceSlug}`) ? "secondary" : "ghost"
          }
          className="w-full justify-start"
        >
          <Home className="mr-2 h-4 w-4" />
          Overview
        </Button>
      </Link>
      <Link
        href={`/workspace/${workspaceSlug}/settings?tab=members`}
        onClick={onNavigate}
      >
        <Button
          className="w-full justify-start"
          variant={
            isSettings && searchParams.get("tab") === "members"
              ? "secondary"
              : "ghost"
          }
        >
          <Users className="mr-2 h-4 w-4" />
          Members
        </Button>
      </Link>
      <Link href={`/workspace/${workspaceSlug}/settings`} onClick={onNavigate}>
        <Button
          variant={
            isSettings && searchParams.get("tab") !== "members"
              ? "secondary"
              : "ghost"
          }
          className="w-full justify-start"
        >
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Button>
      </Link>
    </div>
  );
};
