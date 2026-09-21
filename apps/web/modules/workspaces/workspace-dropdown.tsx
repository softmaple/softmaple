"use client";

import type { FC } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@softmaple/ui/components/dropdown-menu";
import { Button } from "@softmaple/ui/components/button";
import { Building2, ChevronDown, LayoutGrid, Settings } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import type { WorkspaceSummary } from "@/app/actions/workspaces";
import Link from "next/link";

export type WorkspaceDropdownProps = {
  compact?: boolean;
  workspaceSlug: string;
  workspaces: ReadonlyArray<WorkspaceSummary>;
};

export const WorkspaceDropdown: FC<WorkspaceDropdownProps> = (props) => {
  const {
    compact = false,
    workspaceSlug,
    workspaces: workspaceSummaries,
  } = props;

  const workspaces = workspaceSummaries.map((workspace) => ({
    ...workspace,
    key: workspace.id,
  }));

  const currentWorkspace = workspaces.find(
    ({ slug }) => slug === workspaceSlug,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`workspace-switcher w-full min-w-0 justify-start gap-2.5 overflow-hidden bg-background/55 px-3 shadow-none ${
            compact ? "h-11" : "mb-1 h-11"
          }`}
        >
          <Avatar className="size-6 shrink-0 rounded-md border border-sidebar-border bg-background">
            <AvatarImage
              alt={currentWorkspace?.avatar_alt ?? ""}
              src={currentWorkspace?.avatar_src ?? undefined}
            />
            <AvatarFallback className="rounded-md bg-transparent">
              <Building2 className="size-3.5" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 text-left">
            <h2 className="truncate text-[0.84rem] font-medium">
              {currentWorkspace?.title ?? "Workspace"}
            </h2>
          </div>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[min(20rem,calc(100vw-2rem))]"
        align="start"
      >
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => {
          return (
            <DropdownMenuItem asChild key={workspace.key}>
              <Link className="min-w-0" href={`/workspace/${workspace.slug}`}>
                <Avatar className="size-8 rounded-md border">
                  <AvatarImage
                    alt={workspace.avatar_alt ?? ""}
                    src={workspace.avatar_src ?? undefined}
                  />
                  <AvatarFallback className="rounded-md">
                    <Building2 className="size-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{workspace.title}</div>
                  {workspace.description ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {workspace.description}
                    </div>
                  ) : null}
                </div>
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutGrid className="mr-2 size-4" />
            All workspaces
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/workspace/${workspaceSlug}/settings`}>
            <Settings className="mr-2 size-4" />
            Workspace settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
