/**
 * Test helper types and utilities for eg-walker tests
 */

import type { Version, EventId, GraphEvent } from "../types";

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
