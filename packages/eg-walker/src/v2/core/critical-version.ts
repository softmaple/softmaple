/**
 * Section 3.5: State Clearing (Critical Versions)
 * Implements detection and handling of critical versions for clearing CRDT state
 */

import type { Version } from "../types";
import type { InternalCRDTState } from "../crdt/internal-state";

/**
 * A critical version is a point where we can safely clear internal state
 * because all replicas have acknowledged seeing events up to this point.
 */
export interface CriticalVersionDetector {
  /**
   * Check if a version represents a critical point where state can be cleared
   */
  isCriticalVersion(v: Version): boolean;

  /**
   * Update the detector with new version information
   */
  updateVersion(v: Version): void;

  /**
   * Get the current critical version (if any)
   */
  getCurrentCriticalVersion(): Version | null;
}

/**
 * Default implementation of critical version detection
 * A version is critical when all known replicas have acknowledged it
 */
export class DefaultCriticalVersionDetector implements CriticalVersionDetector {
  private knownReplicas: Set<string> = new Set();
  private replicaVersions: Map<string, Version> = new Map();
  private criticalVersion: Version | null = null;

  constructor(replicaIds?: string[]) {
    if (replicaIds) {
      replicaIds.forEach((id) => this.knownReplicas.add(id));
    }
  }

  isCriticalVersion(v: Version): boolean {
    // A version is critical if:
    // 1. All known replicas have seen it
    // 2. No pending operations exist before it
    return this.allReplicasHaveSeen(v);
  }

  updateVersion(v: Version): void {
    // Extract replica ID from version (assuming version contains replica info)
    const replicaId = this.extractReplicaId(v);
    if (replicaId) {
      this.knownReplicas.add(replicaId);
      this.replicaVersions.set(replicaId, v);
      this.updateCriticalVersion();
    }
  }

  getCurrentCriticalVersion(): Version | null {
    return this.criticalVersion;
  }

  private allReplicasHaveSeen(v: Version): boolean {
    // Check if all known replicas have a version >= v
    for (const replicaId of this.knownReplicas) {
      const replicaVersion = this.replicaVersions.get(replicaId);
      if (!replicaVersion || !this.versionGreaterOrEqual(replicaVersion, v)) {
        return false;
      }
    }
    return this.knownReplicas.size > 0;
  }

  private updateCriticalVersion(): void {
    // Find the maximum version that all replicas have seen
    if (this.knownReplicas.size === 0) {
      return;
    }

    let minVersion: Version | null = null;
    for (const [_, version] of this.replicaVersions) {
      if (!minVersion || this.versionLess(version, minVersion)) {
        minVersion = version;
      }
    }

    if (
      minVersion &&
      (!this.criticalVersion ||
        this.versionGreater(minVersion, this.criticalVersion))
    ) {
      this.criticalVersion = minVersion;
    }
  }

  private extractReplicaId(v: Version): string | null {
    // This is a simplified implementation
    // In practice, this would extract replica ID from the version structure
    if (typeof v === "object" && v !== null && "replicaId" in v) {
      return (v as any).replicaId;
    }
    return null;
  }

  private versionGreaterOrEqual(v1: Version, v2: Version): boolean {
    // Simplified comparison - implement based on actual Version structure
    return this.compareVersions(v1, v2) >= 0;
  }

  private versionGreater(v1: Version, v2: Version): boolean {
    return this.compareVersions(v1, v2) > 0;
  }

  private versionLess(v1: Version, v2: Version): boolean {
    return this.compareVersions(v1, v2) < 0;
  }

  private compareVersions(v1: Version, v2: Version): number {
    // Implement actual version comparison logic
    // This is a placeholder implementation
    const id1 = typeof v1 === "string" ? v1 : JSON.stringify(v1);
    const id2 = typeof v2 === "string" ? v2 : JSON.stringify(v2);
    return id1.localeCompare(id2);
  }
}

/**
 * State clearer that handles clearing internal CRDT state at critical versions
 */
export class StateClearer {
  private detector: CriticalVersionDetector;
  private lastClearedVersion: Version | null = null;

  constructor(detector?: CriticalVersionDetector) {
    this.detector = detector || new DefaultCriticalVersionDetector();
  }

  /**
   * Clear internal state up to the given version if it's critical
   * Returns true if state was cleared, false otherwise
   */
  clearInternalState(state: InternalCRDTState, v: Version): boolean {
    if (!this.detector.isCriticalVersion(v)) {
      return false;
    }

    // Don't clear if we've already cleared this version
    if (
      this.lastClearedVersion &&
      this.versionEquals(v, this.lastClearedVersion)
    ) {
      return false;
    }

    // Perform the actual clearing
    this.performClear(state, v);
    this.lastClearedVersion = v;
    return true;
  }

  /**
   * Try to clear state based on current critical version
   */
  tryClearToCriticalVersion(state: InternalCRDTState): boolean {
    const criticalVersion = this.detector.getCurrentCriticalVersion();
    if (criticalVersion) {
      return this.clearInternalState(state, criticalVersion);
    }
    return false;
  }

  /**
   * Update detector with new version information
   */
  updateVersion(v: Version): void {
    this.detector.updateVersion(v);
  }

  private performClear(state: InternalCRDTState, v: Version): void {
    // Clear prepare state completely
    state.clearPrepareState();

    // Keep minimal placeholders in effect state
    // Only keep tombstones and essential metadata for later partial replay
    state.compactEffectState(v);

    // Clear any cached metadata
    state.clearCachedMetadata();
  }

  private versionEquals(v1: Version, v2: Version): boolean {
    // Simplified equality check
    return JSON.stringify(v1) === JSON.stringify(v2);
  }
}

/**
 * Export convenience functions for module consumers
 */
export function isCriticalVersion(
  detector: CriticalVersionDetector,
  v: Version,
): boolean {
  return detector.isCriticalVersion(v);
}

export function clearInternalState(
  clearer: StateClearer,
  state: InternalCRDTState,
  v: Version,
): void {
  clearer.clearInternalState(state, v);
}
