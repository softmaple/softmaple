import type { EventId, GraphEvent } from "../../types";
import { compareEventIds } from "../event-id";
import { MaxHeap } from "./max-heap";

interface TopologicalOrderView {
  readonly events: ReadonlyMap<EventId, GraphEvent>;
  readonly childrenMap: ReadonlyMap<EventId, ReadonlySet<EventId>>;
}

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
