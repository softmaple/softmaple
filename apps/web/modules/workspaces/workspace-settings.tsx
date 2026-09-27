"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Mail,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { Textarea } from "@softmaple/ui/components/textarea";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@softmaple/ui/components/dialog";
import { cn } from "@softmaple/ui/lib/utils";
import type { WorkspacesType } from "@/types/model";
import {
  WORKSPACE_ROLE,
  type WorkspaceMemberDirectoryEntry,
  type WorkspaceRole,
} from "@/lib/workspace-roles";
import { deleteWorkspace, updateWorkspace } from "@/app/actions/workspaces";
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

type Workspace = WorkspacesType["Row"];
const categories = [
  { id: "general", label: "General", icon: Settings },
  { id: "members", label: "Members", icon: Users },
  { id: "invitations", label: "Invitations", icon: Mail, unavailable: true },
  {
    id: "permissions",
    label: "Permissions",
    icon: ShieldCheck,
    unavailable: true,
  },
] as const;
const fieldRow =
  "grid gap-2 border-border py-1.5 md:py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] md:gap-8 md:border-b md:last:border-0";

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
  const router = useRouter();
  const isOwner = role === WORKSPACE_ROLE.Owner;
  const [saved, setSaved] = useState({
    title: workspace.title,
    description: workspace.description ?? "",
  });
  const [title, setTitle] = useState(saved.title);
  const [description, setDescription] = useState(saved.description);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const submitting = useRef(false);
  const dirty = title !== saved.title || description !== saved.description;
  const valid =
    title.trim().length > 0 && title.length <= 80 && description.length <= 500;
  const workspaceHref = `/workspace/${workspace.slug}`;
  const category =
    categories.find((item) => item.id === initialTab) ?? categories[0];
  const CategoryIcon = category.icon;
  const reset = () => {
    setTitle(saved.title);
    setDescription(saved.description);
    setFeedback(null);
  };

  // Guard all in-app links (including account/brand), reloads, and tab closes.
  useEffect(() => {
    if (!dirty && !isPending) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("a[href]")) return;
      if (
        isPending ||
        !window.confirm("Discard your unsaved workspace changes?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // The Navigation API can cancel same-document browser Back/Forward before
    // Next.js processes it. The link and beforeunload guards cover other exits.
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    const traverse = (event: Event) => {
      if (
        !("navigationType" in event) ||
        event.navigationType !== "traverse" ||
        !event.cancelable
      )
        return;
      if (
        isPending ||
        !window.confirm("Discard your unsaved workspace changes?")
      )
        event.preventDefault();
    };
    navigation?.addEventListener("navigate", traverse);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => {
      navigation?.removeEventListener("navigate", traverse);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", leave, true);
    };
  }, [dirty, isPending]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const close = () => {
      if (desktop.matches) setSheetOpen(false);
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);

  const save = () => {
    if (!isOwner || !dirty || !valid || submitting.current) return;
    if (preview) {
      setFeedback({
        error: true,
        text: "Design preview only. Changes are not saved.",
      });
      return;
    }
    submitting.current = true;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await updateWorkspace({
          title,
          description,
          workspaceSlug: workspace.slug,
        });
        if (!result.ok) {
          setFeedback({ error: true, text: result.message });
          return;
        }
        const next = {
          title: result.data.title,
          description: result.data.description ?? "",
        };
        setSaved(next);
        setTitle(next.title);
        setDescription(next.description);
        setFeedback({ error: false, text: "Changes saved." });
        router.refresh();
      } catch {
        setFeedback({
          error: true,
          text: "Could not save changes. Please try again.",
        });
      } finally {
        submitting.current = false;
      }
    });
  };

  const navigation = (mobile: boolean) => (
    <nav
      aria-label={mobile ? "Settings categories" : "Workspace settings"}
      className="flex flex-col gap-1"
    >
      {categories.map((item) => {
        const Icon = item.icon;
        const selected = item.id === initialTab;
        const unavailable = "unavailable" in item;
        const content = (
          <>
            <Icon className="size-5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.id === "members" ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {members.length}
              </span>
            ) : null}
            {unavailable ? (
              <span className="text-[10px] font-sans text-muted-foreground">
                Soon
              </span>
            ) : mobile ? (
              selected ? (
                <Check className="size-5" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )
            ) : null}
          </>
        );
        const className = cn(
          "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
          mobile && `${paperSerif} min-h-12 px-4 text-lg`,
          selected
            ? "bg-secondary text-secondary-foreground"
            : "hover:bg-accent",
          unavailable && "cursor-not-allowed opacity-60",
        );
        return unavailable ? (
          <button
            key={item.id}
            disabled
            className={className}
            title={`${item.label} are coming soon`}
          >
            {content}
          </button>
        ) : (
          <Link
            key={item.id}
            className={className}
            aria-current={selected ? "page" : undefined}
            href={`${workspaceHref}/settings${item.id === "members" ? "?tab=members" : ""}`}
            onClick={() => {
              reset();
              setSheetOpen(false);
            }}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );

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
          {navigation(false)}
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
            <div className="md:hidden">
              <div className="flex min-h-11 items-center gap-5">
                <span className="w-6 shrink-0">
                  <MapleMark />
                </span>
                <p className="truncate text-sm">{saved.title}</p>
              </div>
              <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                <SheetTrigger asChild>
                  <Button
                    className="h-12 w-full justify-start gap-4"
                    variant="outline"
                  >
                    <CategoryIcon />
                    {category.label}
                    <ChevronDown className="ml-auto" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="bottom"
                  className={`${paperSurface} gap-2 rounded-t-3xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]`}
                >
                  <div className="flex items-start px-2 pb-2 pt-3">
                    <div className="min-w-0">
                      <SheetTitle
                        className={`${paperSerif} text-2xl font-normal tracking-tight`}
                      >
                        Workspace settings
                      </SheetTitle>
                      <SheetDescription className="mt-1 truncate">
                        {saved.title}
                      </SheetDescription>
                    </div>
                    <SheetClose asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto min-h-11 min-w-11"
                        aria-label="Close settings navigation"
                      >
                        <X />
                      </Button>
                    </SheetClose>
                  </div>
                  {navigation(true)}
                  <Link
                    href={workspaceHref}
                    onClick={() => setSheetOpen(false)}
                    className={`${paperSerif} mx-2 mt-4 flex min-h-16 items-center gap-5 border-t border-border px-2 pt-2 text-lg`}
                  >
                    <ArrowLeft className="size-5" />
                    Back to workspace
                  </Link>
                </SheetContent>
              </Sheet>
            </div>
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
                <>
                  <form
                    id="workspace-settings-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      save();
                    }}
                  >
                    <div className="md:rounded-md md:border md:border-border md:px-5 md:py-1">
                      <div className={fieldRow}>
                        <div>
                          <p className="text-sm font-semibold">
                            Workspace icon
                          </p>
                          <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                            Give your workspace a familiar face.
                          </p>
                        </div>
                        <div className="flex items-center gap-5">
                          <WorkspaceIcon
                            title={saved.title}
                            src={workspace.avatar_src}
                            className="size-18 md:size-14"
                          />
                          <div>
                            <Button variant="outline" disabled className="h-10">
                              <Upload data-icon="inline-start" />
                              Upload image
                            </Button>
                            <p className="mt-2 text-xs text-muted-foreground">
                              Image uploads coming soon.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className={fieldRow}>
                        <Label
                          className="self-start pt-1 text-sm font-semibold"
                          htmlFor="workspace-name"
                        >
                          Workspace name
                        </Label>
                        <div>
                          <Input
                            className="h-10 md:h-8"
                            id="workspace-name"
                            maxLength={80}
                            disabled={!isOwner || isPending}
                            required
                            value={title}
                            aria-invalid={!title.trim()}
                            aria-describedby={
                              !title.trim() ? "workspace-name-error" : undefined
                            }
                            onChange={(event) => setTitle(event.target.value)}
                          />
                          {!title.trim() ? (
                            <p
                              className="mt-1 text-xs text-destructive"
                              id="workspace-name-error"
                            >
                              Workspace name is required.
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className={fieldRow}>
                        <Label
                          className="self-start pt-1 text-sm font-semibold"
                          htmlFor="workspace-description"
                        >
                          Description
                        </Label>
                        <Textarea
                          className="min-h-14 md:min-h-12"
                          id="workspace-description"
                          rows={2}
                          maxLength={500}
                          disabled={!isOwner || isPending}
                          value={description}
                          onChange={(event) =>
                            setDescription(event.target.value)
                          }
                        />
                      </div>
                      <div className={fieldRow}>
                        <div>
                          <Label
                            className="text-sm font-semibold"
                            htmlFor="workspace-url"
                          >
                            Workspace URL
                          </Label>
                          <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                            This link stays the same when renamed.
                          </p>
                        </div>
                        <div className="flex min-w-0 items-stretch overflow-hidden rounded-md border border-input text-xs">
                          <span className="flex shrink-0 items-center border-r border-input bg-muted/70 px-3 text-muted-foreground">
                            /workspace/
                          </span>
                          <input
                            id="workspace-url"
                            className="h-10 min-w-0 flex-1 bg-transparent px-3 md:h-8"
                            value={workspace.slug}
                            readOnly
                            title={`${workspaceHref} (read-only)`}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-border bg-background px-6 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] md:static md:justify-end md:border-0 md:bg-transparent md:px-0 md:py-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 flex-1 md:h-9 md:flex-none md:min-w-24"
                        disabled={!dirty || isPending}
                        onClick={reset}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        className="h-11 flex-[1.5] md:h-9 md:flex-none md:min-w-36"
                        disabled={!isOwner || !dirty || !valid || isPending}
                      >
                        {isPending ? "Saving…" : "Save changes"}
                      </Button>
                    </div>
                  </form>
                  {!isOwner ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Only workspace owners can edit these details or delete
                      this workspace.
                    </p>
                  ) : null}
                  <section
                    aria-label="Danger zone"
                    className="mt-3 border-t border-border pt-4 md:rounded-md md:border md:border-destructive/40 md:px-5 md:py-3"
                  >
                    <h2
                      className={`${paperSerif} mb-2 hidden text-lg text-destructive md:block`}
                    >
                      Danger zone
                    </h2>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3
                          className={`${paperSerif} text-lg text-destructive md:font-sans md:text-sm md:font-medium md:text-foreground`}
                        >
                          Delete workspace
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Permanently delete this workspace and its documents.
                        </p>
                      </div>
                      <Button
                        className="h-11 self-start border-destructive text-destructive md:h-9 md:self-center"
                        variant="outline"
                        disabled={!isOwner || isPending}
                        onClick={() => {
                          setConfirmation("");
                          setFeedback(null);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 data-icon="inline-start" />
                        Delete workspace
                      </Button>
                    </div>
                  </section>
                  <p className="mt-2 hidden text-right text-[11px] text-muted-foreground md:block">
                    Only workspace owners can delete this workspace.
                  </p>
                </>
              )}
            </PaperEntrance>
          </div>
        </main>
      </div>
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!isPending) setDeleteOpen(open);
        }}
      >
        <DialogContent className={paperSurface}>
          <DialogTitle>Delete workspace</DialogTitle>
          <DialogDescription>
            This permanently deletes all documents and collaboration history.
            Enter “{saved.title}” to confirm.
          </DialogDescription>
          <Label htmlFor="delete-confirmation">
            Workspace name confirmation
          </Label>
          <Input
            id="delete-confirmation"
            disabled={isPending}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {feedback?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {feedback.text}
            </p>
          ) : null}
          <Button
            variant="destructive"
            disabled={preview || confirmation !== saved.title || isPending}
            onClick={() => {
              if (preview || submitting.current) return;
              submitting.current = true;
              startTransition(async () => {
                try {
                  const result = await deleteWorkspace({
                    confirmation,
                    workspaceSlug: workspace.slug,
                  });
                  if (!result.ok) {
                    setFeedback({ error: true, text: result.message });
                    return;
                  }
                  setDeleteOpen(false);
                  router.replace("/dashboard");
                  router.refresh();
                } catch {
                  setFeedback({
                    error: true,
                    text: "Could not delete the workspace. Please try again.",
                  });
                } finally {
                  submitting.current = false;
                }
              });
            }}
          >
            {isPending ? "Deleting…" : "Permanently delete workspace"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
