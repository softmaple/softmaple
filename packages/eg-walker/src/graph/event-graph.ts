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
 * Event graph for storing operation history
 * This is what gets persisted to disk
 */
export class EventGraph {
  private readonly events: Map<EventId, GraphEvent> = new Map();
  private readonly childrenMap: Map<EventId, Set<EventId>> = new Map();
  private readonly parentsMap: Map<EventId, Set<EventId>> = new Map();
  private metadata: Record<string, unknown> = {};

  /**
   * Remove all events and metadata from the graph.
   */
  clear(): void {
    this.events.clear();
    this.childrenMap.clear();
    this.parentsMap.clear();
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
   */
  diffVersions(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
  ): { readonly onlyInLeft: Set<EventId>; readonly onlyInRight: Set<EventId> } {
    const leftExpanded = this.expandVersion(left);
    const rightExpanded = this.expandVersion(right);
    const onlyInLeft = new Set<EventId>();
    const onlyInRight = new Set<EventId>();

    for (const eventId of leftExpanded) {
      if (!rightExpanded.has(eventId)) {
        onlyInLeft.add(eventId);
      }
    }

    for (const eventId of rightExpanded) {
      if (!leftExpanded.has(eventId)) {
        onlyInRight.add(eventId);
      }
    }

    return { onlyInLeft, onlyInRight };
  }

  /**
   * Get events in topological order (Kahn's algorithm; iterative).
   *
   * Sorts ties by event ID for deterministic output.
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
    ready.sort();

    const result: GraphEvent[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      const event = this.events.get(id);
      if (!event) {
        continue;
      }
      result.push(event);

      const children = Array.from(this.childrenMap.get(id) ?? []).sort();
      for (const childId of children) {
        const remaining = (remainingParents.get(childId) ?? 0) - 1;
        remainingParents.set(childId, remaining);
        if (remaining === 0) {
          // Insertion-sort into ready to keep deterministic order without
          // re-sorting the whole queue.
          let insertionIndex = ready.findIndex((pending) => pending > childId);
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
