"use client";
import Link from "next/link";
import {
  ArrowRight,
  FileText,
  LayoutGrid,
  List,
  MoreHorizontal,
} from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@softmaple/ui/components/dropdown-menu";
import { HomeAvatars } from "./home-avatar";
import { SPACE_EXAMPLES } from "./home-static-data";
import type { HomeDocument, HomeProps } from "./home-types";

function edited(document: HomeDocument) {
  if (document.displayTime) return document.displayTime;
  if (!document.updated_at) return "Just created";
  return new Date(document.updated_at).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}
function DocumentMenu({
  document,
  workspaceSlug,
}: {
  document: HomeDocument;
  workspaceSlug: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${document.title}`}
        className="grid size-7 shrink-0 place-items-center rounded hover:bg-accent"
      >
        <MoreHorizontal className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-home" align="end">
        <DropdownMenuItem asChild>
          <Link href={`/workspace/${workspaceSlug}/doc/${document.slug}`}>
            Open document
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function HomeContinue({
  documents,
  workspaceSlug,
  visualFixture,
  onBrowse,
}: Pick<HomeProps, "documents" | "workspaceSlug" | "visualFixture"> & {
  onBrowse: () => void;
}) {
  const recent = visualFixture ? documents.slice(1, 4) : documents.slice(0, 3);
  return (
    <section
      className="mb-[28px] mt-[23px] hidden md:block"
      aria-labelledby="continue-title"
    >
      <div className="mb-[8px] flex items-center justify-between">
        <h2
          id="continue-title"
          className="ws-serif text-[23px] leading-[1.25] tracking-[-.045em]"
        >
          Continue writing
        </h2>
        <button
          onClick={onBrowse}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          View all <ArrowRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-[18px] max-[1100px]:grid-cols-2">
        {recent.map((document, index) => (
          <article
            className={`ws-paper relative flex h-[185px] min-w-0 flex-col rounded-md border border-border px-[23px] pt-[23px] pb-[13px] shadow-[var(--ws-shadow)] ${index === 2 ? "ws-fold" : ""}`}
            key={document.id}
          >
            <Link
              href={`/workspace/${workspaceSlug}/doc/${document.slug}`}
              className="min-h-0 flex-1 overflow-hidden"
            >
              <h3 className="ws-serif line-clamp-2 text-[24px] leading-[1.2] tracking-[-.05em]">
                {document.title}
              </h3>
              <p className="ws-serif mt-[6px] line-clamp-3 text-[17px] leading-[1.35] text-muted-foreground">
                {document.preview ??
                  "Pick up a thought. Make room for what comes next."}
              </p>
            </Link>
            <div className="mt-3 flex items-center gap-3">
              {document.people ? (
                <HomeAvatars people={document.people} />
              ) : (
                <FileText className="size-5 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                Edited {edited(document)}
              </span>
              <DocumentMenu document={document} workspaceSlug={workspaceSlug} />
            </div>
          </article>
        ))}
      </div>
      {recent.length === 0 ? (
        <p className="ws-paper rounded-md border border-border p-8 text-sm text-muted-foreground">
          Give your next idea a page of its own. Create your first document.
        </p>
      ) : null}
    </section>
  );
}
export function HomeDocuments({
  documents,
  workspaceSlug,
  profile,
  query,
  documentCount,
}: Pick<
  HomeProps,
  "documents" | "workspaceSlug" | "profile" | "documentCount"
> & { query: string }) {
  const [filter, setFilter] = useState("Recent");
  const [grid, setGrid] = useState(false);
  const filtered = documents.filter(
    (document) =>
      document.title
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()) &&
      (filter !== "Created by me" || document.author_id === profile.id) &&
      (filter !== "Shared" || document.is_public),
  );
  return (
    <section
      id="workspace-documents"
      aria-label="Documents"
      className="scroll-mt-5 pb-5 max-md:mt-3"
    >
      <div className="mb-[10px] flex items-center gap-6 max-md:mb-1">
        <h2 className="ws-serif text-[23px] leading-[1.25] tracking-[-.045em] max-md:hidden">
          All documents
        </h2>
        <h2 className="text-sm md:hidden">Recent documents</h2>
        <div
          className="hidden items-center gap-1 md:flex"
          aria-label="Document filters"
        >
          {["Recent", "Created by me", "Shared"].map((label) => (
            <button
              key={label}
              onClick={() => setFilter(label)}
              aria-pressed={filter === label}
              title={
                label === "Shared" ? "Documents shared publicly" : undefined
              }
              className={`rounded-xl border border-border px-3 py-[6px] text-[11px] ${filter === label ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <button
            className={`grid h-[30px] w-[39px] place-items-center rounded ${!grid ? "border border-border" : ""}`}
            aria-label="List view"
            aria-pressed={!grid}
            onClick={() => setGrid(false)}
          >
            <List className="size-[19px]" />
          </button>
          <button
            className={`grid h-[30px] w-[39px] place-items-center rounded ${grid ? "border border-border" : ""}`}
            aria-label="Grid view"
            aria-pressed={grid}
            onClick={() => setGrid(true)}
          >
            <LayoutGrid className="size-[18px]" />
          </button>
        </div>
      </div>
      <div
        className={`max-md:overflow-hidden max-md:rounded-md max-md:border max-md:border-border ${grid ? "md:grid md:grid-cols-2 md:gap-3" : ""}`}
      >
        {!grid ? (
          <div className="ws-document-row hidden border-b border-border pb-[6px] text-[11px] text-muted-foreground md:grid">
            <span>Name</span>
            <span>Space</span>
            <span>People</span>
            <span>Updated</span>
            <span />
          </div>
        ) : null}
        {filtered.map((document) => (
          <div
            key={document.id}
            className={`ws-document-row min-w-0 items-center border-b border-border py-[7px] last:max-md:border-0 max-md:flex max-md:gap-2 max-md:px-2 max-md:py-[5px] ${grid ? "md:rounded-md md:border md:p-4" : "md:grid"}`}
          >
            <Link
              href={`/workspace/${workspaceSlug}/doc/${document.slug}`}
              className="flex min-w-0 items-center gap-[17px] max-md:flex-1 max-md:gap-2"
            >
              <FileText className="size-5 shrink-0 max-md:size-4" />
              <span className="truncate text-xs">{document.title}</span>
            </Link>
            <span className="hidden items-center gap-3 text-xs md:flex">
              {document.space ? (
                <>
                  <span
                    className="size-3 rounded-full"
                    style={{
                      background: SPACE_EXAMPLES.find(
                        (space) => space.name === document.space,
                      )?.color,
                    }}
                  />
                  {document.space}
                </>
              ) : (
                "—"
              )}
            </span>
            <span className="hidden md:block">
              {document.people ? (
                <HomeAvatars people={document.people} />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </span>
            <time className="shrink-0 text-[11px] text-muted-foreground">
              {edited(document)}
            </time>
            <span className="hidden justify-self-end md:block">
              <DocumentMenu document={document} workspaceSlug={workspaceSlug} />
            </span>
          </div>
        ))}
        {filtered.length === 0 ? (
          <p role="status" className="p-5 text-sm text-muted-foreground">
            {query
              ? "No documents match your search."
              : filter === "Recent"
                ? "No documents yet. Create your first note."
                : `No ${filter === "Shared" ? "publicly shared" : "matching"} documents.`}
          </p>
        ) : null}
      </div>
      {documentCount > documents.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the {documents.length} most recently updated documents of{" "}
          {documentCount}.
        </p>
      ) : null}
    </section>
  );
}
