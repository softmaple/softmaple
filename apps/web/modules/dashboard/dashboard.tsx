"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Mail,
  MoreHorizontal,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@softmaple/ui/lib/utils";
import { Button } from "@softmaple/ui/components/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@softmaple/ui/components/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@softmaple/ui/components/dropdown-menu";
import { SearchField } from "@/components/search-field";
import { CreateWorkspaceDialog } from "@/modules/workspaces/create-workspace-dialog";
import type { WorkspaceSummary } from "@/app/actions/workspaces";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@softmaple/ui/components/sheet";
import {
  BrushUnderline,
  PaperEntrance,
  paperSerif,
  paperSurface,
  WorkspaceIcon,
} from "@/modules/workspaces/workspace-paper";
import { useMobileWorkspace } from "@/modules/workspaces/use-mobile-workspace";
import { MapleMark } from "@/components/landing/Brand";
import { homeMaple } from "@/modules/workspaces/home-styles";

const count = (value: number, noun: string): string =>
  `${value} ${value === 1 ? noun : `${noun}s`}`;

const shortDate = (value: string): string =>
  new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** What the card footer can truthfully say about recent activity. */
const activityLabel = (workspace: WorkspaceSummary): string => {
  if (workspace.lastEditedAt)
    return `Updated ${shortDate(workspace.lastEditedAt)}`;
  if (workspace.documentCount === 0) return "Ready for your first idea";
  return `Created ${shortDate(workspace.created_at)}`;
};

