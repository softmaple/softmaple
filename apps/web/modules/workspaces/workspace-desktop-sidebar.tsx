"use client";

import { useEffect, useRef, useState, type FC, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Search,
  PanelLeft,
  Users,
  Settings,
  ArrowUpLeft,
} from "lucide-react";
import type { DocsType } from "@/types/model";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { WorkspaceNavigation } from "@/modules/workspaces/workspace-navigation";
import { WorkspaceDocsList } from "@/modules/workspaces/workspace-docs-list";
import { ModeToggle } from "@/components/mode-toggle";
import { useRedesignFlags } from "@/components/redesign-provider";

export type WorkspaceDesktopSidebarProps = {
  readonly canEdit: boolean;
  readonly children?: ReactNode;
  readonly documents: ReadonlyArray<DocsType["Row"]>;
  readonly workspaceSlug: string;
};

export const WorkspaceDesktopSidebar: FC<WorkspaceDesktopSidebarProps> = ({
  canEdit,
  children,
  documents,
  workspaceSlug,
}) => {
  const { shell } = useRedesignFlags();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const navigatorRef = useRef<HTMLDivElement>(null);
  const searchRequested = useRef(false);
  const openSearch = () => {
    searchRequested.current = true;
    setExpanded(true);
    navigatorRef.current
      ?.querySelector<HTMLInputElement>('input[type="search"]')
      ?.focus();
  };
  useEffect(() => {
    if (expanded && searchRequested.current) {
      navigatorRef.current
        ?.querySelector<HTMLInputElement>('input[type="search"]')
        ?.focus();
      searchRequested.current = false;
    }
  }, [expanded]);
  useEffect(() => {
    if (!shell) return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (
          event.target instanceof Element &&
          event.target.closest('input,textarea,select,[contenteditable="true"]')
        )
          return;
        if (!window.matchMedia("(min-width: 768px)").matches) return;
        event.preventDefault();
        searchRequested.current = true;
        setExpanded(true);
        navigatorRef.current
          ?.querySelector<HTMLInputElement>('input[type="search"]')
          ?.focus();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [shell]);
  if (shell)
    return (
      <aside
        className="hidden min-h-0 shrink-0 md:flex"
        aria-label="App navigation"
      >
        <nav className="app-rail" aria-label="Workspace sections">
          <Link
            href="/dashboard"
            className="rail-control mb-5 font-display text-xl font-semibold text-foreground"
            aria-label="All workspaces"
            title="All workspaces"
          >
            s<span className="text-emphasis">.</span>
          </Link>
          <Link
            href={`/workspace/${workspaceSlug}`}
            className="rail-control"
            aria-label="Workspace home"
            title="Home"
            aria-current={
              pathname === `/workspace/${workspaceSlug}` ? "page" : undefined
            }
          >
            <Home size={19} />
          </Link>
          <button
            type="button"
            className="rail-control"
            aria-label="Search documents"
            title="Search documents"
            onClick={openSearch}
          >
            <Search size={19} />
          </button>
          <button
            type="button"
            className="rail-control"
            aria-label="Browse documents"
            title="Browse documents"
            aria-expanded={expanded}
            aria-controls="workspace-navigator"
            onClick={() => setExpanded(!expanded)}
          >
            <PanelLeft size={19} />
          </button>
          <Link
            href={`/workspace/${workspaceSlug}/settings?tab=members`}
            prefetch={false}
            className="rail-control"
            aria-label="Members"
            title="Members"
          >
            <Users size={19} />
          </Link>
          <div className="mt-auto flex flex-col items-center gap-2">
            <ModeToggle />
            <Link
              href={`/workspace/${workspaceSlug}/settings`}
              prefetch={false}
              className="rail-control"
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={19} />
            </Link>
            <Link
              href="/dashboard"
              className="rail-control"
              aria-label="Switch workspace"
              title="Switch workspace"
            >
              <ArrowUpLeft size={18} />
            </Link>
          </div>
        </nav>
        {expanded ? (
          <div
            id="workspace-navigator"
            className="workspace-navigator"
            ref={navigatorRef}
          >
            <div className="border-b p-4">{children}</div>
            <div className="flex items-center justify-between px-4 pt-5">
              <span className="section-label">Documents</span>
              <button
                className="rail-control"
                type="button"
                aria-label="Close document navigator"
                onClick={() => setExpanded(false)}
              >
                <PanelLeft size={17} />
              </button>
            </div>
            <WorkspaceDocsList
              canEdit={canEdit}
              documents={documents}
              workspaceSlug={workspaceSlug}
            />
          </div>
        ) : null}
      </aside>
    );
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex xl:w-72">
      <div className="p-5">
        <Link
          className="mb-4 inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          href="/dashboard"
        >
          <SoftmapleWordmark className="text-xl" />
        </Link>
        {children}
      </div>
      <WorkspaceNavigation workspaceSlug={workspaceSlug} />
      <WorkspaceDocsList
        canEdit={canEdit}
        documents={documents}
        workspaceSlug={workspaceSlug}
      />
    </aside>
  );
};
