"use client";

import type { FC, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, Plus, X } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import type { DocsType, UsersType } from "@/types/model";
import { LandingBrand } from "@/components/landing/Brand";
import { WorkspaceAccountFooter } from "@/modules/workspaces/workspace-account-footer";
import { WorkspaceDocsList } from "@/modules/workspaces/workspace-docs-list";
import { WorkspaceNavigation } from "@/modules/workspaces/workspace-navigation";

export type WorkspaceMobileNavProps = {
  readonly canEdit: boolean;
  readonly children?: ReactNode;
  readonly documents: ReadonlyArray<DocsType["Row"]>;
  readonly profile: Pick<
    UsersType["Row"],
    "avatar_alt" | "avatar_src" | "email" | "full_name"
  >;
  readonly workspaceSlug: string;
};

/**
 * Mobile workspace chrome: a compact top bar with the complete navigation in
 * a left-hand sheet. Radix owns focus trapping, Escape, overlay dismissal, and
 * returning focus to the menu trigger.
 */
export const WorkspaceMobileNav: FC<WorkspaceMobileNavProps> = ({
  canEdit,
  children,
  documents,
  profile,
  workspaceSlug,
}) => {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <header className="workspace-mobile-header shrink-0 border-b border-sidebar-border bg-background/94 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
        <nav
          aria-label="Workspace"
          className="grid h-14 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 px-3"
        >
          <SheetTrigger asChild>
            <Button
              aria-label="Open workspace navigation"
              className="size-11"
              size="icon"
              variant="ghost"
            >
              <Menu />
            </Button>
          </SheetTrigger>
          <Link
            aria-label="Softmaple dashboard"
            className="mx-auto inline-flex min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            href="/dashboard"
          >
            <span className="font-display truncate text-[1.05rem] font-semibold tracking-[-0.045em]">
              softmaple
            </span>
          </Link>
          {canEdit ? (
            <Button
              aria-label="New document"
              asChild
              className="size-11 bg-[var(--workspace-gold)] text-[var(--workspace-gold-ink)] hover:bg-[var(--workspace-gold-strong)]"
              size="icon"
            >
              <Link href={`/workspace/${workspaceSlug}/doc/new`}>
                <Plus />
              </Link>
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      </header>
      <SheetContent
        className="workspace-mobile-sheet flex h-dvh w-[min(19rem,calc(100vw-2rem))] min-h-0 flex-col gap-0 overflow-y-hidden border-sidebar-border bg-sidebar p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground"
        showCloseButton={false}
        side="left"
      >
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Browse workspace sections and documents.
        </SheetDescription>
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-5">
          <Link
            className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            href="/dashboard"
            onClick={close}
          >
            <LandingBrand className="gap-2 text-[1.25rem] tracking-[-0.05em] [&_svg]:h-7 [&_svg]:w-6" />
          </Link>
          <SheetClose asChild>
            <Button
              aria-label="Close workspace navigation"
              className="size-11"
              size="icon"
              variant="ghost"
            >
              <X />
            </Button>
          </SheetClose>
        </div>
        <div className="shrink-0 px-3 pt-4">{children}</div>
        <WorkspaceDocsList
          canEdit={canEdit}
          documents={documents}
          navigation={
            <WorkspaceNavigation
              onNavigate={close}
              workspaceSlug={workspaceSlug}
            />
          }
          onNavigate={close}
          workspaceSlug={workspaceSlug}
        />
        <WorkspaceAccountFooter onNavigate={close} profile={profile} />
      </SheetContent>
    </Sheet>
  );
};
