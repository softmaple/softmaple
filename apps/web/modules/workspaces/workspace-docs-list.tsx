"use client";

import type { FC } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { SearchField } from "@/components/search-field";
import { ScrollArea } from "@softmaple/ui/components/scroll-area";
import type { DocsType } from "@/types/model";

type DocumentRow = DocsType["Row"];

export type WorkspaceDocsListProps = {
  readonly canEdit: boolean;
  readonly documents: ReadonlyArray<DocumentRow>;
  readonly onNavigate?: () => void;
  readonly workspaceSlug: string;
};

export const WorkspaceDocsList: FC<WorkspaceDocsListProps> = ({
  canEdit,
  documents,
  onNavigate,
  workspaceSlug,
}) => {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery.length === 0
      ? documents
      : documents.filter((document) =>
          document.title.toLocaleLowerCase().includes(normalizedQuery),
        );
  }, [documents, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-3">
        <SearchField
          label="Search documents"
          value={query}
          onChange={setQuery}
        />
      </div>

      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div>
          <h3 className="text-sm font-medium">Documents</h3>
          <p className="font-mono text-[10px] text-muted-foreground">
            {filteredDocuments.length} shown
          </p>
        </div>
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
              <Plus data-icon="inline-start" />
            </Link>
          </Button>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 pb-4">
        {filteredDocuments.length === 0 ? (
          <p className="px-2 py-5 text-sm text-muted-foreground">
            {documents.length === 0
              ? "No documents in this workspace."
              : "No document matches this search."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredDocuments.map((document) => {
              const path = `/workspace/${workspaceSlug}/doc/${document.slug}`;
              return (
                <Button
                  asChild
                  className="h-auto w-full justify-start px-2 py-2 text-left"
                  key={document.id}
                  variant={pathname === path ? "secondary" : "ghost"}
                >
                  <Link
                    href={path}
                    onClick={onNavigate}
                    aria-current={pathname === path ? "page" : undefined}
                  >
                    <FileText className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {document.title}
                      </span>
                      <span className="block font-mono text-[9px] text-muted-foreground">
                        {document.updated_at?.slice(0, 10) ?? "New"}
                      </span>
                    </span>
                  </Link>
                </Button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
