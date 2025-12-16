/**
 * Event graph management for Section 3.1
 *
 * The event graph is the only persistent storage besides plain text.
 * No CRDT metadata is stored here.
 */

import type { GraphEvent, EventId, Version, SerializedGraph } from "../types";

// Re-export GraphEvent for use by other modules
export type { GraphEvent } from "../types";

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
    for (const id of this.events.keys()) {
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
      version: new Set<EventId>(Array.from(this.events.keys())),
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

    for (const e of data.events) {
      const event: GraphEvent = {
        id: e.id,
        operation: e.operation,
        parentVersion: new Set(e.parentVersion),
        timestamp: e.timestamp,
      };
      graph.addEvent(event);
    }

    return graph;
  }
}
