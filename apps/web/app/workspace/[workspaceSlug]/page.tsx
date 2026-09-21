import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Plus, Settings2 } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Badge } from "@softmaple/ui/components/badge";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import {
  countWorkspaceDocuments,
  listWorkspaceDocuments,
} from "@/app/actions/documents/documents";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
import { requireWorkspaceRouteData } from "@/lib/actions/workspace-route";
import { WORKSPACE_ROLE } from "@/lib/workspace-roles";

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
  const [documentsResult, documentCountResult, roleResult] = await Promise.all([
    listWorkspaceDocuments(workspace.id, 5),
    countWorkspaceDocuments(workspace.id),
    getWorkspaceMemberByUserId(workspace.id),
  ]);
  const documents = requireWorkspaceRouteData(documentsResult, {
    ...failureContext,
    operation: "list_workspace_documents",
  });
  const documentCount = requireWorkspaceRouteData(documentCountResult, {
    ...failureContext,
    operation: "count_workspace_documents",
  });
  const membership = requireWorkspaceRouteData(roleResult, {
    ...failureContext,
    operation: "get_workspace_member_by_user_id",
  });

  const canEdit =
    membership.role === WORKSPACE_ROLE.Owner ||
    membership.role === WORKSPACE_ROLE.Editor;
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      <header className="border-b bg-background/70 px-4 py-7 sm:px-7 lg:px-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Workspace / {membership.role.toLowerCase()}
            </p>
            <h1 className="font-display mt-2 truncate text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              {workspace.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {workspace.description || "A shared space for focused writing."}
            </p>
          </div>
          <div className="hidden flex-wrap gap-2 sm:flex">
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
              <Button asChild className="workspace-new-document">
                <Link href={`/workspace/${workspaceSlug}/doc/new`}>
                  <Plus data-icon="inline-start" />
                  New document
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-7 lg:px-10">
        <section className="min-w-0">
          <div className="mb-4 flex items-end justify-between border-b pb-3">
            <div>
              <h2 className="text-lg font-semibold">Recent documents</h2>
              <p className="text-sm text-muted-foreground">
                {documentCount} total
              </p>
            </div>
          </div>
          {documents.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-4 font-medium">No documents yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Give your next idea a page of its own.
              </p>
              {canEdit ? (
                <Button asChild className="mt-5" size="sm">
                  <Link href={`/workspace/${workspaceSlug}/doc/new`}>
                    Create document
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card">
              {documents.map((document) => (
                <Link
                  className="flex min-w-0 items-center gap-4 p-4 transition-colors hover:bg-accent"
                  href={`/workspace/${workspaceSlug}/doc/${document.slug}`}
                  key={document.id}
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border bg-background text-primary">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium">{document.title}</h3>
                    <p className="font-mono text-xs text-muted-foreground">
                      {document.updated_at === null
                        ? "Created just now"
                        : `Edited ${new Date(document.updated_at).toLocaleString()}`}
                    </p>
                  </div>
                  {document.is_public ? (
                    <Badge variant="secondary">Public</Badge>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
