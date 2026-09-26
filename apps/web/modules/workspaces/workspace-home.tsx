"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Home, Menu, Plus, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@softmaple/ui/components/dialog";
import { HomeSidebar } from "./home-sidebar";
import { HomeActivity, HomePeople, HomeUpdates } from "./home-activity";
import { HomeContinue, HomeDocuments } from "./home-documents";
import { HomeAvatars } from "./home-avatar";
import type { HomeProps } from "./home-types";
import "./workspace-home.css";

export function WorkspaceHome(props: HomeProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const mobileSearch = useRef<HTMLInputElement>(null);
  const focusSearchAfterClose = useRef(false);
  const updatesTrigger = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const browse = () =>
    document
      .getElementById("workspace-documents")
      ?.scrollIntoView({ block: "start" });
  const search = () => {
    if (window.innerWidth < 768) {
      if (navigationOpen) focusSearchAfterClose.current = true;
      else mobileSearch.current?.focus();
    } else setSearchOpen(true);
  };
  const home = () => {
    setQuery("");
    scroll.current?.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        if (window.innerWidth < 768) mobileSearch.current?.focus();
        else setSearchOpen(true);
      }
    };
    const desktop = window.matchMedia("(min-width: 768px)");
    const onDesktop = () => {
      if (desktop.matches) {
        setNavigationOpen(false);
        setUpdatesOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onDesktop);
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onDesktop);
    };
  }, []);
  const sidebar = (
    <HomeSidebar
      {...props}
      onHome={home}
      onDocuments={browse}
      onSearch={search}
      close={() => setNavigationOpen(false)}
    />
  );
  return (
    <div className="workspace-home flex h-dvh min-w-0 bg-background text-foreground">
      <aside
        className="hidden w-[242px] shrink-0 border-r border-border md:block max-[1100px]:w-[218px]"
        aria-label="Workspace navigation"
      >
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[75px] shrink-0 items-center gap-7 pl-[38px] pr-[29px] max-md:h-11 max-md:justify-between max-md:px-[14px]">
          <div className="hidden items-center gap-3 text-sm md:flex">
            <span className="text-muted-foreground">Workspace</span>
            <span className="text-muted-foreground">/</span>
            <span>Home</span>
          </div>
          <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
            <SheetTrigger
              className="grid size-8 place-items-center md:hidden"
              aria-label="Open workspace navigation"
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent
              side="left"
              onCloseAutoFocus={(event) => {
                if (focusSearchAfterClose.current) {
                  event.preventDefault();
                  focusSearchAfterClose.current = false;
                  mobileSearch.current?.focus();
                }
              }}
              className="workspace-home w-[285px] gap-0 p-0 motion-reduce:animate-none"
            >
              <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Browse workspace sections and account settings.
              </SheetDescription>
              {sidebar}
            </SheetContent>
          </Sheet>
          <span className="ws-serif text-lg font-bold tracking-[-.05em] md:hidden">
            softmaple
          </span>
          <div className="ml-auto hidden items-center gap-1 min-[1100px]:flex">
            <HomeAvatars people={props.members} large />
            {props.visualFixture ? (
              <span className="grid size-9 place-items-center rounded-full bg-muted text-xs text-muted-foreground">
                +2
              </span>
            ) : null}
          </div>
          <div className="ml-auto hidden h-7 border-l border-border md:block min-[1100px]:ml-[65px]" />
          <button
            aria-label="Search documents"
            onClick={search}
            className="hidden size-8 place-items-center md:grid"
          >
            <Search className="size-[23px]" />
          </button>
          {props.canEdit ? (
            <Link
              className="ws-primary flex h-[46px] min-w-[210px] items-center justify-center gap-3 text-[18px] font-medium max-md:h-[30px] max-md:min-w-[35px]"
              href={`/workspace/${props.workspaceSlug}/doc/new`}
              aria-label="New document"
            >
              <Plus className="size-[22px]" />
              <span className="hidden md:inline">New document</span>
            </Link>
          ) : (
            <span className="md:hidden size-8" />
          )}
        </header>
        <div
          ref={scroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="flex min-h-full min-w-0">
            <main className="min-w-0 flex-1 px-[31px] pb-0 pr-[18px] max-md:px-[14px]">
              <div className="mb-[7px] md:hidden">
                <label className="flex h-[30px] items-center gap-2 rounded-md border border-border bg-muted/55 px-2 text-xs text-muted-foreground">
                  <Search className="size-4" />
                  <input
                    ref={mobileSearch}
                    aria-label="Search documents"
                    placeholder="Search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent outline-none"
                    type="search"
                  />
                </label>
              </div>
              <h1 className="mb-1 text-sm font-medium md:hidden">
                Your workspace
              </h1>
              <section
                className="relative -mr-[18px] h-[209px] overflow-hidden pl-[14px] max-md:hidden"
                aria-label="Welcome"
              >
                <div
                  className="ws-maple pointer-events-none absolute -right-[60px] -top-[80px] h-[420px] w-[450px] rotate-[172deg]"
                  aria-hidden="true"
                />
                <h1 className="ws-serif relative z-10 pt-[10px] text-[72px] font-bold leading-[.9] tracking-[-.055em] max-[1400px]:text-[61px] max-[1150px]:text-[56px]">
                  A little space for
                  <br />
                  your{" "}
                  <span className="ws-brush relative isolate whitespace-nowrap">
                    next big idea.
                  </span>
                </h1>
                <p className="relative z-10 mt-[20px] text-[25px] leading-tight tracking-[-.035em] text-muted-foreground max-[1400px]:text-[22px]">
                  Pick up a thought. Make something together.
                </p>
                <p
                  aria-hidden="true"
                  className="ws-hand absolute right-[40px] top-[100px] -rotate-12 text-[24px] leading-[.85] text-muted-foreground max-[1400px]:hidden"
                >
                  Better
                  <br />
                  ideas
                  <br /> together.
                  <span className="ml-8 mt-2 block h-2 w-14 rounded-[50%] border-t border-current" />
                </p>
              </section>
              <HomeActivity {...props} onBrowse={browse} />
              <HomeContinue {...props} onBrowse={browse} />
              <HomeDocuments
                {...props}
                documents={
                  props.visualFixture
                    ? props.documents.filter(
                        (_, index) => index === 0 || index > 3,
                      )
                    : props.documents
                }
                query={query}
              />
            </main>
            <aside
              className="hidden w-[320px] shrink-0 border-l border-border px-[29px] pb-10 pt-[27px] min-[1280px]:block"
              aria-label="People and updates"
            >
              <HomePeople {...props} />
              <HomeUpdates />
            </aside>
          </div>
        </div>
        <nav
          aria-label="Mobile workspace"
          className="grid shrink-0 grid-cols-3 border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <button
            onClick={home}
            className="flex min-h-[52px] flex-col items-center justify-center gap-1 bg-secondary text-[10px]"
            aria-label="Home"
          >
            <Home className="size-5" />
            Home
          </button>
          <button
            onClick={search}
            className="flex min-h-[52px] flex-col items-center justify-center gap-1 text-[10px]"
          >
            <Search className="size-5" />
            Search
          </button>
          <button
            ref={updatesTrigger}
            onClick={() => setUpdatesOpen(true)}
            className="flex min-h-[52px] flex-col items-center justify-center gap-1 text-[10px]"
          >
            <Bell className="size-5" />
            Updates
          </button>
        </nav>
      </div>
      <Sheet open={updatesOpen} onOpenChange={setUpdatesOpen}>
        <SheetContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            updatesTrigger.current?.focus();
          }}
          className="workspace-home overflow-y-auto px-6 motion-reduce:animate-none"
        >
          <SheetTitle className="sr-only">Updates</SheetTitle>
          <SheetDescription className="sr-only">
            Static design preview; notifications are not connected.
          </SheetDescription>
          <HomeUpdates />
        </SheetContent>
      </Sheet>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="workspace-home max-h-[80dvh] overflow-y-auto">
          <DialogTitle>Search documents</DialogTitle>
          <DialogDescription>
            Find a document in this workspace.
          </DialogDescription>
          <input
            aria-label="Search workspace documents"
            type="search"
            placeholder="Search by title…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full rounded-md border border-border bg-background px-3"
          />
          <ul className="divide-y divide-border">
            {props.documents
              .filter((item) =>
                item.title
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
              )
              .map((item) => (
                <li key={item.id}>
                  <Link
                    className="block truncate rounded px-2 py-3 text-sm hover:bg-accent"
                    href={`/workspace/${props.workspaceSlug}/doc/${item.slug}`}
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
          </ul>
          {props.documents.filter((item) =>
            item.title
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          ).length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No documents match your search.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
