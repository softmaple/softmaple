"use client";

import type { FC, ReactNode } from "react";
import { useState } from "react";
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

export type WorkspaceMobileSidebarProps = {
  readonly canEdit: boolean;
  readonly children?: ReactNode;
  readonly documents: ReadonlyArray<DocsType["Row"]>;
  readonly workspaceSlug: string;
};

export const WorkspaceMobileSidebar: FC<WorkspaceMobileSidebarProps> = ({
  canEdit,
  children,
  documents,
  workspaceSlug,
}) => {
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:hidden">
        <SheetTrigger asChild>
          <Button
            aria-label="Open workspace navigation"
            className="shrink-0"
            size="icon-sm"
            variant="outline"
          >
            <Menu className="size-4" />
          </Button>
        </SheetTrigger>
        <div className="min-w-0 flex-1">{children}</div>
      </header>
      <SheetContent
        className="flex h-dvh min-h-0 w-[min(20rem,90vw)] flex-col gap-0 p-0"
        side="left"
      >
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Browse workspace sections and documents.
        </SheetDescription>
        <div className="shrink-0 border-b p-4">
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
