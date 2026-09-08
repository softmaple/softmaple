"use client";

import type { FC, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, Menu, Settings, Users } from "lucide-react";
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
import {
  MobileNavigation,
  type MobileNavigationItem,
} from "@/components/shell/mobile-navigation";
import { WorkspaceDocsList } from "@/modules/workspaces/workspace-docs-list";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const home = `/workspace/${workspaceSlug}`;
  const settings = `${home}/settings`;
  const onSettings = pathname === settings;
  const membersTab = searchParams.get("tab") === "members";
  // The same destinations as the desktop rail: moving between devices should
  // not mean learning a second map.
  const destinations: ReadonlyArray<MobileNavigationItem> = [
    {
      current: pathname === home,
      href: home,
      icon: <Home className="size-5" />,
      label: "Home",
    },
    {
      current: onSettings && membersTab,
      href: `${settings}?tab=members`,
      icon: <Users className="size-5" />,
      label: "People",
      prefetch: false,
    },
    {
      current: onSettings && !membersTab,
      href: settings,
      icon: <Settings className="size-5" />,
      label: "Settings",
      prefetch: false,
    },
  ];
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
      <MobileNavigation
        items={destinations}
        label="Workspace"
        leading={<div className="min-w-0 max-w-[9rem]">{children}</div>}
        trailing={
          <SheetTrigger asChild>
            <Button
              aria-label="Open workspace navigation"
              className="min-h-touch"
              size="icon-lg"
              variant="outline"
            >
              <Menu />
            </Button>
          </SheetTrigger>
        }
      />
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
