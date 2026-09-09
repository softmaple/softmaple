"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FileText,
  LayoutGrid,
  List,
  Pin,
  Plus,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { SearchField } from "@/components/search-field";
import { useRedesignFlags } from "@/components/redesign-provider";
import type { DocsType } from "@/types/model";
import { usePresenceOverview } from "./use-presence-overview";
import { useWorkspaceDocuments } from "./use-workspace-documents";

type View = "field" | "list";
type Memory = {
  readonly view?: View;
  readonly pins: readonly string[];
  readonly recent: readonly string[];
};
const emptyMemory: Memory = { pins: [], recent: [] };

export function WorkspaceField({
  documents: initial,
  workspaceSlug,
  accountId,
  canEdit,
}: {
  readonly documents: readonly DocsType["Row"][];
  readonly workspaceSlug: string;
  readonly accountId: string;
  readonly canEdit: boolean;
}) {
  const { field } = useRedesignFlags();
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const overview = usePresenceOverview(container);
  const data = useWorkspaceDocuments(workspaceSlug, initial);
  const [memory, setMemory] = useState<Memory>(emptyMemory);
  const [compact, setCompact] = useState(true);
  const key = `softmaple:workspace:${accountId}:${workspaceSlug}`;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      if (value !== null && typeof value === "object") {
        const ids = (value: unknown) =>
          Array.isArray(value)
            ? value
                .filter((id): id is string => typeof id === "string")
                .slice(0, 12)
            : [];
        setMemory({
          view:
            "view" in value && (value.view === "field" || value.view === "list")
              ? value.view
              : undefined,
          pins: "pins" in value ? ids(value.pins) : [],
          recent: "recent" in value ? ids(value.recent) : [],
        });
      }
    } catch {
      /* Storage is optional; the complete document list remains usable. */
    }
    return () => media.removeEventListener("change", update);
  }, [key]);
  const remember = (next: Memory) => {
    setMemory(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Keep this session's preference. */
    }
  };
  const view = field ? (memory.view ?? (compact ? "list" : "field")) : "list";
  const groups =
    view === "list" || data.query.trim() !== ""
      ? [
          {
            title: data.query ? "Title matches" : "All documents",
            documents: data.documents,
          },
        ]
      : [
          {
            title: "Pinned here",
            documents: data.documents.filter((doc) =>
              memory.pins.includes(doc.id),
            ),
          },
          {
            title: "Your recent places",
            documents: data.documents
              .filter(
                (doc) =>
                  !memory.pins.includes(doc.id) &&
                  memory.recent.slice(0, 6).includes(doc.id),
              )
              .slice(0, 6),
          },
          {
            title: "Explore the workspace",
            documents: data.documents.filter(
              (doc) =>
                !memory.pins.includes(doc.id) &&
                !memory.recent.slice(0, 6).includes(doc.id),
            ),
          },
        ].filter((group) => group.documents.length > 0);
  return (
    <section
      ref={setContainer}
      aria-label="Workspace documents"
      className="min-w-0"
    >
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <SearchField
            label="Search document titles"
            value={data.query}
            onChange={data.setQuery}
          />
        </div>
        {field ? (
          <div
            className="flex rounded-lg border bg-surface p-1"
            aria-label="Document view"
          >
            <Button
              size="icon-sm"
              variant={view === "field" ? "secondary" : "ghost"}
              aria-label="Field view"
              aria-pressed={view === "field"}
              onClick={() => remember({ ...memory, view: "field" })}
            >
              <LayoutGrid />
            </Button>
            <Button
              size="icon-sm"
              variant={view === "list" ? "secondary" : "ghost"}
              aria-label="List view"
              aria-pressed={view === "list"}
              onClick={() => remember({ ...memory, view: "list" })}
            >
              <List />
            </Button>
          </div>
        ) : null}
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Search by title · your pins and recent places stay on this device.
      </p>
      {data.error !== null ? (
        <div className="mb-4 rounded-xl border p-4" role="alert">
          {data.error}
          <Button variant="ghost" onClick={data.retry}>
            Retry
          </Button>
        </div>
      ) : null}
      <div aria-busy={data.pending} className="space-y-8">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-sm font-medium">{group.title}</h2>
              <span className="h-px flex-1 bg-border" />
              <span className="font-mono text-xs text-muted-foreground">
                {group.documents.length.toString().padStart(2, "0")}
              </span>
            </div>
            <div
              className={
                view === "field"
                  ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                  : "divide-y rounded-xl border bg-surface"
              }
            >
              {group.documents.map((doc) => (
                <article
                  data-presence-document={doc.is_public ? doc.id : undefined}
                  key={doc.id}
                  className={
                    view === "field"
                      ? "group relative flex min-h-48 flex-col rounded-xl border bg-surface p-5 transition-colors hover:border-input"
                      : "group flex items-center gap-3 p-4"
                  }
                >
                  <div
                    className={
                      view === "field"
                        ? "mb-5 flex items-center justify-between"
                        : "contents"
                    }
                  >
                    <FileText
                      size={18}
                      className="shrink-0 text-muted-foreground"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`${memory.pins.includes(doc.id) ? "Unpin" : "Pin"} ${doc.title}`}
                      aria-pressed={memory.pins.includes(doc.id)}
                      onClick={() =>
                        remember({
                          ...memory,
                          pins: memory.pins.includes(doc.id)
                            ? memory.pins.filter((id) => id !== doc.id)
                            : [...memory.pins, doc.id].slice(-12),
                        })
                      }
                    >
                      <Pin
                        className={
                          memory.pins.includes(doc.id)
                            ? "text-emphasis"
                            : "text-muted-foreground"
                        }
                      />
                    </Button>
                  </div>
                  <Link
                    className="min-w-0 flex-1 rounded-sm"
                    href={`/workspace/${workspaceSlug}/doc/${doc.slug}`}
                    onClick={() =>
                      remember({
                        ...memory,
                        recent: [
                          doc.id,
                          ...memory.recent.filter((id) => id !== doc.id),
                        ].slice(0, 12),
                      })
                    }
                  >
                    <h3 className="flex items-start justify-between gap-3 text-base font-medium">
                      <span className="break-words">{doc.title}</span>
                      <ArrowUpRight
                        size={16}
                        className="shrink-0 text-muted-foreground"
                      />
                    </h3>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {doc.is_public
                        ? overview[doc.id] === undefined
                          ? "Checking who’s here…"
                          : overview[doc.id] === null
                            ? "Live presence unavailable"
                            : overview[doc.id]!.people === 0
                              ? "No one here right now"
                              : `${overview[doc.id]!.people} here · ${overview[doc.id]!.editing} editing`
                        : "Workspace access"}
                    </p>
                  </Link>
                  <p
                    className={
                      view === "field"
                        ? "mt-5 border-t pt-3 font-mono text-[10px] text-muted-foreground"
                        : "hidden font-mono text-[10px] text-muted-foreground sm:block"
                    }
                  >
                    {doc.updated_at
                      ? `Edited ${new Date(doc.updated_at).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}`
                      : "Ready to begin"}
                  </p>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
      {data.documents.length === 0 && !data.pending ? (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <FileText className="mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-medium">
            {data.query
              ? "No matching titles"
              : "A shared space starts with a page"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.query
              ? "Try a different title or clear your search."
              : "Start a document, then bring someone into the work."}
          </p>
          {data.query ? (
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => data.setQuery("")}
            >
              Clear search
            </Button>
          ) : canEdit ? (
            <Button asChild className="mt-5">
              <Link href={`/workspace/${workspaceSlug}/doc/new`}>
                <Plus />
                New document
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
      {data.hasMore ? (
        <Button
          className="mt-6"
          variant="outline"
          disabled={data.pending}
          onClick={data.loadMore}
        >
          {data.pending ? "Loading…" : "Load more documents"}
        </Button>
      ) : null}
    </section>
  );
}
