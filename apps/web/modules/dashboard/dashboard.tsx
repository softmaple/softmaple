"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Clock3,
  FileText,
  FolderPlus,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { CreateWorkspaceDialog } from "@/modules/workspaces/create-workspace-dialog";
import type { WorkspaceSummary } from "@/app/actions/workspaces";

export const Dashboard = ({
  workspaces,
}: {
  readonly workspaces: WorkspaceSummary[];
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) return workspaces;
    return workspaces.filter(
      (workspace) =>
        workspace.title.toLowerCase().includes(query) ||
        workspace.description?.toLowerCase().includes(query),
    );
  }, [searchQuery, workspaces]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Workspace index
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Your work, in motion.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Open a shared writing space or start a new one.
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" /> New workspace
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <section className="grid min-h-80 place-items-center rounded-sm border border-dashed bg-card/60 p-8 text-center">
          <div className="max-w-md">
            <FolderPlus className="mx-auto h-10 w-10 text-primary" />
            <h2 className="font-display mt-5 text-2xl font-semibold">
              Create your first workspace
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Workspaces keep documents, collaborators, and permissions
              together.
            </p>
            <Button className="mt-6" onClick={() => setShowCreateDialog(true)}>
              Create workspace
            </Button>
          </div>
        </section>
      ) : (
        <>
          <div className="relative mb-6 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search workspaces"
              value={searchQuery}
            />
          </div>
          <div className="grid gap-px overflow-hidden rounded-sm border bg-border md:grid-cols-2 xl:grid-cols-3">
            {filteredWorkspaces.map((workspace) => (
              <Link
                className="group bg-card p-5 transition-colors hover:bg-accent"
                href={`/workspace/${workspace.slug}`}
                key={workspace.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="grid h-10 w-10 place-items-center rounded-sm border bg-background text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Open workspace
                  </span>
                </div>
                <h2 className="mt-8 text-lg font-semibold group-hover:text-primary">
                  {workspace.title}
                </h2>
                <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                  {workspace.description || "No description yet."}
                </p>
                <div className="mt-6 flex flex-wrap gap-4 border-t pt-4 font-mono text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    {workspace.documentCount}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {workspace.memberCount}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    {workspace.lastEditedAt === null
                      ? "New"
                      : new Date(workspace.lastEditedAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {filteredWorkspaces.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No workspace matches “{searchQuery}”.
            </p>
          ) : null}
        </>
      )}
      <CreateWorkspaceDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </main>
  );
};
