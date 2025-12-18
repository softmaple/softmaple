/**
 * Test helper types and utilities for eg-walker tests
 */

import type { Version, EventId } from "../types";

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
