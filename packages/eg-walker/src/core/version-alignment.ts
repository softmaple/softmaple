/**
 * Section 3.2 — Version Alignment Utilities
 * Manages prepare-version and effect-version for graph walking
 */

import type { EventId } from "../types";

/**
 * Represents the difference between two versions
 */
export interface VersionDiff {
  /** Events in version A but not in B */
  onlyInA: Set<EventId>;
  /** Events in version B but not in A */
  onlyInB: Set<EventId>;
  /** Events in both versions */
  inBoth: Set<EventId>;
}

/**
 * Version represented as a frontier (set of event IDs)
 */
export class FrontierVersion {
  readonly frontier: Set<EventId>;

  constructor(events: Iterable<EventId> = []) {
    this.frontier = new Set(events);
  }

  /**
   * Add an event to this version
   */
  add(eventId: EventId): FrontierVersion {
    const newFrontier = new Set(this.frontier);
    newFrontier.add(eventId);
    return new FrontierVersion(newFrontier);
  }

  /**
   * Remove an event from this version
   */
  remove(eventId: EventId): FrontierVersion {
    const newFrontier = new Set(this.frontier);
    newFrontier.delete(eventId);
    return new FrontierVersion(newFrontier);
  }

  /**
   * Check if this version includes an event
   */
  has(eventId: EventId): boolean {
    return this.frontier.has(eventId);
  }

  /**
   * Get all event IDs in this version
   */
  getEvents(): EventId[] {
    return Array.from(this.frontier);
  }

  /**
   * Create a copy of this version
   */
  clone(): FrontierVersion {
    return new FrontierVersion(this.frontier);
  }

  /**
   * Check equality with another version
   */
  equals(other: FrontierVersion): boolean {
    if (this.frontier.size !== other.frontier.size) {
      return false;
    }
    for (const id of this.frontier) {
      if (!other.frontier.has(id)) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Compare two versions and compute their differences
 */
export function compareVersions(
  a: FrontierVersion,
  b: FrontierVersion,
): VersionDiff {
  const onlyInA = new Set<EventId>();
  const onlyInB = new Set<EventId>();
  const inBoth = new Set<EventId>();

  // Check events in A
  for (const id of a.frontier) {
    if (b.frontier.has(id)) {
      inBoth.add(id);
    } else {
      onlyInA.add(id);
    }
  }

  // Check events only in B
  for (const id of b.frontier) {
    if (!a.frontier.has(id)) {
      onlyInB.add(id);
    }
  }

  return { onlyInA, onlyInB, inBoth };
}

/**
 * Version alignment state manager
 */
export class VersionAlignmentManager {
  private prepareVersion: FrontierVersion;
  private effectVersion: FrontierVersion;

  constructor() {
    this.prepareVersion = new FrontierVersion();
    this.effectVersion = new FrontierVersion();
  }

  /**
   * Get the current prepare version
   * This represents the parent state for the event being processed
   */
  getPrepareVersion(): FrontierVersion {
    return this.prepareVersion.clone();
  }

  /**
   * Get the current effect version
   * This represents all events processed so far
   */
  getEffectVersion(): FrontierVersion {
    return this.effectVersion.clone();
  }

  /**
   * Set the prepare version
   * Used when aligning to parent state
   */
  setPrepareVersion(version: FrontierVersion): void {
    this.prepareVersion = version.clone();
  }

  /**
   * Add an event to the effect version
   * Called after successfully processing an event
   */
  addToEffectVersion(eventId: EventId): void {
    this.effectVersion = this.effectVersion.add(eventId);
  }

  /**
   * Check if retreat is needed
   * Retreat is required when prepareVersion has events not in targetVersion
   */
  needsRetreat(targetVersion: FrontierVersion): boolean {
    const diff = compareVersions(this.prepareVersion, targetVersion);
    return diff.onlyInA.size > 0;
  }

  /**
   * Check if advance is needed
   * Advance is required when targetVersion has events not in prepareVersion
   */
  needsAdvance(targetVersion: FrontierVersion): boolean {
    const diff = compareVersions(this.prepareVersion, targetVersion);
    return diff.onlyInB.size > 0;
  }

  /**
   * Get events to retreat (events in prepare but not in target)
   */
  getEventsToRetreat(targetVersion: FrontierVersion): EventId[] {
    const diff = compareVersions(this.prepareVersion, targetVersion);
    return Array.from(diff.onlyInA).sort().reverse(); // Reverse for retreat order
  }

  /**
   * Get events to advance (events in target but not in prepare)
   */
  getEventsToAdvance(targetVersion: FrontierVersion): EventId[] {
    const diff = compareVersions(this.prepareVersion, targetVersion);
    return Array.from(diff.onlyInB).sort(); // Forward for advance order
  }
}
