/**
 * Section 3.6: Partial Replay (Efficient Reconstruction)
 * Implements efficient partial replay of events after state clearing
 */

import type { EventId, Version } from "../types";
import type { GraphEvent, EventGraph } from "../graph/event-graph";
import type { InternalCRDTState } from "../crdt/internal-state";

/**
 * Interface for a version object that contains events
 */
interface VersionWithEvents {
  events: EventId[];
}

/**
 * Type predicate to check if a value is a VersionWithEvents
 */
function isVersionWithEvents(v: unknown): v is VersionWithEvents {
  return (
    typeof v === 'object' &&
    v !== null &&
    'events' in v &&
    Array.isArray((v as VersionWithEvents).events)
  );
}

/**
 * Manages partial replay of events when state has been cleared
 */
export class PartialReplayManager {
  private eventGraph: EventGraph;
  private eventCache: Map<EventId, GraphEvent>;
  private replayHistory: Set<EventId>;

  constructor(eventGraph: EventGraph) {
    this.eventGraph = eventGraph;
    this.eventCache = new Map();
    this.replayHistory = new Set();
  }

  /**
 * Compute the minimal set of events to replay from one version to another
 * O(k log k) where k is the number of events to replay
 */
computeReplayRange(from: Version, to: Version): EventId[] {
  // Extract event IDs from versions
  const fromEvents = this.extractEventIds(from);
  const toEvents = this.extractEventIds(to);

  // Find events that are in 'to' but not in 'from'
  const newEvents = new Set<EventId>();
  for (const eventId of toEvents) {
    if (!fromEvents.has(eventId)) {
      newEvents.add(eventId);
    }
  }

    // Compute minimal dependency set
    // This will include all dependencies of the new events
    const dependencies = this.computeDependencies(newEvents);

    // Remove any dependencies that are already in the from version
    const eventsToReplay = new Set<EventId>();
    for (const eventId of dependencies) {
      if (!fromEvents.has(eventId)) {
        eventsToReplay.add(eventId);
      }
    }

  // Sort topologically for replay order
  return this.topologicalSort(eventsToReplay);
}

  /**
   * Replay a set of events to reconstruct state
   * Must reconstruct prepare-state deterministically
   */
  replayEvents(events: EventId[], state: InternalCRDTState): void {
    // Clear any existing prepare state
    state.clearPrepareState();

    // Track what we're replaying to avoid duplicates
    const replayingSet = new Set(events);

    // Process each event in order
    for (const eventId of events) {
      // Skip if already replayed in this session
      if (this.replayHistory.has(eventId)) {
        continue;
      }

      // Get the event
      const event = this.getEvent(eventId);
      if (!event) {
        console.warn(`Event ${eventId} not found for replay`);
        continue;
      }

      // Check if dependencies are satisfied
      const depsReady = this.checkDependencies(event, replayingSet);
      if (!depsReady) {
        console.warn(`Skipping ${eventId} - dependencies not ready`);
        continue;
      }

      // Apply the event to reconstruct state
      this.applyEventForReplay(event, state);

      // Mark as replayed
      this.replayHistory.add(eventId);
    }
  }

  /**
   * Support placeholder reconstruction from cleared state
   */
  reconstructPlaceholders(state: InternalCRDTState, criticalVersion: Version): void {
    // Get all events up to critical version
    const eventsToReconstruct = this.computeReplayRange(
      this.emptyVersion(),
      criticalVersion,
    );

    // Filter to only deleted/tombstoned events that need placeholders
    const placeholderEvents = eventsToReconstruct.filter((eventId) => {
      const event = this.getEvent(eventId);
      return event && this.needsPlaceholder(event);
    });

    // Replay just the placeholder events
    for (const eventId of placeholderEvents) {
      const event = this.getEvent(eventId);
      if (event) {
        state.addPlaceholder(event.id, event);
      }
    }
  }

  // ============================================================================
  // Private helper methods
  // ============================================================================

  /**
   * Extract event IDs from a version
   */
  private extractEventIds(version: Version): Set<EventId> {
    if (version instanceof Set) {
      return new Set(version);
    }
    if (Array.isArray(version)) {
      return new Set(version);
    }
    if (isVersionWithEvents(version)) {
      return new Set(version.events);
    }
    return new Set();
  }

