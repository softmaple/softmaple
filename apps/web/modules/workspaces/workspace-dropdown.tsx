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
import { ChevronDown, FileText, Plus, Settings } from "lucide-react";
import type { WorkspaceSummary } from "@/app/actions/workspaces";
import Link from "next/link";

export type WorkspaceDropdownProps = {
  workspaceSlug: string;
  workspaces: ReadonlyArray<WorkspaceSummary>;
};

export const WorkspaceDropdown: FC<WorkspaceDropdownProps> = (props) => {
  const { workspaceSlug, workspaces: workspaceSummaries } = props;

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
          className="flex items-center space-x-2 mb-4 w-full justify-start p-2 h-auto"
        >
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 text-left">
            <h2 className="font-semibold">{currentWorkspace?.title}</h2>
            <p className="text-sm text-muted-foreground">
              {currentWorkspace?.description}
            </p>
          </div>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuLabel>Switch Workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => {
          return (
            <DropdownMenuItem asChild key={workspace.key}>
              <Link href={`/workspace/${workspace.slug}`}>
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="font-medium">{workspace.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {workspace.description}
                    </div>
                  </div>
                </div>
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <Plus className="mr-2 h-4 w-4" />
            Create New Workspace
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/workspace/${workspaceSlug}/settings`}>
            <Settings className="mr-2 h-4 w-4" />
            Workspace settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
