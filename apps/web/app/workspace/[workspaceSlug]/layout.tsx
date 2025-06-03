import type { ReactNode } from "react";

import { Suspense } from "react";
import { WorkspaceDropdown } from "@/modules/workspaces/workspace-dropdown";
import { WorkspaceMobileSidebar } from "@/modules/workspaces/workspace-mobile-sidebar";
import { cachedGetWorkspaces } from "@/app/actions/workspaces";
import { WorkspaceDesktopSidebar } from "@/modules/workspaces/workspace-desktop-sidebar";

type Props = {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  children: ReactNode;
};

export default async function WorkspaceLayoutPage(props: Props) {
  const { params, children } = props;
  const { workspaceSlug } = await params;

  const workspaceResource = await cachedGetWorkspaces();

  return (
    <div className="h-screen flex bg-background">
      {/* Mobile Menu Trigger */}
      <WorkspaceMobileSidebar workspaceSlug={workspaceSlug}>
        <WorkspaceDropdown
          workspaceSlug={workspaceSlug}
          workspacesResource={workspaceResource}
        />
      </WorkspaceMobileSidebar>

      {/* Desktop Sidebar */}
      <WorkspaceDesktopSidebar workspaceSlug={workspaceSlug}>
        <WorkspaceDropdown
          workspaceSlug={workspaceSlug}
          workspacesResource={workspaceResource}
        />
      </WorkspaceDesktopSidebar>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <Suspense>{children}</Suspense>
      </div>
    </div>
  );
}
