"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Clock3,
  FileText,
  FolderPlus,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@softmaple/ui/components/empty";
import { SearchField } from "@/components/search-field";
import { CreateWorkspaceDialog } from "@/modules/workspaces/create-workspace-dialog";
import type { WorkspaceSummary } from "@/app/actions/workspaces";

export const Dashboard = ({
  workspaces,
}: {
  readonly workspaces: WorkspaceSummary[];
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const query = searchQuery.trim().toLowerCase();
  const filteredWorkspaces = workspaces.filter(
    (workspace) =>
      workspace.title.toLowerCase().includes(query) ||
      workspace.description?.toLowerCase().includes(query),
  );

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 lg:py-14">
      <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Your writing studio</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Room for your next idea.
          </h1>
          <p className="mt-4 text-muted-foreground">
            Pick up a shared project, or give a new thought a home.
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus data-icon="inline-start" /> New workspace
        </Button>
      </div>
      <section aria-labelledby="workspaces-heading">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 id="workspaces-heading" className="text-lg font-semibold">
              Your workspaces
            </h2>
            <Badge variant="secondary">{workspaces.length}</Badge>
          </div>
          {workspaces.length > 0 ? (
            <div className="w-full sm:max-w-xs">
              <SearchField
                label="Search workspaces"
                value={searchQuery}
                onChange={setSearchQuery}
              />
            </div>
          ) : null}
        </div>
        {workspaces.length === 0 ? (
          <Empty className="min-h-80 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderPlus />
              </EmptyMedia>
              <EmptyTitle>Create your first workspace</EmptyTitle>
              <EmptyDescription>
                A home for your documents and the people you write with.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setShowCreateDialog(true)}>
                Create workspace <ArrowUpRight data-icon="inline-end" />
              </Button>
            </EmptyContent>
          </Empty>
        ) : filteredWorkspaces.length === 0 ? (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>No workspaces found</EmptyTitle>
              <EmptyDescription>
                No workspace matches “{searchQuery}”. Try another name.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                Clear search
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredWorkspaces.map((workspace) => (
              <Link
                className="group flex min-w-0 flex-col rounded-2xl border bg-card p-6 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                href={`/workspace/${workspace.slug}`}
                key={workspace.id}
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-12 place-items-center rounded-xl bg-secondary font-display text-xl font-semibold text-primary">
                    {workspace.title.slice(0, 1).toUpperCase()}
                  </span>
                  <ArrowUpRight className="size-5 text-muted-foreground transition-colors group-hover:text-primary" />
                </div>
                <h3 className="mt-7 truncate font-display text-xl font-semibold tracking-tight">
                  {workspace.title}
                </h3>
                <p className="mt-2 line-clamp-2 min-h-12 text-sm leading-6 text-muted-foreground">
                  {workspace.description ||
                    "A shared space for your next chapter."}
                </p>
                <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <FileText className="size-3.5" />
                    {workspace.documentCount} documents
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    {workspace.memberCount} members
                  </span>
                </div>
                <p className="mt-5 flex items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  {workspace.lastEditedAt === null
                    ? "Ready for the first word"
                    : `Edited ${new Date(workspace.lastEditedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
      <CreateWorkspaceDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </main>
  );
};
