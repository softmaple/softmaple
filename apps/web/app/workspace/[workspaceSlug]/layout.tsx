import type { ReactNode } from "react";
import { Suspense } from "react";

import { cachedGetWorkspaces } from "@/app/actions/workspaces";
import { listWorkspaceDocuments } from "@/app/actions/documents/documents";
import {
  getWorkspaceMemberByUserId,
  listWorkspaceMembers,
} from "@/app/actions/workspaceMembers";
import { getCurrentProfile } from "@/app/actions/users";
import { requireWorkspaceRouteData } from "@/lib/actions/workspace-route";
import { WORKSPACE_ROLE } from "@/lib/workspace-roles";
import { WorkspaceDesktopSidebar } from "@/modules/workspaces/workspace-desktop-sidebar";
import { WorkspaceDropdown } from "@/modules/workspaces/workspace-dropdown";
import { WorkspaceMobileNav } from "@/modules/workspaces/workspace-mobile-nav";
import { WorkspaceRightSidebar } from "@/modules/workspaces/workspace-right-sidebar";

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
  const profileResourcePromise = getCurrentProfile();
  const [documentsResource, membershipResource, membersResource] =
    currentWorkspace === undefined
      ? [null, null, null]
      : await Promise.all([
          listWorkspaceDocuments(currentWorkspace.id, 100),
          getWorkspaceMemberByUserId(currentWorkspace.id),
          listWorkspaceMembers(currentWorkspace.id),
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
  const members =
    membersResource === null
      ? []
      : requireWorkspaceRouteData(membersResource, {
          ...failureContext,
          operation: "list_workspace_members",
        });
  const profile = requireWorkspaceRouteData(await profileResourcePromise, {
    ...failureContext,
    operation: "get_current_profile",
  });
  const canEdit =
    membership?.role === WORKSPACE_ROLE.Owner ||
    membership?.role === WORKSPACE_ROLE.Editor;

  return (
    <div className="workspace-shell flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-background md:flex-row">
      <WorkspaceDesktopSidebar
        canEdit={canEdit}
        documents={documents}
        profile={profile}
        workspaceSlug={workspaceSlug}
      >
        <WorkspaceDropdown
          workspaceSlug={workspaceSlug}
          workspaces={workspaces}
        />
      </WorkspaceDesktopSidebar>

      <WorkspaceMobileNav
        canEdit={canEdit}
        documents={documents}
        profile={profile}
        workspaceSlug={workspaceSlug}
      >
        <WorkspaceDropdown
          compact
          workspaceSlug={workspaceSlug}
          workspaces={workspaces}
        />
      </WorkspaceMobileNav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Suspense>{children}</Suspense>
      </div>

      <WorkspaceRightSidebar
        canManageMembers={membership?.role === WORKSPACE_ROLE.Owner}
        members={members}
        workspaceSlug={workspaceSlug}
      />
    </div>
  );
}
