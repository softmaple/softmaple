"use client";

import type { FC } from "react";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@softmaple/ui/components/button";
import { Home, Settings, Users } from "lucide-react";
import { usePathname } from "next/navigation";

export type WorkspaceNavigationProps = {
  workspaceSlug: string;
};
export const WorkspaceNavigation: FC<WorkspaceNavigationProps> = (props) => {
  const { workspaceSlug } = props;

  const pathname = usePathname();
  const isActive = (path: string) => pathname === path;

  return (
    <div className="p-4 space-y-2">
      <Link href={`/workspace/${workspaceSlug}`}>
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
      <Button variant="ghost" className="w-full justify-start">
        <Users className="mr-2 h-4 w-4" />
        Members
      </Button>
      <Link href={`/workspace/${workspaceSlug}/settings`}>
        <Button
          variant={
            isActive(`/workspace/${workspaceSlug}/settings`)
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
