"use client";

import type { FC, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { FileText, Menu } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import type { DocsType } from "@/types/model";
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
    <div className="fixed left-3 top-3 z-50 md:hidden">
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetTrigger asChild>
          <Button
            aria-label="Open workspace navigation"
            size="icon"
            variant="outline"
          >
            <Menu className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent
          className="flex w-[min(20rem,90vw)] flex-col p-0"
          side="left"
        >
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <div className="border-b p-4">
            <Link
              className="mb-4 flex items-center gap-2"
              href="/dashboard"
              onClick={close}
            >
              <span className="grid size-8 place-items-center rounded-sm border bg-background text-primary">
                <FileText className="size-4" />
              </span>
              <span className="font-display font-semibold">Softmaple</span>
            </Link>
            {children}
          </div>
          <WorkspaceNavigation
            onNavigate={close}
            workspaceSlug={workspaceSlug}
          />
          <WorkspaceDocsList
            canEdit={canEdit}
            documents={documents}
            onNavigate={close}
            workspaceSlug={workspaceSlug}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
};
