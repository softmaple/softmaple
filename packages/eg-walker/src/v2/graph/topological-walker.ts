/**
 * Section 3.2 — Walking the event graph
 * Topological traversal of the event graph with efficient ordering
 */

import type { EventId, Version } from "../types";
import type { GraphEvent } from "../graph/event-graph";

export interface EventGraphWalker {
  /**
   * Returns events in topological order (parents before children)
   * Keeps events from same branch grouped when possible
   * Deterministic ordering for concurrent events
   */
  topologicalOrder(): EventId[];

  /**
   * Get all parent event IDs for an event
   */
  getParents(eventId: EventId): EventId[];

  /**
   * Get all events in the graph
   */
  getAllEvents(): GraphEvent[];

  /**
   * Add an event to the graph (for building)
   */
  addEvent(event: GraphEvent): void;
}

/**
 * Default implementation of event graph walker
 * Uses depth-first post-order traversal with branch grouping
 */
export class DefaultEventGraphWalker implements EventGraphWalker {
  private events = new Map<EventId, GraphEvent>();
  private children = new Map<EventId, Set<EventId>>();
  private topoOrderCache: EventId[] | null = null;

  addEvent(event: GraphEvent): void {
    this.events.set(event.id, event);
    this.topoOrderCache = null; // Invalidate cache

    // Build parent-child relationships
    for (const parentId of event.parentVersion) {
      if (!this.children.has(parentId)) {
        this.children.set(parentId, new Set());
      }
      this.children.get(parentId)!.add(event.id);
    }
  }

  getAllEvents(): GraphEvent[] {
    return Array.from(this.events.values());
  }

  getParents(eventId: EventId): EventId[] {
    const event = this.events.get(eventId);
    if (!event) return [];
    return Array.from(event.parentVersion);
  }

  topologicalOrder(): EventId[] {
    if (this.topoOrderCache) {
      return this.topoOrderCache;
    }

    const result: EventId[] = [];
    const visited = new Set<EventId>();
    const processed = new Set<EventId>(); // Track fully processed nodes

    // DFS post-order traversal
    const visit = (id: EventId): void => {
      if (processed.has(id)) return;

      if (visited.has(id)) {
        // If we're currently visiting this node, it's a cycle
        throw new Error(`Cycle detected in event graph at event ${id}`);
      }

      visited.add(id);

      // Visit parents first (ensures causality)
      const event = this.events.get(id);
      if (event) {
        for (const parentId of event.parentVersion) {
          if (this.events.has(parentId)) {
            visit(parentId);
          }
        }
      }

      // Add to result after visiting all parents
      visited.delete(id);
      processed.add(id);
      result.push(id);
    };

    // Find roots (events with no parents in the graph)
    const roots = new Set<EventId>();
    for (const [id, event] of this.events) {
      if (event.parentVersion.size === 0) {
        roots.add(id);
      } else {
        // Check if all parents are outside the graph
        let hasParentInGraph = false;
        for (const parentId of event.parentVersion) {
          if (this.events.has(parentId)) {
            hasParentInGraph = true;
            break;
          }
        }
        if (!hasParentInGraph) {
          roots.add(id);
        }
      }
    }

    // Visit from roots in deterministic order
    const sortedRoots = Array.from(roots).sort();
    for (const rootId of sortedRoots) {
      visit(rootId);
    }

    // Visit any remaining unvisited events (handles disconnected components)
    const sortedIds = Array.from(this.events.keys()).sort();
    for (const id of sortedIds) {
      visit(id);
    }

    this.topoOrderCache = result;
    return result;
  }
}