  /**
   * Compute minimal dependency set for a set of events
   */
  private computeDependencies(events: Set<EventId>): Set<EventId> {
    const dependencies = new Set<EventId>();
    const visited = new Set<EventId>();
    const queue = Array.from(events);

    while (queue.length > 0) {
      const eventId = queue.shift()!;
      if (visited.has(eventId)) {
        continue;
      }
      visited.add(eventId);
      dependencies.add(eventId);

      // Add parent dependencies
      const event = this.getEvent(eventId);
      if (event && event.parentVersion) {
        const parents = this.extractEventIds(event.parentVersion);
        for (const parentId of parents) {
          if (!visited.has(parentId)) {
            queue.push(parentId);
          }
        }
      }
    }

    return dependencies;
  }

  /**
   * Topologically sort events for replay
   * O(k log k) where k is number of events
   */
  private topologicalSort(events: Set<EventId>): EventId[] {
    const graph = new Map<EventId, Set<EventId>>();
    const inDegree = new Map<EventId, number>();

    // Build adjacency graph
    for (const eventId of events) {
      if (!graph.has(eventId)) {
        graph.set(eventId, new Set());
        inDegree.set(eventId, 0);
      }

      const event = this.getEvent(eventId);
      if (event && event.parentVersion) {
        const parents = this.extractEventIds(event.parentVersion);
        for (const parentId of parents) {
          if (events.has(parentId)) {
            // Parent is in our replay set
            if (!graph.has(parentId)) {
              graph.set(parentId, new Set());
              inDegree.set(parentId, 0);
            }
            graph.get(parentId)!.add(eventId);
            inDegree.set(eventId, (inDegree.get(eventId) || 0) + 1);
          }
        }
      }
    }

    // Kahn's algorithm for topological sort
    const queue: EventId[] = [];
    const result: EventId[] = [];

    // Find all nodes with in-degree 0
    for (const [eventId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(eventId);
      }
    }

    // Process queue
    while (queue.length > 0) {
      // Sort queue for deterministic ordering
      queue.sort();
      const eventId = queue.shift()!;
      result.push(eventId);

      // Reduce in-degree of neighbors
      const neighbors = graph.get(eventId) || new Set();
      for (const neighbor of neighbors) {
        const degree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, degree);
        if (degree === 0) {
          queue.push(neighbor);
        }
      }
    }

    return result;
  }

  /**
 * Get an event by ID (from cache or graph)
 */
private getEvent(eventId: EventId): GraphEvent | null {
  // Check cache first
  if (this.eventCache.has(eventId)) {
    return this.eventCache.get(eventId)!;
  }

  // Get from graph
  const event = this.eventGraph.getEvent(eventId);
  if (event) {
    this.eventCache.set(eventId, event);
      return event;
  }
    return null;
}

  /**
   * Check if all dependencies for an event are satisfied
   */
  private checkDependencies(event: GraphEvent, replayingSet: Set<EventId>): boolean {
    if (!event.parentVersion) {
      return true;
    }

    const parents = this.extractEventIds(event.parentVersion);
    for (const parentId of parents) {
      if (replayingSet.has(parentId) && !this.replayHistory.has(parentId)) {
        // Parent is in replay set but hasn't been replayed yet
        return false;
      }
    }

    return true;
  }

  /**
   * Apply an event during replay
   */
  private applyEventForReplay(event: GraphEvent, state: InternalCRDTState): void {
    // Switch to prepare state for replay
    state.switchToPrepareState();

    // Apply the operation
    if (event.operation) {
      state.applyOperation(event.operation, event.id);
    }

    // Switch back to effect state
    state.switchToEffectState();
  }

  /**
   * Check if an event needs a placeholder after clearing
   */
  private needsPlaceholder(event: GraphEvent): boolean {
    // Deleted operations need placeholders
    if (event.operation && "type" in event.operation) {
      return event.operation.type === "delete";
    }
    return false;
  }

  /**
   * Get an empty version
   */
  private emptyVersion(): Version {
    return new Set<EventId>();
  }

  /**
   * Clear the replay history (for testing)
   */
  clearReplayHistory(): void {
    this.replayHistory.clear();
  }
}

/**
 * Export convenience functions
 */
export function computeReplayRange(
  manager: PartialReplayManager,
  from: Version,
  to: Version,
): EventId[] {
  return manager.computeReplayRange(from, to);
}

export function replayEvents(
  manager: PartialReplayManager,
  events: EventId[],
  state: InternalCRDTState,
): void {
  manager.replayEvents(events, state);
}
