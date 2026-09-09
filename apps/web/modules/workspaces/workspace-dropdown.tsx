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
import { ChevronDown, LayoutGrid, Settings } from "lucide-react";
import type { WorkspaceSummary } from "@/app/actions/workspaces";
import { RaspberryRecordMark } from "@/components/BrandMark";
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
          variant="ghost"
          className={`w-full min-w-0 justify-start gap-2 overflow-hidden p-2 ${
            compact ? "h-10" : "mb-4 h-auto"
          }`}
        >
          <RaspberryRecordMark className={compact ? "size-7" : "size-10"} />
          <div className="min-w-0 flex-1 text-left">
            <h2 className="truncate font-semibold">
              {currentWorkspace?.title ?? "Workspace"}
            </h2>
            {compact ? null : (
              <p className="truncate text-sm text-muted-foreground">
                {currentWorkspace?.description || "Shared writing space"}
              </p>
            )}
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
                <RaspberryRecordMark className="size-8" />
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
