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
  const settingsPath = `/workspace/${workspaceSlug}/settings`;
  const isSettings = pathname.startsWith(settingsPath);
  const isActive = (path: string) => pathname === path;

  return (
    <nav
      aria-label="Workspace sections"
      className="flex shrink-0 flex-col gap-1 px-3 pb-5 pt-3"
    >
      <Button
        asChild
        className="h-10 w-full justify-start rounded-md px-3 text-[0.86rem] font-normal"
        variant={
          isActive(`/workspace/${workspaceSlug}`) ? "secondary" : "ghost"
        }
      >
        <Link
          href={`/workspace/${workspaceSlug}`}
          onClick={onNavigate}
          aria-current={
            isActive(`/workspace/${workspaceSlug}`) ? "page" : undefined
          }
        >
          <Home data-icon="inline-start" />
          Home
        </Link>
      </Button>
      {/*
        Settings/Members are auth- and membership-sensitive admin routes.
        Speculative Link prefetch can race session refresh and historically
        collapsed ActionResult failures into cacheable 404s; load on navigate.
      */}
      <Button
        asChild
        className="h-10 w-full justify-start rounded-md px-3 text-[0.86rem] font-normal"
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
          aria-current={
            isSettings && searchParams.get("tab") === "members"
              ? "page"
              : undefined
          }
        >
          <Users data-icon="inline-start" />
          Members
        </Link>
      </Button>
      <Button
        asChild
        className="h-10 w-full justify-start rounded-md px-3 text-[0.86rem] font-normal"
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
          aria-current={
            isSettings && searchParams.get("tab") !== "members"
              ? "page"
              : undefined
          }
        >
          <Settings data-icon="inline-start" />
          Settings
        </Link>
      </Button>
    </nav>
  );
};
