"use client";
import Link from "next/link";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Home,
  FileText,
  Users,
  Star,
  Plus,
  Search,
  UserPlus,
  Settings,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { LandingBrand } from "@/components/landing/Brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@softmaple/ui/components/dropdown-menu";
import { HomeAvatar } from "./home-avatar";
import { SPACE_EXAMPLES } from "./home-static-data";
import type { HomeProps } from "./home-types";

export function HomeSidebar({
  profile,
  workspaceSlug,
  workspaces,
  onSearch,
  onHome,
  onDocuments,
  close,
}: Pick<HomeProps, "profile" | "workspaceSlug" | "workspaces"> & {
  onSearch: () => void;
  onHome: () => void;
  onDocuments: () => void;
  close?: () => void;
}) {
  const { setTheme } = useTheme();
  const workspace = workspaces.find((item) => item.slug === workspaceSlug);
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--ws-sidebar)]">
      <div className="pl-5 pr-[14px] pt-[25px]">
        <Link
          href="/dashboard"
          className="workspace-wordmark ml-2 inline-flex"
          aria-label="Softmaple dashboard"
        >
          <LandingBrand />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger className="mt-[23px] flex h-[43px] w-full items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <Building2 className="size-[19px] shrink-0" />
            <span className="truncate">{workspace?.title ?? "Workspace"}</span>
            <ChevronDown className="ml-auto size-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="workspace-home w-60" align="start">
            {workspaces.map((item) => (
              <DropdownMenuItem asChild key={item.id}>
                <Link href={`/workspace/${item.slug}`} onClick={close}>
                  {item.title}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard">All workspaces</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                prefetch={false}
                href={`/workspace/${workspaceSlug}/settings`}
              >
                <Settings className="size-4" />
                Workspace settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          className="mt-[18px] flex h-[41px] w-full items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground"
          onClick={() => {
            onSearch();
            close?.();
          }}
        >
          <Search className="size-5" />
          <span>Search</span>
          <kbd className="ml-auto text-xs">⌘ K</kbd>
        </button>
        <nav
          aria-label="Workspace sections"
          className="mt-6 flex flex-col gap-1"
        >
          <button
            className="ws-nav bg-secondary font-medium"
            aria-current="page"
            onClick={() => {
              onHome();
              close?.();
            }}
          >
            <Home />
            Home
          </button>
          <button
            className="ws-nav"
            onClick={() => {
              onDocuments();
              close?.();
            }}
          >
            <FileText />
            All documents
          </button>
          <button
            className="ws-nav"
            disabled
            title="Shared document filtering is not available yet"
          >
            <Users />
            Shared with me
          </button>
          <button
            className="ws-nav"
            disabled
            title="Favorites are not available yet"
          >
            <Star />
            Favorites
          </button>
        </nav>
        <section aria-label="Spaces preview" className="mt-9">
          <div className="mb-2 flex items-center justify-between px-2 text-[11px] font-semibold tracking-[.09em] text-muted-foreground">
            <h2>SPACES</h2>
            <button
              disabled
              aria-label="Add space — coming soon"
              title="Spaces are a visual preview"
            >
              <Plus className="size-[18px]" />
            </button>
          </div>
          {SPACE_EXAMPLES.map((space) => (
            <button
              key={space.name}
              disabled
              title="Spaces are a visual preview"
              className="ws-nav h-11 w-full"
            >
              <span
                className="size-[14px] shrink-0 rounded-full"
                style={{ background: space.color }}
              />
              {space.name}
            </button>
          ))}
        </section>
      </div>
      <footer className="mx-5 mt-auto border-t border-border pb-9 pt-3">
        <Link
          prefetch={false}
          href={`/workspace/${workspaceSlug}/settings?tab=members`}
          className="flex h-12 items-center gap-4 px-2 text-[13px]"
          onClick={close}
        >
          <UserPlus className="size-[22px]" />
          Invite teammates
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="mt-4 flex w-full min-w-0 items-center gap-3 text-left"
            aria-label="Account menu"
          >
            <HomeAvatar
              person={{
                ...profile,
                full_name: profile.full_name || "Your account",
              }}
              className="size-10"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {profile.full_name || "Your account"}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {profile.email}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="workspace-home w-52" align="start">
            <DropdownMenuItem asChild>
              <Link href="/settings/account">Account settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href={`/workspace/${workspaceSlug}/settings`}
                prefetch={false}
              >
                Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="size-4" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="size-4" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              System theme
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </footer>
    </div>
  );
}
