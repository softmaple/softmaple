/**
 * Event graph management for Section 3.1
 *
 * The event graph is the only persistent storage besides plain text.
 * No CRDT metadata is stored here.
 */

import type {
  GraphEvent,
  EventId,
  SerializedGraphInput,
  SerializedGraphOutput,
} from "../types";

/**
 * Coerce a deserialized parent-version value into an array of event IDs.
 *
 * Tolerates the JSON-safe array form, in-memory `Set` instances, and generic
 * iterables. The final `Object.keys` branch is a defensive landing zone for
 * payloads produced by `JSON.stringify`ing a `Set` (which produces `{}`) — it
 * cannot recover the original IDs in that case and returns `[]`, but it
 * prevents a hard crash on malformed legacy data. Pre-1.0 callers that may
 * still hold such payloads must re-serialize through the current code path.
 */
const normalizeEventIds = (value: unknown): EventId[] => {
  if (Array.isArray(value)) {
    return value.filter((id): id is EventId => typeof id === "string");
  }

  if (value instanceof Set) {
    return Array.from(value).filter(
      (id): id is EventId => typeof id === "string",
    );
  }

  if (value && typeof value === "object") {
    const maybeIterable = value as { [Symbol.iterator]?: unknown };
    if (typeof maybeIterable[Symbol.iterator] === "function") {
      return Array.from(value as Iterable<unknown>).filter(
        (id): id is EventId => typeof id === "string",
      );
    }

    // Last resort: payload shape is a non-iterable object. The most common
    // source is JSON.stringify(new Set(...)) producing `{}`; recovery is
    // impossible from this shape.
    return Object.keys(value);
  }

  return [];
};

export class EventAlreadyExistsError extends Error {
  readonly eventId: EventId;

  constructor(eventId: EventId) {
    super(`Event ${eventId} already exists`);
    this.name = "EventAlreadyExistsError";
    this.eventId = eventId;
  }
}

export class MissingParentError extends Error {
  readonly parentId: EventId;

  constructor(parentId: EventId) {
    super(`Missing parent event: ${parentId}`);
    this.name = "MissingParentError";
    this.parentId = parentId;
  }
}

/**
 * Lexicographic comparator used as the tie-breaker for both
 * `getTopologicalOrder` and `getBranchPreservingTopologicalOrder`. Kept
 * as a module-level helper so the rule is consistent across roots and
 * sibling branches and easy to swap if the engine ever standardises on
 * numeric-aware ordering (see sub-issue 5).
 */
const compareEventIds = (left: EventId, right: EventId): number => {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
};

/**
 * Bit flags used by `diffVersions` to colour events while running the
 * priority-queue diff. `LEFT` means "reachable from the left frontier",
 * `RIGHT` means "reachable from the right frontier", and `COMMON = LEFT | RIGHT`
 * means the event is a shared ancestor.
 */
const DIFF_COLOR = {
  LEFT: 1,
  RIGHT: 2,
  COMMON: 3,
} as const;

/**
 * Minimal binary max-heap. The eg-walker package does not depend on a
 * priority-queue library, and `diffVersions` is the only consumer, so we
 * keep a small inline implementation rather than pulling in a dependency.
 */
class MaxHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(value: T): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[index]!, this.items[parent]!) <= 0) {
        return;
      }
      const tmp = this.items[index]!;
      this.items[index] = this.items[parent]!;
      this.items[parent] = tmp;
      index = parent;
    }
  }

  private siftDown(index: number): void {
    const length = this.items.length;
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let largest = index;
      if (
        left < length &&
        this.compare(this.items[left]!, this.items[largest]!) > 0
      ) {
        largest = left;
      }
      if (
        right < length &&
        this.compare(this.items[right]!, this.items[largest]!) > 0
      ) {
        largest = right;
      }
      if (largest === index) {
        return;
      }
      const tmp = this.items[index]!;
      this.items[index] = this.items[largest]!;
      this.items[largest] = tmp;
      index = largest;
    }
  }
}

/**
 * Event graph for storing operation history
 * This is what gets persisted to disk
 */
export class EventGraph {
  private readonly events: Map<EventId, GraphEvent> = new Map();
  private readonly childrenMap: Map<EventId, Set<EventId>> = new Map();
  private readonly parentsMap: Map<EventId, Set<EventId>> = new Map();
  /**
   * Monotonically increasing rank assigned to each event in the order it was
   * inserted into the graph. Because `addEvent` rejects events whose parents
   * are not already present, `insertionRank(parent) < insertionRank(child)`
   * for every edge, so the rank is a valid (cheap) topological index that
   * does not require a full Kahn pass to compute.
   */
  private readonly insertionRank: Map<EventId, number> = new Map();
  private metadata: Record<string, unknown> = {};

