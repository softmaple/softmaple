/**
 * Test helper types and utilities for eg-walker tests
 */

import type { Version, EventId, GraphEvent } from "../types";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import { EgWalkerReplica } from "../core/replica";

/**
 * Deterministic Linear Congruential Generator. Returns a function that
 * yields the next floating-point value in `[0, 1)` on each call. The
 * generator is fully deterministic in `seed`, which is what every
 * randomized test in this directory relies on for reproducibility.
 *
 * Constants `1_664_525` and `1_013_904_223` are Numerical Recipes' LCG
 * parameters; combined with the `>>> 0` mask and the `/ 2^32`
 * normalization, the output is uniform in `[0, 1)` with full 32-bit
 * resolution.
 */
export const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

/**
 * Deep-clone a `GraphEvent` so tests that re-deliver events across
 * replicas can't accidentally share mutable substructure (notably the
 * `parentVersion` Set and the `operation` object). The replica's
 * remote-apply path stores events by reference, so a caller that
 * later mutates the `parentVersion` Set on the original event would
 * silently corrupt every replica that accepted it.
 */
export const cloneEvent = (event: GraphEvent): GraphEvent => ({
  id: event.id,
  operation: { ...event.operation },
  parentVersion: new Set(event.parentVersion),
  timestamp: event.timestamp,
});

/**
 * Extended version type for testing critical version detection
 * Adds replica and version number metadata for test scenarios
 */
export interface TestVersion extends ReadonlySet<EventId> {
  replicaId?: string;
  version?: number;
}

/**
 * Create a test version with replica ID and version number
 */
export function createTestVersion(
  replicaId: string,
  version: number,
  eventIds: EventId[] = [],
): TestVersion {
  const set = new Set(eventIds) as TestVersion;
  (set as { replicaId: string }).replicaId = replicaId;
  (set as { version: number }).version = version;
  return set;
}

/**
 * Create a simple version from event IDs
 */
export function createVersion(eventIds: EventId[]): Version {
  return new Set(eventIds) as Version;
}

/**
 * Create a test version with only version number (for simple tests)
 */
export function createSimpleTestVersion(version: number): TestVersion {
  const set = new Set<EventId>() as TestVersion;
  (set as { version: number }).version = version;
  return set;
}

/**
 * Return a Fisher–Yates-shuffled copy of `items`. The input is not
 * mutated, so callers can pass `ReadonlyArray<T>` without pre-cloning.
 */
export const shuffled = <T>(
  items: ReadonlyArray<T>,
  rand: () => number,
): T[] => {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
};

/**
 * Canonical text for an event set: topologically sort via {@link EventGraph},
 * build a replica from that order, and read its text. All randomized
 * delivery-order replicas must converge on the same string.
 *
 * `initialText` lets the caller exercise the non-empty seed path; defaults to
 * "" so existing callers do not change behaviour.
 */
export const canonicalText = (
  events: ReadonlyArray<GraphEvent>,
  initialText: string = "",
): string => {
  const graph = new EventGraph();
  for (const event of events.map(cloneEvent)) {
    graph.addEvent(event);
  }
  const replica = new EgWalkerReplica("canonical", initialText);
  for (const event of graph.getTopologicalOrder()) {
    replica.applyRemoteEvent(cloneEvent(event));
  }
  return replica.getText();
};

/**
 * Apply `events` to a fresh replica in a delivery order chosen by `rand`.
 * The replica's own buffering handles out-of-causal-order arrivals, so the
 * order doesn't have to respect the DAG — it just has to deliver every event
 * eventually.
 *
 * `initialText` mirrors {@link canonicalText} and lets the caller exercise the
 * non-empty seed path.
 */
export const applyInRandomDeliveryOrder = (
  replicaId: string,
  events: ReadonlyArray<GraphEvent>,
  rand: () => number,
  initialText: string = "",
): EgWalkerReplica => {
  const replica = new EgWalkerReplica(replicaId, initialText);
  const delivery = shuffled(events.map(cloneEvent), rand);
  for (const event of delivery) {
    replica.applyRemoteEvent(event);
  }
  if (replica.getPendingRemoteCount() !== 0) {
    throw new Error(
      `Replica ${replicaId} still has ${replica.getPendingRemoteCount()} buffered events after delivery; trace is not causally closed.`,
    );
  }
  return replica;
};

/**
 * Build a chain `root → e1 → e2 → ... → e{length-1}` and return the graph
 * plus the ordered IDs. Used to construct deep histories whose ancestor set
 * is large compared to typical divergent suffixes.
 */
export const buildLinearHistory = (
  length: number,
  prefix = "n",
): { graph: EventGraph; ids: EventId[] } => {
  const graph = new EventGraph();
  const ids: EventId[] = [];
  let previous: EventId | null = null;
  for (let i = 0; i < length; i++) {
    const id = `${prefix}-${i}`;
    graph.addEvent({
      id,
      timestamp: i,
      parentVersion: new Set<EventId>(previous ? [previous] : []),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: i,
        text: prefix.charAt(0),
      },
    });
    ids.push(id);
    previous = id;
  }
  return { graph, ids };
};
