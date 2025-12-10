/**
 * Version management utilities
 * Pure functions for version operations
 */

import type { EventId, Version } from "../../types";

/**
 * Create a new version from an immutable set
 */
export const createVersion = (
  eventIds: ReadonlySet<EventId> = new Set(),
): Version => new Set(eventIds);

/**
 * Create empty version
 */
export const emptyVersion = (): Version => new Set();

/**
 * Add an event to a version immutably
 */
export const addToVersion = (version: Version, eventId: EventId): Version =>
  new Set([...version, eventId]);

/**
 * Remove an event from a version immutably
 */
export const removeFromVersion = (
  version: Version,
  eventId: EventId,
): Version => {
  const newVersion = new Set(version);
  newVersion.delete(eventId);
  return newVersion;
};

/**
 * Merge two versions
 */
export const mergeVersions = (v1: Version, v2: Version): Version =>
  new Set([...v1, ...v2]);

/**
 * Compute the difference between two versions
 */
export const diffVersions = (
  from: Version,
  to: Version,
): { toAdd: Set<EventId>; toRemove: Set<EventId> } => ({
  toAdd: new Set([...to].filter((id) => !from.has(id))),
  toRemove: new Set([...from].filter((id) => !to.has(id))),
});

/**
 * Check if all dependencies are satisfied
 */
export const areDependenciesSatisfied = (
  dependencies: Version,
  currentVersion: Version,
): boolean => [...dependencies].every((dep) => currentVersion.has(dep));

/**
 * Check if version is empty
 */
export const isEmptyVersion = (version: Version): boolean => version.size === 0;

/**
 * Check if versions are equal
 */
export const areVersionsEqual = (v1: Version, v2: Version): boolean => {
  if (v1.size !== v2.size) return false;
  for (const id of v1) {
    if (!v2.has(id)) return false;
  }
  return true;
};

/**
 * Get version size
 */
export const versionSize = (version: Version): number => version.size;
