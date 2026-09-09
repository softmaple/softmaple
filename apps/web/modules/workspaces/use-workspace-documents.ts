"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocsType } from "@/types/model";
import { searchWorkspaceDocuments } from "@/app/actions/documents/documents";

export function useWorkspaceDocuments(
  workspaceSlug: string,
  initial: readonly DocsType["Row"][],
) {
  const [documents, setDocuments] = useState(initial);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initial.length >= 25);
  const revision = useRef(0);
  const requestedQuery = useRef(`${workspaceSlug}\0`);
  const load = useCallback(
    async (title: string, offset: number) => {
      const request = ++revision.current;
      setPending(true);
      setError(null);
      try {
        const result = await searchWorkspaceDocuments(workspaceSlug, {
          title,
          offset,
        });
        if (request !== revision.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setDocuments((current) =>
          offset === 0
            ? result.data
            : [
                ...current,
                ...result.data.filter(
                  (item) =>
                    !current.some((existing) => existing.id === item.id),
                ),
              ],
        );
        setHasMore(result.data.length === 25);
      } catch {
        if (request === revision.current)
          setError("Search is unavailable. Try again.");
      } finally {
        if (request === revision.current) setPending(false);
      }
    },
    [workspaceSlug],
  );
  useEffect(() => {
    const nextQuery = `${workspaceSlug}\0${query}`;
    // The server already supplied the first page. A redundant mount request
    // could otherwise overwrite a fast Load more action with that first page.
    if (requestedQuery.current === nextQuery) return;
    requestedQuery.current = nextQuery;
    revision.current += 1;
    const timer = setTimeout(() => void load(query, 0), 220);
    return () => {
      clearTimeout(timer);
      revision.current += 1;
    };
  }, [load, query, workspaceSlug]);
  return {
    documents,
    query,
    setQuery,
    pending,
    error,
    hasMore,
    loadMore: () => load(query, documents.length),
    retry: () => load(query, 0),
  };
}
