import {
  EventGraph,
  type EventId,
  type GraphEvent,
} from "@softmaple/eg-walker";

import type { WireGraphEvent } from "./types";

export interface SyncState {
  readonly frontier: EventId[];
  readonly knownEventIds: EventId[];
}

export interface SyncResponseState extends SyncState {
  readonly events: WireGraphEvent[];
}

export const encodeWireEvent = (event: GraphEvent): WireGraphEvent => ({
  id: event.id,
  operation: { ...event.operation },
  parentVersion: Array.from(event.parentVersion),
  timestamp: event.timestamp,
});

export const decodeWireEvent = (event: WireGraphEvent): GraphEvent => {
  if (!Array.isArray(event.parentVersion)) {
    throw new Error(`wire event ${event.id} parentVersion must be an array`);
  }
  return {
    id: event.id,
    operation: { ...event.operation },
    parentVersion: new Set(event.parentVersion),
    timestamp: event.timestamp,
  };
};

export const decodeWireEvents = (
  events: ReadonlyArray<WireGraphEvent>,
): GraphEvent[] => events.map(decodeWireEvent);

/**
 * Decode IndexedDB rows written before parent versions became JSON-safe.
 * Structured cloning preserved those parent versions as Set instances; the
 * next save rewrites them through encodeWireEvent and completes the migration.
 */
export const decodeStoredEvents = (
  events: ReadonlyArray<WireGraphEvent | GraphEvent>,
): GraphEvent[] =>
  events.map((event) => {
    if (Array.isArray(event.parentVersion)) {
      return decodeWireEvent(event as WireGraphEvent);
    }
    if (event.parentVersion instanceof Set) {
      return {
        id: event.id,
        operation: { ...event.operation },
        parentVersion: new Set(event.parentVersion),
        timestamp: event.timestamp,
      };
    }
    throw new Error(
      `stored event ${event.id} parentVersion must be an array or Set`,
    );
  });

export const createSyncState = (
  events: ReadonlyArray<GraphEvent>,
): SyncState => {
  const frontier = new Set(events.map((event) => event.id));
  for (const event of events) {
    for (const parentId of event.parentVersion) {
      frontier.delete(parentId);
    }
  }
  return {
    frontier: events
      .filter((event) => frontier.has(event.id))
      .map((event) => event.id),
    knownEventIds: events.map((event) => event.id),
  };
};

/** Return the requester's causal-set difference in parent-before-child order. */
export const selectMissingWireEvents = (
  localEvents: ReadonlyArray<GraphEvent>,
  requesterKnownEventIds: ReadonlyArray<EventId>,
): WireGraphEvent[] => {
  const known = new Set(requesterKnownEventIds);
  const graph = EventGraph.fromEvents(localEvents);
  return graph
    .getTopologicalOrder()
    .filter((event) => !known.has(event.id))
    .map(encodeWireEvent);
};

export const createSyncResponseState = (
  localEvents: ReadonlyArray<GraphEvent>,
  requesterKnownEventIds: ReadonlyArray<EventId>,
): SyncResponseState => ({
  ...createSyncState(localEvents),
  events: selectMissingWireEvents(localEvents, requesterKnownEventIds),
});
