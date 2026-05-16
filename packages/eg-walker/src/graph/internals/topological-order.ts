import type { EventId, GraphEvent } from "../../types";
import { compareEventIds } from "../event-id";
import { MaxHeap } from "./max-heap";

interface TopologicalOrderView {
  readonly events: ReadonlyMap<EventId, GraphEvent>;
  readonly childrenMap: ReadonlyMap<EventId, ReadonlySet<EventId>>;
}

/**
 * Kahn's algorithm with a heap-backed ready queue, breaking ties by
 * numeric-aware event id via {@link compareEventIds}. The heap stays a
 * max-heap with an inverted comparator so each `pop` returns the lex-smallest
 * ready event, matching the previous shift+insertion-sort implementation
 * byte-for-byte — important because the columnar codec's on-disk bytes are
 * keyed off this ordering.
 */
export const getTopologicalOrder = (
  view: TopologicalOrderView,
): GraphEvent[] => {
  const remainingParents = new Map<EventId, number>();
  const ready = new MaxHeap<EventId>((left, right) =>
    compareEventIds(right, left),
  );

  for (const [id, event] of view.events) {
    remainingParents.set(id, event.parentVersion.size);
    if (event.parentVersion.size === 0) {
      ready.push(id);
    }
  }

  const result: GraphEvent[] = [];
  while (ready.size > 0) {
    const id = ready.pop()!;
    const event = view.events.get(id);
    if (!event) {
      continue;
    }
    result.push(event);

    for (const childId of view.childrenMap.get(id) ?? []) {
      const remaining = (remainingParents.get(childId) ?? 0) - 1;
      remainingParents.set(childId, remaining);
      if (remaining === 0) {
        ready.push(childId);
      }
    }
  }

  if (result.length !== view.events.size) {
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
 * Roots and sibling branches are ordered by numeric-aware event id via
 * {@link compareEventIds} so the output is a deterministic function of the
 * graph.
 */
export const getBranchPreservingTopologicalOrder = (
  view: TopologicalOrderView,
): GraphEvent[] => {
  const remainingParents = new Map<EventId, number>();
  const roots: EventId[] = [];

  for (const [id, event] of view.events) {
    remainingParents.set(id, event.parentVersion.size);
    if (event.parentVersion.size === 0) {
      roots.push(id);
    }
  }
  roots.sort(compareEventIds);

  // The stack is the deferred set: events that became ready but are not the
  // natural continuation of the branch we're currently walking. We push
  // children in descending order so the smallest (by `compareEventIds`) is
  // on top and is popped next, which keeps the traversal deterministic
  // across input shapes.
  const stack: EventId[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push(roots[i]!);
  }

  const result: GraphEvent[] = [];
  const visited = new Set<EventId>();

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) {
      continue;
    }
    const event = view.events.get(id);
    if (!event) {
      continue;
    }
    visited.add(id);
    result.push(event);

    const children = view.childrenMap.get(id);
    if (!children || children.size === 0) {
      continue;
    }

    const newlyReady: EventId[] = [];
    for (const childId of children) {
      const remaining = (remainingParents.get(childId) ?? 0) - 1;
      remainingParents.set(childId, remaining);
      if (remaining === 0) {
        newlyReady.push(childId);
      }
    }
    if (newlyReady.length === 0) {
      continue;
    }
    newlyReady.sort(compareEventIds);
    for (let i = newlyReady.length - 1; i >= 0; i--) {
      stack.push(newlyReady[i]!);
    }
  }

  if (result.length !== view.events.size) {
    throw new Error("Cycle detected in event graph");
  }

  return result;
};
