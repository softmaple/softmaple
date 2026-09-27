"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@softmaple/ui/lib/utils";
import type { WorkspacesType } from "@/types/model";
import {
  WORKSPACE_ROLE,
  type WorkspaceMemberDirectoryEntry,
  type WorkspaceRole,
} from "@/lib/workspace-roles";
import { WorkspaceMembers } from "./workspace-members";
import {
  BrushUnderline,
  PaperEntrance,
  paperSerif,
  paperSurface,
  WorkspaceAccount,
  WorkspaceBrand,
  WorkspaceIcon,
  type WorkspaceProfile,
} from "./workspace-paper";
import { MapleMark } from "@/components/landing/Brand";
import { ModeToggle } from "@/components/mode-toggle";
import { useWorkspaceSettings } from "./settings/use-workspace-settings";
import { WorkspaceSettingsForm } from "./settings/workspace-settings-form";
import { DeleteWorkspaceDialog } from "./settings/delete-workspace-dialog";
import {
  SettingsNavigation,
  MobileSettingsNavigation,
} from "./settings/workspace-settings-navigation";

type Workspace = WorkspacesType["Row"];

export function WorkspaceSettings({
  initialTab,
  members,
  role,
  workspace,
  profile,
  preview = false,
}: {
  readonly initialTab: "general" | "members";
  readonly members: ReadonlyArray<WorkspaceMemberDirectoryEntry>;
  readonly role: WorkspaceRole;
  readonly workspace: Workspace;
  readonly profile?: WorkspaceProfile;
  /** Development fixture: never dispatch real mutations. */
  readonly preview?: boolean;
}) {
  const settings = useWorkspaceSettings({ workspace, role, preview });
  const { saved, feedback, workspaceHref, reset } = settings;
  return (
    <div className={`${paperSurface} min-h-dvh`}>
      <header className="border-border px-5 pt-[env(safe-area-inset-top)] md:border-b md:px-8">
        <div className="flex min-h-14 items-center gap-5 md:min-h-16">
          <Link
            className="hidden md:block"
            href="/dashboard"
            aria-label="Softmaple dashboard"
          >
            <WorkspaceBrand />
          </Link>
          <Link
            href={workspaceHref}
            className="grid size-11 shrink-0 place-items-center md:hidden"
            aria-label="Back to workspace"
          >
            <ArrowLeft className="size-6" />
          </Link>
          <span
            className={`${paperSerif} min-w-0 flex-1 text-xl tracking-tight md:hidden`}
          >
            Workspace settings
          </span>
          <p className="hidden min-w-0 items-center gap-3 border-l border-border pl-5 text-xs md:flex">
            <span className="max-w-64 truncate">{saved.title}</span>
            <span>/</span>Settings
          </p>
          <div className="ml-auto hidden md:block">
            <ModeToggle />
          </div>
          <WorkspaceAccount profile={profile} />
        </div>
      </header>
      <div className="md:grid md:min-h-[calc(100dvh-4rem)] md:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="hidden flex-col border-r border-border px-5 py-4 md:flex">
          <Link
            href={workspaceHref}
            className="mb-6 flex min-h-11 items-center gap-3 text-xs"
          >
            <ArrowLeft className="size-4" />
            Back to workspace
          </Link>
          <p className="mb-3 px-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            Workspace settings
          </p>
          <SettingsNavigation
            initialTab={initialTab}
            memberCount={members.length}
            workspaceHref={workspaceHref}
            onNavigate={reset}
          />
          <div className="mt-auto flex items-center gap-3 border-t border-border pt-5">
            <WorkspaceIcon
              title={saved.title}
              src={workspace.avatar_src}
              className="size-11"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{saved.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {members.length} {members.length === 1 ? "member" : "members"}
              </p>
            </div>
          </div>
        </aside>
        <main className="min-w-0 px-6 pb-28 md:px-10 md:pb-10 lg:px-16">
          <div className="mx-auto max-w-[52rem]">
            <MobileSettingsNavigation
              title={saved.title}
              initialTab={initialTab}
              memberCount={members.length}
              workspaceHref={workspaceHref}
              onNavigate={reset}
            />
            <PaperEntrance key={initialTab}>
              <div className="relative mb-4 mt-5 md:mb-3 md:mt-5">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-5 top-0 hidden size-12 opacity-70 md:block [&_svg]:fill-none [&_svg]:stroke-(--brand-gold) [&_svg]:stroke-[.6]"
                >
                  <MapleMark />
                </span>
                <h1
                  className={`${paperSerif} text-4xl leading-tight tracking-tight md:font-medium`}
                >
                  <BrushUnderline>
                    {initialTab === "general" ? "General" : "Workspace"}
                  </BrushUnderline>{" "}
                  {initialTab === "general" ? "settings" : "members"}
                </h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  {initialTab === "general"
                    ? "Manage the details of your shared space."
                    : "The people who make this space yours."}
                </p>
              </div>
              {feedback ? (
                <p
                  className={cn(
                    "mb-4 rounded-md border p-3 text-sm",
                    feedback.error
                      ? "border-destructive text-destructive"
                      : "border-border",
                  )}
                  role={feedback.error ? "alert" : "status"}
                >
                  {feedback.text}
                </p>
              ) : null}
              {initialTab === "members" ? (
                <WorkspaceMembers
                  workspace={{ ...workspace, title: saved.title }}
                  members={members}
                  role={preview ? WORKSPACE_ROLE.Viewer : role}
                />
              ) : (
                <WorkspaceSettingsForm
                  workspace={workspace}
                  settings={settings}
                />
              )}
            </PaperEntrance>
          </div>
        </main>
      </div>
      <DeleteWorkspaceDialog settings={settings} preview={preview} />
    </div>
  );
}
