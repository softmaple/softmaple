import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Settings2, Users } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import {
  countWorkspaceDocuments,
  listWorkspaceDocumentPage,
} from "@/app/actions/documents/documents";
import {
  getWorkspaceMemberByUserId,
  listWorkspaceMembers,
} from "@/app/actions/workspaceMembers";
import { requireWorkspaceRouteData } from "@/lib/actions/workspace-route";
import { WORKSPACE_ROLE } from "@/lib/workspace-roles";
import { WorkspaceHome } from "@/modules/workspaces/workspace-home";

type Props = { params: Promise<{ workspaceSlug: string }> };

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .filter((part): part is string => part !== undefined)
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
  const failureContext = {
    loginNext: `/workspace/${workspaceSlug}`,
    route: "/workspace/[workspaceSlug]",
    workspaceSlug,
  } as const;
  const workspace = requireWorkspaceRouteData(
    await cachedGetWorkspaceBySlug(workspaceSlug),
    {
      ...failureContext,
      operation: "get_workspace_by_slug",
    },
  );
  const [documentsResult, documentCountResult, membersResult, roleResult] =
    await Promise.all([
      // The whole first page, not five: home groups documents rather than
      // truncating them, so the groups need something to group.
      listWorkspaceDocumentPage({ limit: 50, workspaceId: workspace.id }),
      countWorkspaceDocuments(workspace.id),
      listWorkspaceMembers(workspace.id),
      getWorkspaceMemberByUserId(workspace.id),
    ]);
  const documentPage = requireWorkspaceRouteData(documentsResult, {
    ...failureContext,
    operation: "list_workspace_documents",
  });
  const documentCount = requireWorkspaceRouteData(documentCountResult, {
    ...failureContext,
    operation: "count_workspace_documents",
  });
  const members = requireWorkspaceRouteData(membersResult, {
    ...failureContext,
    operation: "list_workspace_members",
  });
  const membership = requireWorkspaceRouteData(roleResult, {
    ...failureContext,
    operation: "get_workspace_member_by_user_id",
  });

  const canEdit =
    membership.role === WORKSPACE_ROLE.Owner ||
    membership.role === WORKSPACE_ROLE.Editor;
  const isOwner = membership.role === WORKSPACE_ROLE.Owner;

  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <header className="border-b bg-card/50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emphasis">
              Workspace / {membership.role.toLowerCase()}
            </p>
            <h1 className="font-display mt-2 truncate text-3xl font-semibold">
              {workspace.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {workspace.description || "A shared space for focused writing."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link
                href={`/workspace/${workspaceSlug}/settings`}
                prefetch={false}
              >
                <Settings2 data-icon="inline-start" />
                Settings
              </Link>
            </Button>
            {canEdit ? (
              <Button asChild>
                <Link href={`/workspace/${workspaceSlug}/doc/new`}>
                  <Plus data-icon="inline-start" />
                  New document
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:px-8">
        <section className="min-w-0">
          <div className="mb-4 flex items-end justify-between border-b border-divider pb-3">
            <div>
              <h2 className="text-lg font-semibold">Documents</h2>
              <p className="text-sm text-content-secondary">
                {documentCount} total
                {documentPage.nextCursor === null
                  ? ""
                  : `, ${documentPage.documents.length} shown`}
              </p>
            </div>
          </div>
          <WorkspaceHome
            documents={documentPage.documents}
            workspaceSlug={workspaceSlug}
          />
        </section>

        <aside>
          <div className="mb-4 flex items-center justify-between border-b pb-3">
            <div>
              <h2 className="text-lg font-semibold">Members</h2>
              <p className="text-sm text-muted-foreground">
                {members.length} people
              </p>
            </div>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            {members.slice(0, 8).map((member) => (
              <div
                className="flex items-center gap-3 rounded-xl px-2 py-2"
                key={member.member_id}
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage alt="" src={member.avatar_src ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {initials(member.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.full_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email ?? member.role.toLowerCase()}
                  </p>
                </div>
                {member.role === WORKSPACE_ROLE.Owner ? (
                  <Badge>Owner</Badge>
                ) : null}
              </div>
            ))}
          </div>
          {isOwner ? (
            <Button asChild className="mt-4 w-full" size="sm" variant="outline">
              <Link
                href={`/workspace/${workspaceSlug}/settings?tab=members`}
                prefetch={false}
              >
                Manage members
              </Link>
            </Button>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
