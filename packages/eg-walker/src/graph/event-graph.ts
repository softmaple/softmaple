/**
 * Event graph management for Section 3.1
 *
 * The event graph is the only persistent storage besides plain text.
 * No CRDT metadata is stored here.
 */

import type { GraphEvent, EventId, SerializedGraph } from "../types";

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
      throw new Error(`Event ${event.id} already exists`);
    }

    // Validate dependencies exist
    for (const parentId of event.parentVersion) {
      if (!this.events.has(parentId)) {
        throw new Error(`Missing parent event: ${parentId}`);
      }
    }

    // Add event
    this.events.set(event.id, event);

    // Update parent/child relationships
    for (const parentId of event.parentVersion) {
      // Add as child of parent
      const children = this.childrenMap.get(parentId) || new Set();
      children.add(event.id);
      this.childrenMap.set(parentId, children);

      // Add parent relationship
      const parents = this.parentsMap.get(event.id) || new Set();
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

    const visit = (eventId: EventId): void => {
      if (expanded.has(eventId)) {
        return;
      }

      const event = this.events.get(eventId);
      if (!event) {
        return;
      }

      expanded.add(eventId);
      for (const parentId of event.parentVersion) {
        visit(parentId);
      }
    };

    for (const eventId of version) {
      visit(eventId);
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
   * Get events in topological order
   */
  getTopologicalOrder(): ReadonlyArray<GraphEvent> {
    const result: GraphEvent[] = [];
    const visited = new Set<EventId>();
    const visiting = new Set<EventId>();

    const visit = (id: EventId): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error("Cycle detected in event graph");
      }

      visiting.add(id);

      const event = this.events.get(id);
      if (!event) return;

      // Visit parents first
      for (const parentId of event.parentVersion) {
        visit(parentId);
      }

      visiting.delete(id);
      visited.add(id);
      result.push(event);
    };

    // Visit all events
    // Sort event IDs to ensure deterministic order
    const sortedIds = Array.from(this.events.keys()).sort();
    for (const id of sortedIds) {
      visit(id);
    }

    return result;
  }

  /**
   * Get children of an event
   */
  getChildren(id: EventId): ReadonlySet<EventId> {
    return this.childrenMap.get(id) || new Set();
  }

  /**
   * Get parents of an event
   */
  getParents(id: EventId): ReadonlySet<EventId> {
    return this.parentsMap.get(id) || new Set();
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
  serialize(): SerializedGraph {
    const events = this.getAllEvents();
    return {
      version: this.getFrontier(),
      events: events.map((e) => ({
        ...e,
        parentVersion: new Set(Array.from(e.parentVersion)),
      })),
      metadata: this.metadata,
    };
  }

  /**
   * Deserialize event graph from persistence
   */
  static deserialize(data: SerializedGraph): EventGraph {
    const graph = new EventGraph();

    // Restore metadata
    if (data.metadata) {
      graph.metadata = data.metadata;
    }

    const pending = data.events.map((e) => ({
      id: e.id,
      operation: e.operation,
      parentVersion: new Set(e.parentVersion),
      timestamp: e.timestamp,
    }));

    while (pending.length > 0) {
      const index = pending.findIndex((event) =>
        Array.from(event.parentVersion).every((parentId) =>
          graph.hasEvent(parentId),
        ),
      );

      if (index === -1) {
        const missingParents = pending.flatMap((event) =>
          Array.from(event.parentVersion).filter(
            (parentId) => !graph.hasEvent(parentId),
          ),
        );
        throw new Error(
          `Cannot deserialize event graph with missing parents: ${[
            ...new Set(missingParents),
          ].join(", ")}`,
        );
      }

      const eventData = pending.splice(index, 1)[0];
      if (!eventData) {
        continue;
      }

      const event: GraphEvent = {
        id: eventData.id,
        operation: eventData.operation,
        parentVersion: eventData.parentVersion,
        timestamp: eventData.timestamp,
      };
      graph.addEvent(event);
    }

    return graph;
  }
}
