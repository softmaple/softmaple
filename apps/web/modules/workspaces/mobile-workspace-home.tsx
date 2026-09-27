"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  Folder,
  Home,
  LayoutGrid,
  List,
  Menu,
  MoreVertical,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import { cn } from "@softmaple/ui/lib/utils";
import type { HomeDocument, HomeProps } from "./home-types";
import { HomeAvatars, writersAsPeople } from "./home-avatar";
import { homeMaple } from "./home-styles";
import { HomeActionLink } from "./home-motion";
import {
  BrushUnderline,
  PaperEntrance,
  paperSerif,
  paperSurface,
  WorkspaceAccount,
  WorkspaceBrand,
} from "./workspace-paper";
import { ModeToggle } from "@/components/mode-toggle";
import {
  describeHappeningNow,
  describeLatestWords,
  describeWriterCount,
  hasOtherWriters,
} from "./writing-activity";

type Section = "Home" | "Documents" | "Shared";
export function MobileWorkspaceHome(props: HomeProps) {
  const [filter, setFilter] = useState("Recent");
  const [section, setSection] = useState<Section>("Home");
  const [query, setQuery] = useState("");
  const [grid, setGrid] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<HomeDocument | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef<HTMLElement>(null);
  const current = props.workspaces.find((w) => w.slug === props.workspaceSlug);
  const firstName =
    (props.profile.full_name ?? "").trim().split(/\s+/)[0] || "there";
  const visible = props.documents.filter(
    (doc) =>
      doc.title
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()) &&
      (filter !== "Shared" || doc.is_public),
  );
  const featured = props.activity?.documents[0];
  const navigate = (next: Section) => {
    setSection(next);
    setFilter(next === "Shared" ? "Shared" : "Recent");
    if (next === "Home") {
      setQuery("");
      scrollRef.current?.scrollTo({ top: 0 });
    } else docsRef.current?.scrollIntoView({ block: "start" });
  };
  return (
    <div
      className={`${paperSurface} flex h-dvh flex-col pt-[env(safe-area-inset-top)]`}
    >
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-11"
              aria-label="Open workspace navigation"
            >
              <Menu className="size-6" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            showCloseButton
            className={`${paperSurface} px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]`}
          >
            <SheetTitle>Workspace navigation</SheetTitle>
            <SheetDescription>Make room for your next idea.</SheetDescription>
            <Button asChild variant="outline" className="h-11">
              <Link href={`/workspace/${props.workspaceSlug}/settings`}>
                <Settings />
                Workspace settings
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11">
              <Link href="/dashboard">All workspaces</Link>
            </Button>
            <div className="flex items-center justify-between py-2">
              Appearance
              <ModeToggle />
            </div>
          </SheetContent>
        </Sheet>
        <Link href="/dashboard" aria-label="Softmaple dashboard">
          <WorkspaceBrand />
        </Link>
        <WorkspaceAccount profile={props.profile} />
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        ref={scrollRef}
      >
        <main className="px-5 pb-5">
          <Sheet open={switchOpen} onOpenChange={setSwitchOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                className={`${paperSerif} mb-1 h-9 max-w-full justify-start rounded-full`}
              >
                <Folder />
                <span className="truncate">
                  {current?.title ?? "Workspace"}
                </span>
                <ChevronDown />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              showCloseButton
              className={`${paperSurface} px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]`}
            >
              <SheetTitle>Switch workspace</SheetTitle>
              <SheetDescription>Your spaces for ideas.</SheetDescription>
              <nav className="flex flex-col gap-1">
                {props.workspaces.map((w) => (
                  <Link
                    key={w.id}
                    onClick={() => setSwitchOpen(false)}
                    href={`/workspace/${w.slug}`}
                    className="flex min-h-12 items-center gap-3 rounded-md px-3 hover:bg-accent"
                    aria-current={
                      w.slug === props.workspaceSlug ? "page" : undefined
                    }
                  >
                    <Folder className="size-4 shrink-0" />
                    <span className="truncate">{w.title}</span>
                    {w.slug === props.workspaceSlug ? (
                      <Check className="ml-auto size-4 shrink-0" />
                    ) : null}
                  </Link>
                ))}
                <Link
                  className="min-h-12 border-t border-border px-3 py-4 text-sm"
                  href="/dashboard"
                >
                  All workspaces
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
          <PaperEntrance>
            <section
              className="relative isolate -mr-5 overflow-hidden pb-3 pt-2"
              aria-label="Welcome"
            >
              <div
                aria-hidden="true"
                className={cn(
                  homeMaple,
                  "pointer-events-none absolute -right-20 -top-7 -z-1 size-72 opacity-15 dark:opacity-25",
                )}
              />
              <h1
                className={`${paperSerif} max-w-[85%] text-[34px] leading-[1.08] tracking-tight`}
              >
                Hello,
                <br />
                <BrushUnderline>
                  <span className="inline-block max-w-full truncate align-bottom">
                    {firstName}
                  </span>
                </BrushUnderline>
              </h1>
              <p
                className={`${paperSerif} mt-3 text-base text-muted-foreground`}
              >
                A little space for your next idea.
              </p>
            </section>
            <label className="flex h-12 items-center gap-3 rounded-full border border-input/70 bg-muted/40 px-4">
              <Search className="size-5 shrink-0 text-muted-foreground" />
              <input
                aria-label="Search your notes"
                className={`${paperSerif} min-w-0 flex-1 bg-transparent text-base outline-none`}
                placeholder="Search your notes…"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <section className="mt-4" aria-labelledby="mobile-activity">
              <div className="mb-2 flex items-center justify-between">
                <h2
                  id="mobile-activity"
                  className={`${paperSerif} text-xl font-semibold`}
                >
                  Happening now
                </h2>
                {props.visualFixture ? (
                  <span className="text-xs text-muted-foreground">Preview</span>
                ) : featured ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full bg-(--workspace-live)"
                    />
                    {describeWriterCount(featured.writers.length)} writing
                  </span>
                ) : null}
              </div>
              <article className="flex gap-4 rounded-xl border border-border bg-card/80 p-3 shadow-sm">
                <DocumentThumbnail large />
                <div className="min-w-0 flex-1">
                  <h3
                    id="mobile-activity-title"
                    className={`${paperSerif} line-clamp-2 break-words text-lg font-semibold leading-tight`}
                  >
                    {featured?.title ?? "A place for good ideas"}
                  </h3>
                  <p
                    className={`${paperSerif} mt-1 text-sm leading-5 text-muted-foreground`}
                  >
                    {featured && props.activity
                      ? `${describeHappeningNow(featured)} ${describeLatestWords(featured, props.activity.observedAt)}`
                      : props.activity === null
                        ? "Live activity is unavailable right now. Open a document to keep writing."
                        : "No one is writing right now. Open a document to write together."}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {featured ? (
                      <HomeAvatars
                        people={writersAsPeople(featured.writers)}
                        avatarClassName="size-7"
                      />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Quiet for now
                      </span>
                    )}
                    {featured ? (
                      <Link
                        aria-describedby="mobile-activity-title"
                        className="flex min-h-11 items-center gap-1 text-sm text-(--workspace-link)"
                        href={`/workspace/${props.workspaceSlug}/doc/${featured.slug}`}
                      >
                        {hasOtherWriters(featured) ? "Join" : "Keep writing"}
                        <ArrowRight className="size-4" />
                      </Link>
                    ) : (
                      <button
                        className="flex min-h-11 items-center gap-1 text-sm text-(--workspace-link)"
                        onClick={() => navigate("Documents")}
                      >
                        Browse
                        <ArrowRight className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            </section>
            <section
              className="mt-4 scroll-mt-3"
              ref={docsRef}
              aria-label="Your documents"
            >
              <div className="flex items-center justify-between">
                <h2 className={`${paperSerif} text-xl font-semibold`}>
                  Your documents
                </h2>
                <div className="flex gap-1">
                  <Button
                    variant={grid ? "ghost" : "secondary"}
                    size="icon"
                    className="size-11 rounded-full"
                    aria-label="List view"
                    aria-pressed={!grid}
                    onClick={() => setGrid(false)}
                  >
                    <List />
                  </Button>
                  <Button
                    variant={grid ? "secondary" : "ghost"}
                    size="icon"
                    className="size-11 rounded-full"
                    aria-label="Grid view"
                    aria-pressed={grid}
                    onClick={() => setGrid(true)}
                  >
                    <LayoutGrid />
                  </Button>
                </div>
              </div>
              <div
                className="mb-1 flex gap-2"
                role="group"
                aria-label="Document filters"
              >
                {["Recent", "Shared", "Favorites"].map((label) => (
                  <Button
                    key={label}
                    variant={filter === label ? "secondary" : "outline"}
                    className={`${paperSerif} h-11 rounded-full px-4`}
                    disabled={label === "Favorites"}
                    title={
                      label === "Favorites"
                        ? "Favorites are coming soon"
                        : label === "Shared"
                          ? "Documents shared publicly"
                          : undefined
                    }
                    aria-pressed={filter === label}
                    onClick={() => {
                      setFilter(label);
                      if (section !== "Home")
                        setSection(label === "Shared" ? "Shared" : "Documents");
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className={cn(grid && "grid grid-cols-2 gap-3")}>
                {visible.map((doc) => (
                  <article
                    key={doc.id}
                    className={cn(
                      "flex min-w-0 items-center gap-2 border-b border-border py-1.5",
                      grid && "flex-wrap rounded-lg border p-3",
                    )}
                  >
                    <Link
                      className="flex min-w-0 flex-1 items-center gap-4"
                      href={`/workspace/${props.workspaceSlug}/doc/${doc.slug}`}
                    >
                      <DocumentThumbnail />
                      <span className="min-w-0">
                        <span
                          className={`${paperSerif} block truncate text-base`}
                          title={doc.title}
                        >
                          {doc.title}
                        </span>
                        <span
                          className={`${paperSerif} mt-1 block text-sm text-muted-foreground`}
                        >
                          Edited{" "}
                          {doc.displayTime ??
                            (doc.updated_at
                              ? new Date(doc.updated_at).toLocaleDateString(
                                  "en",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    timeZone: "UTC",
                                  },
                                )
                              : "just now")}
                        </span>
                      </span>
                    </Link>
                    {doc.people && !grid ? (
                      <HomeAvatars
                        people={doc.people.slice(0, 2)}
                        avatarClassName="size-6"
                      />
                    ) : null}
                    <Button
                      className="size-11 shrink-0"
                      size="icon"
                      variant="ghost"
                      aria-label={`Actions for ${doc.title}`}
                      onClick={() => setSelected(doc)}
                    >
                      <MoreVertical />
                    </Button>
                  </article>
                ))}
              </div>
              {!visible.length ? (
                <p className="py-8 text-sm text-muted-foreground" role="status">
                  {query
                    ? "No notes match your search."
                    : filter === "Shared"
                      ? "No publicly shared documents yet."
                      : "Your next idea starts with a new note."}
                </p>
              ) : null}
              {props.documentCount > props.documents.length ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing {props.documents.length} of {props.documentCount}{" "}
                  documents.
                </p>
              ) : null}
            </section>
          </PaperEntrance>
        </main>
      </div>
      {props.canEdit ? (
        <div className="flex shrink-0 justify-center bg-background py-2">
          <HomeActionLink
            href={`/workspace/${props.workspaceSlug}/doc/new`}
            className={`${paperSerif} flex h-11 w-44 items-center justify-center gap-4 rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-sm`}
          >
            <Plus className="size-5" />
            New note
          </HomeActionLink>
        </div>
      ) : null}
      <nav
        aria-label="Mobile workspace"
        className="grid shrink-0 grid-cols-3 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
      >
        {[
          { label: "Home", icon: Home },
          { label: "Documents", icon: FileText },
          { label: "Shared", icon: Users },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            onClick={() => navigate(label as Section)}
            aria-current={section === label ? "page" : undefined}
            className={cn(
              `${paperSerif} flex min-h-14 flex-col items-center justify-center gap-1 text-xs`,
              section === label && "text-(--workspace-link)",
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton
          className={`${paperSurface} px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]`}
        >
          <SheetTitle className="truncate">{selected?.title}</SheetTitle>
          <SheetDescription>Document actions</SheetDescription>
          {selected ? (
            <Button asChild className="h-11">
              <Link
                href={`/workspace/${props.workspaceSlug}/doc/${selected.slug}`}
              >
                Open document
                <ArrowRight />
              </Link>
            </Button>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DocumentThumbnail({ large = false }: { large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex h-12 w-10 shrink-0 flex-col gap-1 overflow-hidden rounded border border-border bg-[#faf7ed] px-1.5 py-2",
        large && "h-20 w-16 gap-1.5 p-2.5",
      )}
    >
      <span className="h-px w-4/5 bg-[#d5cbb9]" />
      <span className="h-px bg-[#d5cbb9]" />
      <span className="h-px w-3/4 bg-[#d5cbb9]" />
      <span className="h-px bg-[#d5cbb9]" />
      <span className="absolute -bottom-2 -right-4 h-7 w-14 -rotate-25 bg-[url('/loading/brush.svg')] bg-size-[100%_100%] bg-no-repeat opacity-50" />
    </span>
  );
}
