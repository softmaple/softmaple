import type { ReactNode } from "react";
import { Suspense } from "react";

import { cachedGetWorkspaces } from "@/app/actions/workspaces";
import { listWorkspaceDocumentPage } from "@/app/actions/documents/documents";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
import { requireWorkspaceRouteData } from "@/lib/actions/workspace-route";
import { WORKSPACE_ROLE } from "@/lib/workspace-roles";
import { WorkspaceShell } from "@/modules/workspaces/workspace-shell";
import { WorkspaceDropdown } from "@/modules/workspaces/workspace-dropdown";
import { WorkspaceMobileNav } from "@/modules/workspaces/workspace-mobile-nav";

/** First page only; the navigator pages and searches from the database. */
const WORKSPACE_DOCUMENT_PAGE_SIZE = 25;

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
          listWorkspaceDocumentPage({
            limit: WORKSPACE_DOCUMENT_PAGE_SIZE,
            workspaceId: currentWorkspace.id,
          }),
          getWorkspaceMemberByUserId(currentWorkspace.id),
        ]);
  const documentPage =
    documentsResource === null
      ? null
      : requireWorkspaceRouteData(documentsResource, {
          ...failureContext,
          operation: "list_workspace_documents",
        });
  const documents = documentPage?.documents ?? [];
  const initialCursor = documentPage?.nextCursor ?? null;
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
    <div className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-workspace md:flex-row">
      <WorkspaceShell
        canEdit={canEdit}
        documents={documents}
        initialCursor={initialCursor}
        switcher={
          <WorkspaceDropdown
            workspaceSlug={workspaceSlug}
            workspaces={workspaces}
          />
        }
        workspaceId={currentWorkspace?.id ?? 0}
        workspaceSlug={workspaceSlug}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Suspense>{children}</Suspense>
      </div>

      {/*
        Last in the column so the mobile bar lands at the bottom of the shell
        and the content keeps the reading order; `md:hidden` retires it once
        the desktop sidebar takes over.
      */}
      <WorkspaceMobileNav
        canEdit={canEdit}
        documents={documents}
        initialCursor={initialCursor}
        workspaceId={currentWorkspace?.id ?? 0}
        workspaceSlug={workspaceSlug}
      >
        <WorkspaceDropdown
          compact
          workspaceSlug={workspaceSlug}
          workspaces={workspaces}
        />
      </WorkspaceMobileNav>
    </div>
  );
}
