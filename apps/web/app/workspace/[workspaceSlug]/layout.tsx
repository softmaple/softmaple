import type { ReactNode } from "react";
import { Suspense } from "react";

import { cachedGetWorkspaces } from "@/app/actions/workspaces";
import { listWorkspaceDocuments } from "@/app/actions/documents/documents";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
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

  const workspaceResource = await cachedGetWorkspaces();
  const currentWorkspace = workspaceResource.ok
    ? workspaceResource.data.find(
        (workspace) => workspace.slug === workspaceSlug,
      )
    : undefined;
  const [documentsResource, membershipResource] =
    currentWorkspace === undefined
      ? [null, null]
      : await Promise.all([
          listWorkspaceDocuments(currentWorkspace.id, 100),
          getWorkspaceMemberByUserId(currentWorkspace.id),
        ]);
  if (documentsResource !== null && !documentsResource.ok) {
    throw new Error(documentsResource.message);
  }
  if (membershipResource !== null && !membershipResource.ok) {
    throw new Error(membershipResource.message);
  }
  const documents = documentsResource?.data ?? [];
  const canEdit =
    membershipResource?.data.role === WORKSPACE_ROLE.Owner ||
    membershipResource?.data.role === WORKSPACE_ROLE.Editor;

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
          workspacesResource={workspaceResource}
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
          workspacesResource={workspaceResource}
        />
      </WorkspaceDesktopSidebar>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense>{children}</Suspense>
      </div>
    </div>
  );
}
