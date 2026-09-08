import type { DocsType } from "@/types/model";

type DocumentRow = DocsType["Row"];

/**
 * The three groups a workspace home is made of.
 *
 * Grouping exists so that arriving at a workspace answers "what was I doing"
 * before it answers "what exists". Pinned and recently-opened are *local*
 * facts — they are about this person on this device, not about the workspace —
 * so they are never derived from server data.
 *
 * Every cluster is bounded and every order is total. A workspace where
 * documents are being saved by other people must not reshuffle under the
 * pointer, so ordering never depends on a value that changes while you look
 * at it.
 */

export const CLUSTER = {
  Pinned: "pinned",
  Recent: "recent",
  Everything: "everything",
} as const;

export type ClusterName = (typeof CLUSTER)[keyof typeof CLUSTER];

export const CLUSTER_LIMITS = {
  [CLUSTER.Pinned]: 12,
  [CLUSTER.Recent]: 8,
} as const;

export type HomeCluster = {
  readonly documents: ReadonlyArray<DocumentRow>;
  readonly name: ClusterName;
  readonly title: string;
  /** Why this group exists, shown when it is empty. */
  readonly emptyHint: string;
};

export type LocalHomeState = {
  /** Document ids this person pinned, most recently pinned first. */
  readonly pinnedIds: ReadonlyArray<string>;
  /** Document ids this person opened, most recent first. */
  readonly recentIds: ReadonlyArray<string>;
};

export const EMPTY_LOCAL_HOME_STATE: LocalHomeState = Object.freeze({
  pinnedIds: Object.freeze([]),
  recentIds: Object.freeze([]),
});

/**
 * Order documents by the local list that names them.
 *
 * Ids that no longer resolve to a document are dropped rather than rendered as
 * a placeholder: a pin to a deleted document is not a document.
 */
const inLocalOrder = (
  ids: ReadonlyArray<string>,
  byId: ReadonlyMap<string, DocumentRow>,
  limit: number,
): ReadonlyArray<DocumentRow> =>
  ids
    .map((id) => byId.get(id))
    .filter((document): document is DocumentRow => document !== undefined)
    .slice(0, limit);

/**
 * A total ordering for the remaining documents.
 *
 * Most recently updated first, then id. The id tiebreak is what keeps the
 * order stable: two documents saved in the same second must not trade places
 * between renders.
 */
const byRecency = (left: DocumentRow, right: DocumentRow): number => {
  const leftTime = left.updated_at ?? "";
  const rightTime = right.updated_at ?? "";
  if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1;
  return left.id < right.id ? 1 : -1;
};

/**
 * Build the clusters.
 *
 * A document appears in exactly one group. Pinning beats recency, because a
 * pin is a decision and recency is an accident.
 */
export const homeClusters = ({
  documents,
  local,
}: {
  readonly documents: ReadonlyArray<DocumentRow>;
  readonly local: LocalHomeState;
}): ReadonlyArray<HomeCluster> => {
  const byId = new Map(documents.map((document) => [document.id, document]));

  const pinned = inLocalOrder(
    local.pinnedIds,
    byId,
    CLUSTER_LIMITS[CLUSTER.Pinned],
  );
  const claimed = new Set(pinned.map((document) => document.id));

  const recent = inLocalOrder(
    local.recentIds.filter((id) => !claimed.has(id)),
    byId,
    CLUSTER_LIMITS[CLUSTER.Recent],
  );
  for (const document of recent) claimed.add(document.id);

  // Copy before sorting: the caller's array is not ours to reorder.
  const everything = [
    ...documents.filter((document) => !claimed.has(document.id)),
  ].sort(byRecency);

  return Object.freeze([
    Object.freeze({
      documents: pinned,
      name: CLUSTER.Pinned,
      title: "Pinned",
      emptyHint: "Pin a document to keep it here.",
    }),
    Object.freeze({
      documents: recent,
      name: CLUSTER.Recent,
      title: "Recently opened",
      emptyHint: "Documents you open appear here.",
    }),
    Object.freeze({
      documents: everything,
      name: CLUSTER.Everything,
      title: "All documents",
      emptyHint: "This workspace has no documents yet.",
    }),
  ]);
};

/** Pin or unpin, keeping the most recent decision first and the list bounded. */
export const togglePinned = (
  local: LocalHomeState,
  documentId: string,
): LocalHomeState => {
  const pinned = local.pinnedIds.includes(documentId)
    ? local.pinnedIds.filter((id) => id !== documentId)
    : [documentId, ...local.pinnedIds].slice(0, CLUSTER_LIMITS[CLUSTER.Pinned]);
  return Object.freeze({ ...local, pinnedIds: Object.freeze(pinned) });
};

/** Record that a document was opened. */
export const recordOpened = (
  local: LocalHomeState,
  documentId: string,
): LocalHomeState =>
  Object.freeze({
    ...local,
    recentIds: Object.freeze(
      [documentId, ...local.recentIds.filter((id) => id !== documentId)].slice(
        0,
        CLUSTER_LIMITS[CLUSTER.Recent] * 2,
      ),
    ),
  });