  /**
   * Remove all events and metadata from the graph.
   */
  clear(): void {
    this.events.clear();
    this.childrenMap.clear();
    this.parentsMap.clear();
    this.insertionRank.clear();
    this.metadata = {};
  }

  /**
   * Add an event to the graph
   */
  addEvent(event: GraphEvent): void {
    if (this.events.has(event.id)) {
      throw new EventAlreadyExistsError(event.id);
    }

    for (const parentId of event.parentVersion) {
      if (!this.events.has(parentId)) {
        throw new MissingParentError(parentId);
      }
    }

    this.events.set(event.id, event);
    this.insertionRank.set(event.id, this.insertionRank.size);

    for (const parentId of event.parentVersion) {
      const children = this.childrenMap.get(parentId) ?? new Set();
      children.add(event.id);
      this.childrenMap.set(parentId, children);

      const parents = this.parentsMap.get(event.id) ?? new Set();
      parents.add(parentId);
      this.parentsMap.set(event.id, parents);
    }
  }

  /**
   * Get an event by ID
   */
  getEvent(id: EventId): GraphEvent | undefined {
    return this.events.get(id);
  }

  /**
   * Check if an event exists in the graph
   */
  hasEvent(id: EventId): boolean {
    return this.events.has(id);
  }

  /**
   * Get all events
   */
  getAllEvents(): ReadonlyArray<GraphEvent> {
    return Array.from(this.events.values());
  }

  /**
   * Store non-CRDT persistence metadata alongside the graph.
   */
  setMetadata(metadata: Record<string, unknown>): void {
    this.metadata = { ...metadata };
  }

  /**
   * Read persistence metadata without exposing mutable internal state.
   */
  getMetadata(): Record<string, unknown> {
    return { ...this.metadata };
  }

  /**
   * Get the frontier version: events with no known children.
   */
  getFrontier(): Set<EventId> {
    const frontier = new Set<EventId>();

    for (const eventId of this.events.keys()) {
      const children = this.childrenMap.get(eventId);
      if (!children || children.size === 0) {
        frontier.add(eventId);
      }
    }

    return frontier;
  }

  /**
   * Expand a frontier version to the set of all events it causally includes.
   */
  expandVersion(version: ReadonlySet<EventId>): Set<EventId> {
    const expanded = new Set<EventId>();
    const stack: EventId[] = Array.from(version);

    while (stack.length > 0) {
      const eventId = stack.pop()!;
      if (expanded.has(eventId)) {
        continue;
      }

      const event = this.events.get(eventId);
      if (!event) {
        continue;
      }

      expanded.add(eventId);
      for (const parentId of event.parentVersion) {
        if (!expanded.has(parentId)) {
          stack.push(parentId);
        }
      }
    }

    return expanded;
  }

  /**
   * Compute Appendix B's transitive version diff.
   *
   * Uses a local, merge-base style traversal instead of expanding both
   * versions to their full causal sets. Events from both frontiers are
   * coloured (`LEFT`, `RIGHT`, or `COMMON`) and walked toward their
   * ancestors in descending topological order via a max-heap keyed by
   * insertion rank. Each event has its colour merged with the colours of
   * its visited descendants, so once an event is popped its final colour
   * is known and it can be classified into `onlyInLeft`, `onlyInRight`, or
   * discarded as common.
   *
   * Traversal terminates as soon as every event still in the heap has been
   * resolved to `COMMON`, which means the divergent region has been fully
   * enumerated and any remaining ancestors are guaranteed to be shared.
   * For a deep linear history with a small divergent branch this avoids
   * touching unrelated history, replacing the previous O(|history|)
   * full-expansion behaviour with cost proportional to the diff region.
   */
  diffVersions(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
  ): { readonly onlyInLeft: Set<EventId>; readonly onlyInRight: Set<EventId> } {
    const onlyInLeft = new Set<EventId>();
    const onlyInRight = new Set<EventId>();

    const color = new Map<EventId, number>();
    const heap = new MaxHeap<EventId>(
      (a, b) =>
        (this.insertionRank.get(a) ?? -1) - (this.insertionRank.get(b) ?? -1),
    );

    /**
     * Count of events currently in the heap whose colour is not yet
     * `COMMON`. Once this drops to zero, every remaining heap entry is
     * a common ancestor and its own ancestors must be common as well, so
     * the traversal can terminate early.
     */
    let pendingDivergent = 0;

    const paint = (id: EventId, addedColor: number): void => {
      if (!this.events.has(id)) {
        return;
      }
      const existing = color.get(id) ?? 0;
      const merged = existing | addedColor;
      if (merged === existing) {
        return;
      }
      color.set(id, merged);
      if (existing === 0) {
        heap.push(id);
        if (merged !== DIFF_COLOR.COMMON) {
          pendingDivergent++;
        }
      } else if (
        existing !== DIFF_COLOR.COMMON &&
        merged === DIFF_COLOR.COMMON
      ) {
        // The event was queued as divergent earlier but a second-frontier
        // descendant has just revealed that it is in fact common. It is
        // still in the heap, so adjust the divergent counter without
        // pushing a duplicate entry.
        pendingDivergent--;
      }
    };

    for (const id of left) {
      paint(id, DIFF_COLOR.LEFT);
    }
    for (const id of right) {
      paint(id, DIFF_COLOR.RIGHT);
    }

    while (heap.size > 0 && pendingDivergent > 0) {
      const id = heap.pop()!;
      const finalColor = color.get(id) ?? 0;

      if (finalColor === DIFF_COLOR.LEFT) {
        onlyInLeft.add(id);
        pendingDivergent--;
      } else if (finalColor === DIFF_COLOR.RIGHT) {
        onlyInRight.add(id);
        pendingDivergent--;
      }
      // COMMON events fall through; their colour is propagated below so
      // that ancestors reachable only through this path are also marked
      // as common rather than being mis-classified as one-sided.

      const parents = this.getParents(id);
      for (const parent of parents) {
        paint(parent, finalColor);
      }
    }

    return { onlyInLeft, onlyInRight };
  }

