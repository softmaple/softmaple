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
  const failureContext = {
    loginNext:
      tab === "members"
        ? `/workspace/${workspaceSlug}/settings?tab=members`
        : `/workspace/${workspaceSlug}/settings`,
    route: ROUTE,
    workspaceSlug,
  } as const;

  const workspace = requireWorkspaceRouteData(
    await cachedGetWorkspaceBySlug(workspaceSlug),
    {
      ...failureContext,
      operation: "get_workspace_by_slug",
    },
  );

  const [membershipResult, membersResult] = await Promise.all([
    getWorkspaceMemberByUserId(workspace.id),
    listWorkspaceMembers(workspace.id),
  ]);

  const membership = requireWorkspaceRouteData(membershipResult, {
    ...failureContext,
    operation: "get_workspace_member_by_user_id",
  });
  const members = requireWorkspaceRouteData(membersResult, {
    ...failureContext,
    operation: "list_workspace_members",
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
