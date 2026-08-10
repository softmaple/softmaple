import type { ReactNode } from "react";
import { Suspense } from "react";

import { cachedGetWorkspaces } from "@/app/actions/workspaces";
import { listWorkspaceDocuments } from "@/app/actions/documents/documents";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
import { requireWorkspaceRouteData } from "@/lib/actions/workspace-route";
import { WORKSPACE_ROLE } from "@/lib/workspace-roles";
import { WorkspaceDesktopSidebar } from "@/modules/workspaces/workspace-desktop-sidebar";
import { WorkspaceDropdown } from "@/modules/workspaces/workspace-dropdown";
import { WorkspaceMobileSidebar } from "@/modules/workspaces/workspace-mobile-sidebar";

type Props = {
  params: Promise<{ workspaceSlug: string }>;
  children: ReactNode;
};

export default async function WorkspaceLayoutPage(props: Props) {
  const { params, children } = props;
  const { workspaceSlug } = await params;
  const failureContext = {
    loginNext: `/workspace/${workspaceSlug}`,
    route: "/workspace/[workspaceSlug]",
    workspaceSlug,
  } as const;

  const workspaces = requireWorkspaceRouteData(await cachedGetWorkspaces(), {
    ...failureContext,
    operation: "get_workspaces",
  });
  const currentWorkspace = workspaces.find(
    (workspace) => workspace.slug === workspaceSlug,
  );
  const [documentsResource, membershipResource] =
    currentWorkspace === undefined
      ? [null, null]
      : await Promise.all([
          listWorkspaceDocuments(currentWorkspace.id, 100),
          getWorkspaceMemberByUserId(currentWorkspace.id),
        ]);
  const documents =
    documentsResource === null
      ? []
      : requireWorkspaceRouteData(documentsResource, {
          ...failureContext,
          operation: "list_workspace_documents",
        });
  const membership =
    membershipResource === null
      ? null
      : requireWorkspaceRouteData(membershipResource, {
          ...failureContext,
          operation: "get_workspace_member_by_user_id",
        });
  const canEdit =
    membership?.role === WORKSPACE_ROLE.Owner ||
    membership?.role === WORKSPACE_ROLE.Editor;

  return (
    <div className="flex h-dvh min-w-0 bg-background">
      {/* Mobile Menu Trigger */}
      <WorkspaceMobileSidebar
        canEdit={canEdit}
        documents={documents}
        workspaceSlug={workspaceSlug}
      >
        <WorkspaceDropdown
          workspaceSlug={workspaceSlug}
          workspaces={workspaces}
        />
      </WorkspaceMobileSidebar>

      {/* Desktop Sidebar */}
      <WorkspaceDesktopSidebar
        canEdit={canEdit}
        documents={documents}
        workspaceSlug={workspaceSlug}
      >
        <WorkspaceDropdown
          workspaceSlug={workspaceSlug}
          workspaces={workspaces}
        />
      </WorkspaceDesktopSidebar>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense>{children}</Suspense>
      </div>
    </div>
  );
}
