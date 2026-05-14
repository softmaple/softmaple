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
 * This helper compares the prefix (everything up to the last `:`)
 * lexicographically and then the suffix numerically when both suffixes
 * parse as non-negative integers. Custom or legacy IDs that do not match
 * the `prefix:numericSuffix` shape fall back to lexicographic ordering
 * end-to-end so that pre-existing event graphs remain comparable.
 */

import type { EventId } from "../types";

const NUMERIC_SUFFIX = /^(0|[1-9]\d*)$/;

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

  return left < right ? -1 : 1;
};

interface ParsedEventId {
  readonly prefix: string;
  readonly sequence: number;
}

const splitTrailingSequence = (id: EventId): ParsedEventId | null => {
  const colonIndex = id.lastIndexOf(":");
  if (colonIndex <= 0 || colonIndex === id.length - 1) {
    return null;
  }
  const suffix = id.slice(colonIndex + 1);
  if (!NUMERIC_SUFFIX.test(suffix)) {
    return null;
  }
  const sequence = Number(suffix);
  if (!Number.isSafeInteger(sequence)) {
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