  /**
   * Get events in topological order (Kahn's algorithm; iterative).
   *
   * Sorts ties by event ID for deterministic output. This is the
   * default order consumed by `EgWalkerEngine`, `ReplayWalker`,
   * `PartialReplayManager`, `EgWalkerReplica.fullReplay`, and the
   * columnar codec, so its byte-for-byte output is part of the
   * package's public contract until the engine becomes
   * traversal-order independent (sub-issue 5). For a layout that
   * minimises retreat/advance churn, see
   * {@link getBranchPreservingTopologicalOrder}.
   */
  getTopologicalOrder(): ReadonlyArray<GraphEvent> {
    const remainingParents = new Map<EventId, number>();
    const ready: EventId[] = [];

    for (const [id, event] of this.events) {
      remainingParents.set(id, event.parentVersion.size);
      if (event.parentVersion.size === 0) {
        ready.push(id);
      }
    }
    ready.sort(compareEventIds);

    const result: GraphEvent[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      const event = this.events.get(id);
      if (!event) {
        continue;
      }
      result.push(event);

      const children = Array.from(this.childrenMap.get(id) ?? []).sort(
        compareEventIds,
      );
      for (const childId of children) {
        const remaining = (remainingParents.get(childId) ?? 0) - 1;
        remainingParents.set(childId, remaining);
        if (remaining === 0) {
          // Insertion-sort into ready to keep deterministic order
          // without re-sorting the whole queue.
          let insertionIndex = ready.findIndex(
            (pending) => compareEventIds(pending, childId) > 0,
          );
          if (insertionIndex === -1) {
            insertionIndex = ready.length;
          }
          ready.splice(insertionIndex, 0, childId);
        }
      }
    }

    if (result.length !== this.events.size) {
      throw new Error("Cycle detected in event graph");
    }

    return result;
  }

  /**
   * Branch-preserving topological order (Section 5.2 of the
   * Eg-walker paper).
   *
   * Kahn's algorithm with a sorted ready queue interleaves concurrent
   * branches whenever a child event lex-sorts after a deferred sibling
   * root, which forces the replay engine to retreat and re-advance on
   * every transition. This DFS variant walks one branch as far as
   * possible before starting another, so two consecutive events in
   * the output usually share a parent relationship
   * (`next.parentVersion === {prev.id}`) and
   * `diffVersions(currentVersion, next.parentVersion)` collapses to
   * an empty retreat/advance pair.
   *
   * The output is still a fully deterministic function of the graph:
   * roots and sibling branches are ordered by lexicographic event id
   * via {@link compareEventIds}.
   *
   * Note: this order is NOT yet wired into the default replay path.
   * `EgWalkerEngine.generate` is currently order-sensitive for
   * concurrent inserts, so swapping orders mid-flight would change
   * user-visible document text and on-disk columnar bytes. Once
   * sub-issue 5 lands and the engine becomes traversal-order
   * independent, this method will replace `getTopologicalOrder` at
   * the call sites that care about replay performance.
   *
   * TODO(sub-issue 5): consider weighting sibling branches by
   * estimated subtree size (the paper's optional heuristic) instead
   * of pure lex tie-break to reduce churn further on skewed graphs.
   */
  getBranchPreservingTopologicalOrder(): ReadonlyArray<GraphEvent> {
    const remainingParents = new Map<EventId, number>();
    const roots: EventId[] = [];

    for (const [id, event] of this.events) {
      remainingParents.set(id, event.parentVersion.size);
      if (event.parentVersion.size === 0) {
        roots.push(id);
      }
    }
    roots.sort(compareEventIds);

    // The stack is the deferred set: events that became ready but are
    // not the natural continuation of the branch we're currently
    // walking. We push children in descending order so the smallest
    // (by `compareEventIds`) is on top and is popped next, which keeps
    // the traversal deterministic across input shapes.
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
      const event = this.events.get(id);
      if (!event) {
        continue;
      }
      visited.add(id);
      result.push(event);

      const children = this.childrenMap.get(id);
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

    if (result.length !== this.events.size) {
      throw new Error("Cycle detected in event graph");
    }

    return result;
  }

