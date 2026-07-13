import type { EventId, GraphEvent, Version } from "../../types";

export interface KnownEventSource {
  hasEvent(eventId: EventId): boolean;
}

/**
 * Return whether a prepared remote batch is causally closed over the current
 * graph and can therefore be integrated without consulting an existing pending
 * queue.
 *
 * Candidate order is irrelevant: a parent is ready when it is already in the
 * graph or appears anywhere in the same batch. Duplicate and cycle validation
 * remains the responsibility of the batch preparation step.
 */
export const isClosedReadyBatch = (
  candidates: ReadonlyArray<GraphEvent>,
  graph: KnownEventSource,
  pendingCount: number,
): boolean => {
  if (pendingCount !== 0) {
    return false;
  }

  const candidateIds = new Set(candidates.map(({ id }) => id));
  for (const { parentVersion } of candidates) {
    for (const parentId of parentVersion) {
      if (!candidateIds.has(parentId) && !graph.hasEvent(parentId)) {
        return false;
      }
    }
  }
  return true;
};

/**
 * Return whether a batch is already in causal order and every event is new.
 *
 * This is the allocation-light receive fast path used by persistence and
 * causal-diff transports. It lets the replica skip the general batch's
 * duplicate index, child adjacency map, indegree map, and priority queue.
 * Any duplicate, external missing parent, or out-of-order parent falls back
 * to the general preparation path so its public buffering semantics remain
 * unchanged.
 */
export const isTopologicallyReadyBatch = (
  candidates: ReadonlyArray<GraphEvent>,
  graph: KnownEventSource,
  pendingCount: number,
): boolean => {
  if (pendingCount !== 0) {
    return false;
  }

  const acceptedIds = new Set<EventId>();
  for (const event of candidates) {
    if (graph.hasEvent(event.id) || acceptedIds.has(event.id)) {
      return false;
    }
    for (const parentId of event.parentVersion) {
      if (!graph.hasEvent(parentId) && !acceptedIds.has(parentId)) {
        return false;
      }
    }
    acceptedIds.add(event.id);
  }
  return true;
};

/** Return whether an already-topological batch is one exact causal chain. */
export const isOrderedLinearBatchFromVersion = (
  candidates: ReadonlyArray<GraphEvent>,
  currentVersion: Version,
): boolean => {
  const first = candidates[0];
  if (first === undefined) {
    return true;
  }
  if (!versionsEqual(first.parentVersion, currentVersion)) {
    return false;
  }

  let previousId = first.id;
  for (let index = 1; index < candidates.length; index++) {
    const event = candidates[index]!;
    if (
      event.parentVersion.size !== 1 ||
      !event.parentVersion.has(previousId)
    ) {
      return false;
    }
    previousId = event.id;
  }
  return true;
};

/**
 * Return whether every candidate belongs to one causal chain extending
 * `currentVersion`.
 *
 * The input may be unordered. The first event must name `currentVersion`
 * exactly; every later event must have exactly one parent, the preceding event
 * in the chain. Concurrent siblings, merges inside the batch, disconnected
 * events, duplicate IDs, and cycles all return false.
 */
export const isLinearBatchFromVersion = (
  candidates: ReadonlyArray<GraphEvent>,
  currentVersion: Version,
): boolean => {
  if (candidates.length === 0) {
    return true;
  }

  const candidatesById = new Map<EventId, GraphEvent>();
  for (const event of candidates) {
    if (candidatesById.has(event.id) || currentVersion.has(event.id)) {
      return false;
    }
    candidatesById.set(event.id, event);
  }

  const roots: GraphEvent[] = [];
  const childByParentId = new Map<EventId, GraphEvent>();
  for (const event of candidates) {
    const candidateParents = Array.from(event.parentVersion).filter(
      (parentId) => candidatesById.has(parentId),
    );
    if (candidateParents.length === 0) {
      if (!versionsEqual(event.parentVersion, currentVersion)) {
        return false;
      }
      roots.push(event);
      continue;
    }

    if (candidateParents.length !== 1 || event.parentVersion.size !== 1) {
      return false;
    }
    const parentId = candidateParents[0]!;
    if (childByParentId.has(parentId)) {
      return false;
    }
    childByParentId.set(parentId, event);
  }

  if (roots.length !== 1) {
    return false;
  }

  let visited = 0;
  let current: GraphEvent | undefined = roots[0];
  while (current !== undefined) {
    visited++;
    current = childByParentId.get(current.id);
  }
  return visited === candidates.length;
};

const versionsEqual = (
  left: ReadonlySet<EventId>,
  right: ReadonlySet<EventId>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const eventId of left) {
    if (!right.has(eventId)) {
      return false;
    }
  }
  return true;
};
