"use client";

import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import Link from "next/link";
import { FileText, LayoutGrid, List, Pin, PinOff } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { cn } from "@softmaple/ui/lib/utils";
import { useFeatureFlag } from "@/components/system/feature-flags-provider";
import { FEATURE_FLAG } from "@/lib/feature-flags";
import { StatePanel } from "@/components/shell/state-panel";
import {
  EMPTY_LOCAL_HOME_STATE,
  homeClusters,
  togglePinned,
  type HomeCluster,
  type LocalHomeState,
} from "@/modules/workspaces/home-clusters";
import type { DocsType } from "@/types/model";

type DocumentRow = DocsType["Row"];

/**
 * The workspace home, in two shapes over one set of destinations.
 *
 * Field is spatial and shows more of each document at a glance; List is dense
 * and shows more documents. They render the *same* clusters in the same order,
 * so switching never changes what is there — only how much of it you can see
 * at once. That is why the view is a preference and not a route.
 */

export const HOME_VIEW = {
  Field: "field",
  List: "list",
} as const;

export type HomeView = (typeof HOME_VIEW)[keyof typeof HOME_VIEW];

const storageKey = (workspaceSlug: string): string =>
  `softmaple.home.${workspaceSlug}.v1`;

type StoredHome = LocalHomeState & { readonly view: HomeView | null };

const readStored = (workspaceSlug: string): StoredHome => {
  const fallback: StoredHome = { ...EMPTY_LOCAL_HOME_STATE, view: null };
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceSlug));
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const record = parsed as Record<string, unknown>;
    const ids = (value: unknown): ReadonlyArray<string> =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
    return {
      pinnedIds: ids(record.pinnedIds),
      recentIds: ids(record.recentIds),
      view:
        record.view === HOME_VIEW.Field || record.view === HOME_VIEW.List
          ? record.view
          : null,
    };
  } catch {
    // Blocked or corrupt storage: the defaults are a valid answer.
    return fallback;
  }
};

const writeStored = (workspaceSlug: string, value: StoredHome): void => {
  try {
    window.localStorage.setItem(
      storageKey(workspaceSlug),
      JSON.stringify(value),
    );
  } catch {
    // The choice still applies for this session.
  }
};

const DocumentCard: FC<{
  readonly document: DocumentRow;
  readonly onTogglePin: (id: string) => void;
  readonly pinned: boolean;
  readonly view: HomeView;
  readonly workspaceSlug: string;
}> = ({ document, onTogglePin, pinned, view, workspaceSlug }) => (
  <div
    className={cn(
      "group relative flex items-start gap-3 rounded-xl border border-divider bg-document",
      view === HOME_VIEW.Field ? "flex-col p-4" : "flex-row p-3",
    )}
  >
    <Link
      className="min-w-0 flex-1"
      href={`/workspace/${workspaceSlug}/doc/${document.slug}`}
    >
      <span className="flex items-center gap-2">
        <FileText aria-hidden className="size-4 shrink-0 text-emphasis" />
        <span className="truncate font-medium">{document.title}</span>
      </span>
      <span className="mt-1 block text-xs text-content-secondary">
        {document.is_public ? "Public link · " : ""}
        {document.updated_at === null
          ? "Not edited yet"
          : `Edited ${document.updated_at.slice(0, 10)}`}
      </span>
    </Link>
    <Button
      aria-label={pinned ? `Unpin ${document.title}` : `Pin ${document.title}`}
      aria-pressed={pinned}
      className={cn(view === HOME_VIEW.Field && "absolute right-2 top-2")}
      onClick={() => onTogglePin(document.id)}
      size="icon-sm"
      variant="ghost"
    >
      {pinned ? <PinOff /> : <Pin />}
    </Button>
  </div>
);

