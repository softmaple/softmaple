"use client";

import type { FC, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import type { DocsType } from "@/types/model";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { WorkspaceDocsList } from "@/modules/workspaces/workspace-docs-list";
import { WorkspaceNavigation } from "@/modules/workspaces/workspace-navigation";

export type WorkspaceMobileNavProps = {
  readonly canEdit: boolean;
  readonly children?: ReactNode;
  readonly documents: ReadonlyArray<DocsType["Row"]>;
  readonly workspaceSlug: string;
};

/**
 * Mobile workspace chrome: a bar pinned to the bottom of the shell whose menu
 * button opens the navigation tree as a bottom sheet, so the trigger and the
 * surface it reveals both sit under the thumb rather than at arm's reach.
 */
export const WorkspaceMobileNav: FC<WorkspaceMobileNavProps> = ({
  canEdit,
  children,
  documents,
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
      {/*
        The bar is a flex sibling of the scrolling content rather than a fixed
        overlay, so the shell reserves its height and nothing hides behind it.
      */}
      <nav
        aria-label="Workspace"
        className="shrink-0 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="flex h-16 items-center gap-2 px-3">
          <div className="min-w-0 flex-1">{children}</div>
          <SheetTrigger asChild>
            <Button
              aria-label="Open workspace navigation"
              className="shrink-0"
              size="icon-lg"
              variant="outline"
            >
              <Menu />
            </Button>
          </SheetTrigger>
        </div>
      </nav>
      {/*
        A definite height (not just the side's cap) gives the document list a
        resolvable flex basis, so it scrolls inside the sheet instead of
        stretching it. Scrolling stays with that list, hence overflow-y-hidden.
      */}
      <SheetContent
        className="flex h-[85dvh] min-h-0 flex-col gap-0 overflow-y-hidden"
        side="bottom"
      >
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Browse workspace sections and documents.
        </SheetDescription>
        <div className="shrink-0 border-b px-4 pb-3 pt-2">
          <Link
            className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            href="/dashboard"
            onClick={close}
          >
            <SoftmapleWordmark className="text-lg" />
          </Link>
        </div>
        <WorkspaceNavigation onNavigate={close} workspaceSlug={workspaceSlug} />
        <WorkspaceDocsList
          canEdit={canEdit}
          documents={documents}
          onNavigate={close}
          workspaceSlug={workspaceSlug}
        />
      </SheetContent>
    </Sheet>
  );
};
