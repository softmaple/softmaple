/**
 * Event-id ordering utility shared by the event graph and the replay
 * engine.
 *
 * Event IDs follow the canonical `replicaId:sequence` shape produced by
 * {@link EgWalkerReplica.generateEventId}. A naive lexicographic
 * comparator orders `r1:10` before `r1:2`, which breaks the engine's
 * concurrent-insert tie-breaker for replicas with double-digit (or
 * larger) sequence numbers and also affects deterministic topological
 * tie-breaks in {@link EventGraph.getTopologicalOrder} /
 * {@link EventGraph.getBranchPreservingTopologicalOrder}.
 *
 * This helper compares canonical IDs by prefix and then numeric sequence.
 * Canonical IDs sort before custom / legacy IDs, which are ordered
 * lexicographically. Keeping the two shapes in disjoint sort partitions is
 * load-bearing: switching pair-by-pair between numeric and raw string
 * comparison produces a non-transitive comparator for mixed ID sets.
 */

import type { EventId } from "../types";

const MAX_SAFE_SEQUENCE_DIGITS = 16;

/**
 * Compare two event IDs with numeric-aware semantics on the
 * `replicaId:sequence` suffix. Returns -1/0/+1 like {@link Array.sort}'s
 * comparator contract.
 */
export const compareEventIds = (left: EventId, right: EventId): number => {
  if (left === right) {
    return 0;
  }

  const leftSplit = splitTrailingSequence(left);
  const rightSplit = splitTrailingSequence(right);

  if (leftSplit && rightSplit) {
    if (leftSplit.prefix !== rightSplit.prefix) {
      return leftSplit.prefix < rightSplit.prefix ? -1 : 1;
    }
    if (leftSplit.sequence !== rightSplit.sequence) {
      return leftSplit.sequence < rightSplit.sequence ? -1 : 1;
    }
    return 0;
  }

  if (leftSplit) {
    return -1;
  }
  if (rightSplit) {
    return 1;
  }

  return left < right ? -1 : 1;
};

/** Parsed once for hot balanced-tree comparators. */
export interface EventIdSortKey {
  readonly id: EventId;
  readonly prefix: string | null;
  readonly sequence: number;
}

export const createEventIdSortKey = (id: EventId): EventIdSortKey => {
  const parsed = splitTrailingSequence(id);
  return {
    id,
    prefix: parsed?.prefix ?? null,
    sequence: parsed?.sequence ?? 0,
  };
};

/** Compare pre-parsed keys with exactly the same ordering as compareEventIds. */
export const compareEventIdSortKeys = (
  left: EventIdSortKey,
  right: EventIdSortKey,
): number => {
  if (left.id === right.id) {
    return 0;
  }
  if (left.prefix !== null && right.prefix !== null) {
    if (left.prefix !== right.prefix) {
      return left.prefix < right.prefix ? -1 : 1;
    }
    if (left.sequence !== right.sequence) {
      return left.sequence < right.sequence ? -1 : 1;
    }
    return 0;
  }
  if (left.prefix !== null) {
    return -1;
  }
  if (right.prefix !== null) {
    return 1;
  }
  return left.id < right.id ? -1 : 1;
};

interface ParsedEventId {
  readonly prefix: string;
  readonly sequence: number;
}

const splitTrailingSequence = (id: EventId): ParsedEventId | null => {
  const colonIndex = id.lastIndexOf(":");
  const suffixStart = colonIndex + 1;
  const suffixLength = id.length - suffixStart;
  if (
    colonIndex <= 0 ||
    suffixLength === 0 ||
    suffixLength > MAX_SAFE_SEQUENCE_DIGITS
  ) {
    return null;
  }

  let codeUnit = id.charCodeAt(suffixStart);
  if (
    codeUnit < 48 ||
    codeUnit > 57 ||
    (codeUnit === 48 && suffixLength !== 1)
  ) {
    return null;
  }

  let sequence = codeUnit - 48;
  for (let index = suffixStart + 1; index < id.length; index++) {
    codeUnit = id.charCodeAt(index);
    if (codeUnit < 48 || codeUnit > 57) {
      return null;
    }
    sequence = sequence * 10 + (codeUnit - 48);
  }
  if (sequence > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return { prefix: id.slice(0, colonIndex), sequence };
};

/**
 * Split an event ID into `{ replicaId, sequence }` when it matches the
 * canonical `replicaId:sequence` shape produced by
 * {@link EgWalkerReplica.generateEventId}. Returns `null` for custom or
 * placeholder IDs that do not parse.
 *
 * Used by the engine's typed-run coalescing path (Section 3.4 "smaller"
 * lever) and the columnar codec's id-run encoder to decide whether two
 * adjacent events belong to the same author and have contiguous sequence
 * numbers.
 */
export const parseEventId = (
  id: EventId,
): { readonly replicaId: string; readonly sequence: number } | null => {
  const parsed = splitTrailingSequence(id);
  if (!parsed) {
    return null;
  }
  return { replicaId: parsed.prefix, sequence: parsed.sequence };
};
