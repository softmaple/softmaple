import type { Metadata } from "next";
import {
  cachedGetWorkspaceBySlug,
  cachedGetWorkspaces,
} from "@/app/actions/workspaces";
import {
  countWorkspaceDocuments,
  cachedListWorkspaceDocuments,
} from "@/app/actions/documents/documents";
import {
  cachedGetWorkspaceMemberByUserId,
  listWorkspaceMembers,
} from "@/app/actions/workspaceMembers";
import { getCurrentProfile } from "@/app/actions/users";
import { requireWorkspaceRouteData } from "@/lib/actions/workspace-route";
import { WORKSPACE_ROLE } from "@/lib/workspace-roles";
import { WorkspaceHome } from "@/modules/workspaces/workspace-home";
type Props = { params: Promise<{ workspaceSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspaceSlug } = await params;
  const result = await cachedGetWorkspaceBySlug(workspaceSlug);
  if (!result.ok) return { title: "Workspace" };
  return {
    title: result.data.title,
    description: result.data.description || "Softmaple workspace",
  };
}

export default async function WorkspacePage({ params }: Props) {
  const { workspaceSlug } = await params;
  const context = {
    loginNext: `/workspace/${workspaceSlug}`,
    route: "/workspace/[workspaceSlug]",
    workspaceSlug,
  } as const;
  const workspace = requireWorkspaceRouteData(
    await cachedGetWorkspaceBySlug(workspaceSlug),
    { ...context, operation: "get_workspace_by_slug" },
  );
  const [
    documentsResult,
    countResult,
    membersResult,
    roleResult,
    profileResult,
    workspacesResult,
  ] = await Promise.all([
    cachedListWorkspaceDocuments(workspace.id, 100),
    countWorkspaceDocuments(workspace.id),
    listWorkspaceMembers(workspace.id),
    cachedGetWorkspaceMemberByUserId(workspace.id),
    getCurrentProfile(),
    cachedGetWorkspaces(),
  ]);
  const membership = requireWorkspaceRouteData(roleResult, {
    ...context,
    operation: "get_workspace_member_by_user_id",
  });
  const profile = requireWorkspaceRouteData(profileResult, {
    ...context,
    operation: "get_current_profile",
  });
  return (
    <WorkspaceHome
      workspaceSlug={workspaceSlug}
      documents={requireWorkspaceRouteData(documentsResult, {
        ...context,
        operation: "list_workspace_documents",
      })}
      documentCount={requireWorkspaceRouteData(countResult, {
        ...context,
        operation: "count_workspace_documents",
      })}
      members={requireWorkspaceRouteData(membersResult, {
        ...context,
        operation: "list_workspace_members",
      })}
      workspaces={requireWorkspaceRouteData(workspacesResult, {
        ...context,
        operation: "get_workspaces",
      })}
      profile={{
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        avatar_src: profile.avatar_src,
      }}
      canEdit={
        membership.role === WORKSPACE_ROLE.Owner ||
        membership.role === WORKSPACE_ROLE.Editor
      }
    />
  );
}
