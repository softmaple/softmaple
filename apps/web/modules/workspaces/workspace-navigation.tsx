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
      <Button
        asChild
        className="w-full justify-start"
        variant={
          isActive(`/workspace/${workspaceSlug}`) ? "secondary" : "ghost"
        }
      >
        <Link href={`/workspace/${workspaceSlug}`} onClick={onNavigate}>
          <Home className="mr-2 h-4 w-4" />
          Overview
        </Link>
      </Button>
      {/*
        Settings/Members are auth- and membership-sensitive admin routes.
        Speculative Link prefetch can race session refresh and historically
        collapsed ActionResult failures into cacheable 404s; load on navigate.
      */}
      <Button
        asChild
        className="w-full justify-start"
        variant={
          isSettings && searchParams.get("tab") === "members"
            ? "secondary"
            : "ghost"
        }
      >
        <Link
          href={`/workspace/${workspaceSlug}/settings?tab=members`}
          onClick={onNavigate}
          prefetch={false}
        >
          <Users className="mr-2 h-4 w-4" />
          Members
        </Link>
      </Button>
      <Button
        asChild
        className="w-full justify-start"
        variant={
          isSettings && searchParams.get("tab") !== "members"
            ? "secondary"
            : "ghost"
        }
      >
        <Link
          href={`/workspace/${workspaceSlug}/settings`}
          onClick={onNavigate}
          prefetch={false}
        >
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </Link>
      </Button>
    </div>
  );
};