const ClusterSection: FC<{
  readonly cluster: HomeCluster;
  readonly onTogglePin: (id: string) => void;
  readonly pinnedIds: ReadonlySet<string>;
  readonly view: HomeView;
  readonly workspaceSlug: string;
}> = ({ cluster, onTogglePin, pinnedIds, view, workspaceSlug }) => (
  <section aria-labelledby={`cluster-${cluster.name}`} className="min-w-0">
    <h2
      className="mb-3 text-sm font-medium text-content-secondary"
      id={`cluster-${cluster.name}`}
    >
      {cluster.title}
    </h2>
    {cluster.documents.length === 0 ? (
      <p className="rounded-xl border border-dashed border-divider px-4 py-6 text-sm text-content-secondary">
        {cluster.emptyHint}
      </p>
    ) : (
      <div
        className={cn(
          view === HOME_VIEW.Field
            ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            : "flex flex-col gap-2",
        )}
      >
        {cluster.documents.map((document) => (
          <DocumentCard
            document={document}
            key={document.id}
            onTogglePin={onTogglePin}
            pinned={pinnedIds.has(document.id)}
            view={view}
            workspaceSlug={workspaceSlug}
          />
        ))}
      </div>
    )}
  </section>
);

export type WorkspaceHomeProps = {
  readonly documents: ReadonlyArray<DocumentRow>;
  readonly workspaceSlug: string;
};

export const WorkspaceHome: FC<WorkspaceHomeProps> = ({
  documents,
  workspaceSlug,
}) => {
  const fieldAvailable = useFeatureFlag(FEATURE_FLAG.FieldView);
  const [local, setLocal] = useState<LocalHomeState>(EMPTY_LOCAL_HOME_STATE);
  const [chosenView, setChosenView] = useState<HomeView | null>(null);
  const [wide, setWide] = useState(false);

  // Storage and viewport are read after mount so the server and the first
  // client render agree.
  useEffect(() => {
    const stored = readStored(workspaceSlug);
    setLocal({ pinnedIds: stored.pinnedIds, recentIds: stored.recentIds });
    setChosenView(stored.view);
  }, [workspaceSlug]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Wide screens default to Field, compact to List; an explicit choice wins in
  // both directions and is remembered per workspace.
  const view: HomeView = !fieldAvailable
    ? HOME_VIEW.List
    : (chosenView ?? (wide ? HOME_VIEW.Field : HOME_VIEW.List));

  const chooseView = useCallback(
    (next: HomeView) => {
      setChosenView(next);
      const stored = readStored(workspaceSlug);
      writeStored(workspaceSlug, { ...stored, view: next });
    },
    [workspaceSlug],
  );

  const onTogglePin = useCallback(
    (documentId: string) => {
      setLocal((current) => {
        const next = togglePinned(current, documentId);
        const stored = readStored(workspaceSlug);
        writeStored(workspaceSlug, { ...next, view: stored.view });
        return next;
      });
    },
    [workspaceSlug],
  );

  const clusters = useMemo(
    () => homeClusters({ documents, local }),
    [documents, local],
  );
  const pinnedIds = useMemo(() => new Set(local.pinnedIds), [local.pinnedIds]);

  if (documents.length === 0) {
    return (
      <StatePanel
        action={
          <Button asChild>
            <Link href={`/workspace/${workspaceSlug}/doc/new`}>
              New document
            </Link>
          </Button>
        }
        description="Give your next idea a page of its own."
        icon={<FileText className="size-6" />}
        title="No documents yet"
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {fieldAvailable ? (
        <div className="flex items-center justify-end gap-1">
          <span className="mr-1 text-xs text-content-secondary" id="view-label">
            View
          </span>
          <div aria-labelledby="view-label" className="flex gap-1" role="group">
            <Button
              aria-pressed={view === HOME_VIEW.Field}
              onClick={() => chooseView(HOME_VIEW.Field)}
              size="sm"
              variant={view === HOME_VIEW.Field ? "secondary" : "ghost"}
            >
              <LayoutGrid /> Field
            </Button>
            <Button
              aria-pressed={view === HOME_VIEW.List}
              onClick={() => chooseView(HOME_VIEW.List)}
              size="sm"
              variant={view === HOME_VIEW.List ? "secondary" : "ghost"}
            >
              <List /> List
            </Button>
          </div>
        </div>
      ) : null}

      {clusters.map((cluster) => (
        <ClusterSection
          cluster={cluster}
          key={cluster.name}
          onTogglePin={onTogglePin}
          pinnedIds={pinnedIds}
          view={view}
          workspaceSlug={workspaceSlug}
        />
      ))}
    </div>
  );
};
