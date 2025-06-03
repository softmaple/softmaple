import type { FC, ReactNode } from "react";
import Link from "next/link";
import {
  ChevronDown,
  FileText,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@softmaple/ui/components/dropdown-menu";
import { Input } from "@softmaple/ui/components/input";
import { WorkspaceNavigation } from "@/modules/workspaces/workspace-navigation";
import { Separator } from "@softmaple/ui/components/separator";
import { WorkspaceDocsList } from "@/modules/workspaces/workspace-docs-list";

export type WorkspaceDesktopSidebarProps = {
  workspaceSlug: string;
  children?: ReactNode;
};

export const WorkspaceDesktopSidebar: FC<WorkspaceDesktopSidebarProps> = (
  props,
) => {
  const { workspaceSlug, children } = props;

  return (
    <div className="hidden md:flex w-80 border-r border-border/40 bg-muted/30 flex-col">
      {/* Workspace Header */}
      <div className="p-4 border-b border-border/40">
        <div className="flex items-center justify-between mb-4">
          <Link href="/dashboard" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold">Softmaple</span>
          </Link>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {children}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            id="search-documents"
            placeholder="Search documents..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Navigation */}
      <WorkspaceNavigation workspaceSlug={workspaceSlug} />

      <Separator />

      {/* Documents */}
      <WorkspaceDocsList workspaceSlug={workspaceSlug} />
    </div>
  );
};