/** Desktop keeps a compact menu; phones get a thumb-friendly sheet. */
function WorkspaceActions({
  workspace,
  mobile,
  onOpenSheet,
}: {
  readonly workspace: WorkspaceSummary;
  readonly mobile: boolean;
  readonly onOpenSheet: () => void;
}) {
  const trigger = (
    <Button
      size="icon"
      variant="ghost"
      className="-mr-2 -mt-2 min-h-11 min-w-11"
      aria-label={`Actions for ${workspace.title}`}
      onClick={mobile ? onOpenSheet : undefined}
    >
      <MoreHorizontal />
    </Button>
  );
  if (mobile) return trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={`${paperSurface} w-52`}>
        <DropdownMenuItem asChild>
          <Link href={`/workspace/${workspace.slug}`}>
            <ArrowRight />
            Open workspace
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/workspace/${workspace.slug}/settings`}>
            <Settings />
            Workspace settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const Dashboard = ({
  workspaces,
  preview = false,
}: {
  readonly workspaces: WorkspaceSummary[];
  readonly preview?: boolean;
}) => {
  const mobile = useMobileWorkspace();
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selected, setSelected] = useState<WorkspaceSummary | null>(null);
  const query = searchQuery.trim().toLowerCase();
  const filtered = workspaces.filter(
    (w) =>
      w.title.toLowerCase().includes(query) ||
      w.description?.toLowerCase().includes(query),
  );
  return (
    <main className="relative isolate min-h-[calc(100dvh-4rem)] overflow-hidden">
      <div
        aria-hidden="true"
        className={cn(
          homeMaple,
          "pointer-events-none absolute -right-28 -top-28 -z-1 size-[520px] opacity-15 dark:opacity-25 max-md:-right-52",
        )}
      />
      <PaperEntrance className="mx-auto w-full max-w-6xl px-5 pb-8 pt-8 sm:px-8 lg:pt-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em]">
          Your spaces
        </p>
        <h1
          className={`${paperSerif} mt-2 text-4xl leading-tight tracking-tight sm:text-[42px]`}
        >
          A space for <BrushUnderline>every idea.</BrushUnderline>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Choose a workspace and pick up where you left off.
        </p>
        <div className="mb-5 mt-5 grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="col-span-2 [&_[data-slot=input-group]]:h-11 md:[&_[data-slot=input-group]]:h-9 md:col-span-1">
            <SearchField
              label="Find a workspace…"
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>
          {/* Disabled buttons never show a title tooltip, so say why inline. */}
          <Button className="h-11 md:h-9" variant="outline" disabled>
            Join workspace
            <span className="rounded-full border border-border px-1.5 py-px text-[10px] leading-4 font-normal text-muted-foreground">
              Soon
            </span>
          </Button>
          <Button
            className="h-11 md:h-9"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus data-icon="inline-start" />
            Create workspace
          </Button>
        </div>
        <section
          aria-label="Your workspaces"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {filtered.map((workspace) => (
            <article
              key={workspace.id}
              className="min-w-0 rounded-lg border border-border bg-card/80 p-4 shadow-sm"
            >
              <div className="flex items-start gap-4">
                <WorkspaceIcon
                  title={workspace.title}
                  src={workspace.avatar_src}
                  className="size-15"
                />
                <div className="min-w-0 flex-1">
                  <h2
                    className={`${paperSerif} truncate text-base leading-5`}
                    title={workspace.title}
                  >
                    <Link
                      className="rounded-sm hover:underline hover:underline-offset-4"
                      href={`/workspace/${workspace.slug}`}
                    >
                      {workspace.title}
                    </Link>
                  </h2>
                  <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted-foreground">
                    {workspace.description ||
                      "A little room for your next idea."}
                  </p>
                  <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Users aria-hidden="true" className="size-3.5 shrink-0" />
                    {count(workspace.memberCount, "member")} ·{" "}
                    {count(workspace.documentCount, "document")}
                  </p>
                </div>
                <WorkspaceActions
                  workspace={workspace}
                  mobile={mobile}
                  onOpenSheet={() => setSelected(workspace)}
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-1">
                <p className="text-[11px] text-muted-foreground">
                  {activityLabel(workspace)}
                </p>
                <Link
                  className="flex min-h-11 shrink-0 items-center gap-2 text-xs md:min-h-8 text-(--workspace-link) hover:underline hover:underline-offset-4"
                  href={`/workspace/${workspace.slug}`}
                >
                  Open workspace
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
            </article>
          ))}
        </section>
        {filtered.length === 0 ? (
          <Empty className="min-h-64 border bg-card/40">
            <EmptyHeader>
              <EmptyMedia className="w-9 [&_svg]:h-10 [&_svg]:w-9">
                <MapleMark />
              </EmptyMedia>
              <EmptyTitle className={`${paperSerif} text-2xl font-normal`}>
                {workspaces.length
                  ? "No workspaces found"
                  : "Create your first workspace"}
              </EmptyTitle>
              <EmptyDescription>
                {workspaces.length
                  ? "Try another name or clear your search."
                  : "Give your ideas a space of their own."}
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant={workspaces.length ? "outline" : "default"}
              onClick={() =>
                workspaces.length
                  ? setSearchQuery("")
                  : setShowCreateDialog(true)
              }
            >
              {workspaces.length ? "Clear search" : "Create workspace"}
            </Button>
          </Empty>
        ) : null}
        <div className="mt-4 flex items-center gap-4 rounded-lg border border-border bg-card/60 px-5 py-4">
          <Mail
            aria-hidden="true"
            className="size-6 shrink-0 text-(--workspace-link)"
          />
          <div className="text-sm">
            <p>Good ideas grow together.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Workspace invitations are coming soon. Owners can add registered
              accounts in Members.
            </p>
          </div>
        </div>
        <footer className="mt-5 flex items-center justify-center gap-3 text-xs text-muted-foreground">
          <span className="w-6">
            <MapleMark />
          </span>
          <span>
            Same thoughts, <BrushUnderline>brighter tomorrow.</BrushUnderline>
          </span>
        </footer>
      </PaperEntrance>
      <CreateWorkspaceDialog
        preview={preview}
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
      <Sheet
        open={mobile && selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton
          className={`${paperSurface} px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]`}
        >
          <SheetTitle
            className={`${paperSerif} truncate pr-10 text-2xl font-normal tracking-tight`}
          >
            {selected?.title}
          </SheetTitle>
          <SheetDescription>Workspace actions</SheetDescription>
          {selected ? (
            <>
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={`/workspace/${selected.slug}`}>Open workspace</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={`/workspace/${selected.slug}/settings`}>
                  Workspace settings
                </Link>
              </Button>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
};
