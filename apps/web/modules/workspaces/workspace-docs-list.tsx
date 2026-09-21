"use client";

import type { FC, ReactNode } from "react";
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
  readonly navigation?: ReactNode;
  readonly onNavigate?: () => void;
  readonly workspaceSlug: string;
};

export const WorkspaceDocsList: FC<WorkspaceDocsListProps> = ({
  canEdit,
  documents,
  navigation,
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
      <div className="shrink-0 px-3 pb-1 pt-2">
        <SearchField label="Search" value={query} onChange={setQuery} />
      </div>

      {navigation}

      <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-1">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Documents
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
          <div className="flex flex-col gap-0.5 px-1">
            {filteredDocuments.map((document) => {
              const path = `/workspace/${workspaceSlug}/doc/${document.slug}`;
              return (
                <Button
                  asChild
                  className="h-10 w-full justify-start rounded-md px-2.5 text-left"
                  key={document.id}
                  variant={pathname === path ? "secondary" : "ghost"}
                >
                  <Link
                    href={path}
                    onClick={onNavigate}
                    aria-current={pathname === path ? "page" : undefined}
                  >
                    <FileText className="size-[1.05rem] shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.84rem] font-normal">
                        {document.title}
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
