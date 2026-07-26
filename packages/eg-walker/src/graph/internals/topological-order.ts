import type { EventId } from "../../types";
import { compareEventIds } from "../event-id";
import { MaxHeap } from "./max-heap";

const MAX_EXCLUSIVE_BRANCH_SPAN = 1_024;

interface TopologicalOrderView {
  readonly eventCount: number;
  /**
   * Events in a valid parent-before-child order. EventGraph insertion ranks
   * provide this invariant without an extra topological sort.
   */
  readonly eventIds: Iterable<EventId>;
  readonly parentCountOf: (id: EventId) => number;
  readonly childrenOf: (id: EventId) => Iterable<EventId>;
}

/**
 * Kahn's algorithm with a heap-backed ready queue, breaking ties by
 * numeric-aware event id via {@link compareEventIds}. The heap stays a
 * max-heap with an inverted comparator so each `pop` returns the lex-smallest
 * ready event, matching the previous shift+insertion-sort implementation
 * byte-for-byte — important because the columnar codec's on-disk bytes are
 * keyed off this ordering.
 */
export const getTopologicalOrder = (view: TopologicalOrderView): EventId[] => {
  const remainingParents = new Map<EventId, number>();
  const ready = new MaxHeap<EventId>((left, right) =>
    compareEventIds(right, left),
  );

  for (const id of view.eventIds) {
    const parentCount = view.parentCountOf(id);
    remainingParents.set(id, parentCount);
    if (parentCount === 0) {
      ready.push(id);
    }
  }

  const result: EventId[] = [];
  while (ready.size > 0) {
    const id = ready.pop()!;
    result.push(id);

    for (const childId of view.childrenOf(id)) {
      const remaining = (remainingParents.get(childId) ?? 0) - 1;
      remainingParents.set(childId, remaining);
      if (remaining === 0) {
        ready.push(childId);
      }
    }
  }

  if (result.length !== view.eventCount) {
    throw new Error("Cycle detected in event graph");
  }

  return result;
};

/**
 * Branch-preserving topological order (Section 5.2 of the Eg-walker paper).
 *
 * Kahn's algorithm with a sorted ready queue interleaves concurrent branches
 * whenever a child event lex-sorts after a deferred sibling root, which
 * forces the replay engine to retreat and re-advance on every transition.
 * This DFS variant walks one branch as far as possible before starting
 * another, so two consecutive events in the output usually share a parent
 * relationship and the engine's diff against the previous version collapses
 * to an empty retreat/advance pair.
 *
 * Short exclusive branches are visited before long ones. Leaving the longest
 * branch until last avoids retreating and re-advancing it at the merge point,
 * matching the paper's branch-size heuristic. A child's exclusive span
 * contributes to its parent only when it has exactly one parent, so shared
 * merge suffixes are not charged to every incoming branch. Very long branch
 * groups use longest causal path instead: exclusive spans become too
 * conservative around asynchronous multi-parent histories. Equal scores use
 * numeric-aware event IDs via {@link compareEventIds}, so the output remains
 * deterministic.
 */
export const getBranchPreservingTopologicalOrder = (
  view: TopologicalOrderView,
): EventId[] => {
  const remainingParents = new Map<EventId, number>();
  const ids = Array.from(view.eventIds);
  const roots: EventId[] = [];

  for (const id of ids) {
    const parentCount = view.parentCountOf(id);
    remainingParents.set(id, parentCount);
    if (parentCount === 0) {
      roots.push(id);
    }
  }

  // EventGraph insertion order is already topological. Walking it backwards
  // lets each parent accumulate its single-parent descendants in O(V + E).
  // Redundant ancestor parents can make this estimate conservative, but they
  // cannot affect the validity of the eventual topological traversal.
  const exclusiveSpan = new Map<EventId, number>();
  const longestPath = new Map<EventId, number>();
  for (let index = ids.length - 1; index >= 0; index--) {
    const id = ids[index]!;
    let span = 1;
    let path = 1;
    for (const childId of view.childrenOf(id)) {
      if (remainingParents.get(childId) === 1) {
        span += exclusiveSpan.get(childId) ?? 0;
      }
      path = Math.max(path, 1 + (longestPath.get(childId) ?? 0));
    }
    exclusiveSpan.set(id, span);
    longestPath.set(id, path);
  }

  const compareExclusive = (left: EventId, right: EventId): number => {
    const difference =
      (exclusiveSpan.get(left) ?? 1) - (exclusiveSpan.get(right) ?? 1);
    return difference === 0 ? compareEventIds(left, right) : difference;
  };
  const compareLongest = (left: EventId, right: EventId): number => {
    const difference =
      (longestPath.get(left) ?? 1) - (longestPath.get(right) ?? 1);
    return difference === 0 ? compareEventIds(left, right) : difference;
  };
  const sortBranchGroup = (group: EventId[]): void => {
    const hasLongExclusiveBranch = group.some(
      (id) => (exclusiveSpan.get(id) ?? 1) > MAX_EXCLUSIVE_BRANCH_SPAN,
    );
    group.sort(hasLongExclusiveBranch ? compareLongest : compareExclusive);
  };
  sortBranchGroup(roots);

  // The stack is the deferred set: events that became ready but are not the
  // natural continuation of the branch we're currently walking. We push
  // children in descending priority so the shortest branch is on top and is
  // popped next. The Event ID tie-break keeps traversal deterministic across
  // input shapes.
  const stack: EventId[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push(roots[i]!);
  }

  const result: EventId[] = [];
  const visited = new Set<EventId>();

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    result.push(id);

    const newlyReady: EventId[] = [];
    for (const childId of view.childrenOf(id)) {
      const remaining = (remainingParents.get(childId) ?? 0) - 1;
      remainingParents.set(childId, remaining);
      if (remaining === 0) {
        newlyReady.push(childId);
      }
    }
    if (newlyReady.length === 0) {
      continue;
    }
    sortBranchGroup(newlyReady);
    for (let i = newlyReady.length - 1; i >= 0; i--) {
      stack.push(newlyReady[i]!);
    }
  }

  if (result.length !== view.eventCount) {
    throw new Error("Cycle detected in event graph");
  }

  return result;
};
