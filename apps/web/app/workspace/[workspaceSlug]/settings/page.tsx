import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import {
  getWorkspaceMemberByUserId,
  listWorkspaceMembers,
} from "@/app/actions/workspaceMembers";
import { requireWorkspaceRouteData } from "@/lib/actions/workspace-route";
import { WorkspaceSettings } from "@/modules/workspaces/workspace-settings";

const ROUTE = "/workspace/[workspaceSlug]/settings";

export default async function WorkspaceSettingsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ workspaceSlug: string }>;
  readonly searchParams: Promise<{ tab?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { tab } = await searchParams;
  const loginNext =
    tab === "members"
      ? `/workspace/${workspaceSlug}/settings?tab=members`
      : `/workspace/${workspaceSlug}/settings`;

  const workspace = requireWorkspaceRouteData(
    await cachedGetWorkspaceBySlug(workspaceSlug),
    {
      loginNext,
      operation: "get_workspace_by_slug",
      route: ROUTE,
      workspaceSlug,
    },
  );

  const [membershipResult, membersResult] = await Promise.all([
    getWorkspaceMemberByUserId(workspace.id),
    listWorkspaceMembers(workspace.id),
  ]);

  const membership = requireWorkspaceRouteData(membershipResult, {
    loginNext,
    operation: "get_workspace_member_by_user_id",
    route: ROUTE,
    workspaceSlug,
  });
  const members = requireWorkspaceRouteData(membersResult, {
    loginNext,
    operation: "list_workspace_members",
    route: ROUTE,
    workspaceSlug,
  });

  return (
    <WorkspaceSettings
      members={members}
      role={membership.role}
      initialTab={tab === "members" ? "members" : "general"}
      workspace={workspace}
    />
  );
}