  /**
   * Get children of an event
   */
  getChildren(id: EventId): ReadonlySet<EventId> {
    return this.childrenMap.get(id) ?? new Set();
  }

  /**
   * Get parents of an event
   */
  getParents(id: EventId): ReadonlySet<EventId> {
    return this.parentsMap.get(id) ?? new Set();
  }

  /**
   * Check if one event is an ancestor of another
   */
  isAncestor(ancestor: EventId, descendant: EventId): boolean {
    if (ancestor === descendant) return false;

    const visited = new Set<EventId>();
    const queue = [descendant];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const parents = this.getParents(current);
      for (const parent of parents) {
        if (parent === ancestor) return true;
        queue.push(parent);
      }
    }

    return false;
  }

  /**
   * Find concurrent events (not causally related)
   */
  areConcurrent(id1: EventId, id2: EventId): boolean {
    return (
      !this.isAncestor(id1, id2) && !this.isAncestor(id2, id1) && id1 !== id2
    );
  }

  /**
   * Serialize event graph for persistence
   * Returns only the data that should be saved to disk
   */
  serialize(): SerializedGraphOutput {
    const events = this.getAllEvents();
    return {
      version: Array.from(this.getFrontier()),
      events: events.map((e) => ({
        ...e,
        parentVersion: Array.from(e.parentVersion),
      })),
      metadata: this.metadata,
    };
  }

  /**
   * Build an EventGraph from an unordered array of in-memory events.
   * Topologically sorts via Kahn's algorithm so callers do not need to
   * pre-sort. Throws if the input contains unresolvable parent references.
   */
  static fromEvents(events: ReadonlyArray<GraphEvent>): EventGraph {
    return EventGraph.deserialize({ version: [], events });
  }

  /**
   * Deserialize event graph from persistence (Kahn's algorithm; O(n)).
   */
  static deserialize(data: SerializedGraphInput): EventGraph {
    const graph = new EventGraph();

    if (data.metadata) {
      graph.metadata = data.metadata;
    }

    const eventsById = new Map<EventId, GraphEvent>();
    const remainingParents = new Map<EventId, number>();
    const childrenIndex = new Map<EventId, EventId[]>();

    for (const incoming of data.events) {
      const event: GraphEvent = {
        id: incoming.id,
        operation: incoming.operation,
        parentVersion: new Set(normalizeEventIds(incoming.parentVersion)),
        timestamp: incoming.timestamp,
      };
      eventsById.set(event.id, event);
      remainingParents.set(event.id, event.parentVersion.size);
      for (const parentId of event.parentVersion) {
        const list = childrenIndex.get(parentId) ?? [];
        list.push(event.id);
        childrenIndex.set(parentId, list);
      }
    }

    const ready: EventId[] = [];
    for (const [id, count] of remainingParents) {
      if (count === 0) {
        ready.push(id);
      }
    }

    let added = 0;
    while (ready.length > 0) {
      const id = ready.pop()!;
      const event = eventsById.get(id);
      if (!event) {
        continue;
      }
      graph.addEvent(event);
      added++;

      for (const childId of childrenIndex.get(id) ?? []) {
        const remaining = (remainingParents.get(childId) ?? 0) - 1;
        remainingParents.set(childId, remaining);
        if (remaining === 0) {
          ready.push(childId);
        }
      }
    }

    if (added !== eventsById.size) {
      const missingParents = new Set<EventId>();
      for (const event of eventsById.values()) {
        for (const parentId of event.parentVersion) {
          if (!eventsById.has(parentId)) {
            missingParents.add(parentId);
          }
        }
      }
      throw new Error(
        `Cannot deserialize event graph with missing parents: ${[
          ...missingParents,
        ].join(", ")}`,
      );
    }

    return graph;
  }
}
