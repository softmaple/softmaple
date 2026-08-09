import { notFound } from "next/navigation";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import {
  getWorkspaceMemberByUserId,
  listWorkspaceMembers,
} from "@/app/actions/workspaceMembers";
import { WorkspaceSettings } from "@/modules/workspaces/workspace-settings";

export default async function WorkspaceSettingsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ workspaceSlug: string }>;
  readonly searchParams: Promise<{ tab?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { tab } = await searchParams;
  const workspace = await cachedGetWorkspaceBySlug(workspaceSlug);
  if (!workspace.ok) notFound();
  const [membership, members] = await Promise.all([
    getWorkspaceMemberByUserId(workspace.data.id),
    listWorkspaceMembers(workspace.data.id),
  ]);
  if (!membership.ok || !members.ok) notFound();

  return (
    <WorkspaceSettings
      members={members.data}
      role={membership.data.role}
      initialTab={tab === "members" ? "members" : "general"}
      workspace={workspace.data}
    />
  );
}
