"use client";

import type { FC } from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { ScrollArea } from "@softmaple/ui/components/scroll-area";
import { SearchField } from "@/components/search-field";
import { listWorkspaceDocumentPage } from "@/app/actions/documents/documents";
import { StatePanel } from "@/components/shell/state-panel";
import type { DocsType } from "@/types/model";

type DocumentRow = DocsType["Row"];

export type WorkspaceDocsListProps = {
  readonly canEdit: boolean;
  /** First page, rendered by the server so the list is never empty on arrival. */
  readonly documents: ReadonlyArray<DocumentRow>;
  readonly initialCursor?: string | null;
  readonly onNavigate?: () => void;
  readonly workspaceId: number;
  readonly workspaceSlug: string;
};

const PAGE_SIZE = 25;
/** Long enough that typing a word is one query, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250;

export const WorkspaceDocsList: FC<WorkspaceDocsListProps> = ({
  canEdit,
  documents,
  initialCursor = null,
  onNavigate,
  workspaceId,
  workspaceSlug,
}) => {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ReadonlyArray<DocumentRow>>(documents);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Only the newest request may write to state; an earlier, slower answer for
  // a query the person has already changed must not overwrite a later one.
  const requestRef = useRef(0);

  const load = useCallback(
    (title: string, from: string | null, append: boolean) => {
      const request = ++requestRef.current;
      startTransition(async () => {
        const result = await listWorkspaceDocumentPage({
          limit: PAGE_SIZE,
          workspaceId,
          ...(from === null ? {} : { cursor: from }),
          ...(title.length === 0 ? {} : { title }),
        });
        if (request !== requestRef.current) return;
        if (!result.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setCursor(result.data.nextCursor);
        setRows((current) =>
          append
            ? [...current, ...result.data.documents]
            : result.data.documents,
        );
      });
    },
    [workspaceId],
  );

  // Search runs in the database, so a match in the thousandth document is
  // still found. Debounced so a word is one query rather than five.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      requestRef.current += 1;
      setRows(documents);
      setCursor(initialCursor);
      setFailed(false);
      return;
    }
    const timer = setTimeout(
      () => load(trimmed, null, false),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [documents, initialCursor, load, query]);

  const searching = query.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-3">
        <SearchField
          label="Search documents by title"
          onChange={setQuery}
          value={query}
        />
      </div>

      <div className="flex items-center justify-between px-2 pb-2 pt-2">
        <h3 className="text-sm font-medium">
          {searching ? "Matching documents" : "Documents"}
        </h3>
        {canEdit ? (
          <Button
            aria-label="New document"
            asChild
            size="icon-sm"
            variant="ghost"
          >
            <Link
              href={`/workspace/${workspaceSlug}/doc/new`}
              onClick={onNavigate}
            >
              <Plus />
            </Link>
          </Button>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-1 pb-4">
        {failed ? (
          <StatePanel
            action={
              <Button
                onClick={() => load(query.trim(), null, false)}
                size="sm"
                variant="outline"
              >
                Try again
              </Button>
            }
            description="The document list could not be loaded. Your work is unaffected."
            title="Could not load documents"
            tone="error"
          />
        ) : rows.length === 0 ? (
          <p className="px-2 py-5 text-sm text-content-secondary">
            {searching
              ? `No document title matches “${query.trim()}”.`
              : "No documents in this workspace yet."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((document) => {
              const path = `/workspace/${workspaceSlug}/doc/${document.slug}`;
              return (
                <Button
                  asChild
                  className="h-auto w-full justify-start px-2 py-2 text-left"
                  key={document.id}
                  variant={pathname === path ? "secondary" : "ghost"}
                >
                  <Link
                    aria-current={pathname === path ? "page" : undefined}
                    href={path}
                    onClick={onNavigate}
                  >
                    <FileText className="size-4 shrink-0 text-emphasis" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {document.title}
                      </span>
                      <span className="block font-mono text-[9px] text-content-secondary">
                        {document.updated_at?.slice(0, 10) ?? "New"}
                      </span>
                    </span>
                  </Link>
                </Button>
              );
            })}
            {cursor === null ? null : (
              <Button
                className="mt-1 w-full"
                disabled={isPending}
                onClick={() => load(query.trim(), cursor, true)}
                size="sm"
                variant="ghost"
              >
                {isPending ? "Loading…" : "Show more"}
              </Button>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
