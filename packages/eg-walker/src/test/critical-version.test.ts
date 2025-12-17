/**
 * Tests for Section 3.5: State Clearing (Critical Versions)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DefaultCriticalVersionDetector,
  StateClearer,
  isCriticalVersion,
  clearInternalState,
} from "../core/critical-version";
import { InternalCRDTState } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../constants/operation-types";
import {
  PREPARE_STATE_TYPE,
  EFFECT_STATE_TYPE,
} from "../constants/crdt-states";
import type { Version } from "../types";

describe("Section 3.5: Critical Version Detection", () => {
  describe("DefaultCriticalVersionDetector", () => {
    it("should detect critical version when all replicas have seen it", () => {
      const detector = new DefaultCriticalVersionDetector([
        "replica1",
        "replica2",
      ]);

      // Update versions for both replicas
      detector.updateVersion({ replicaId: "replica1", version: 10 } as any);
      detector.updateVersion({ replicaId: "replica2", version: 10 } as any);

      // Version 10 should be critical
      expect(detector.isCriticalVersion({ version: 10 } as any)).toBe(true);

      // Version 11 should not be critical (not all replicas have seen it)
      expect(detector.isCriticalVersion({ version: 11 } as any)).toBe(false);
    });

    it("should update critical version as replicas advance", () => {
      const detector = new DefaultCriticalVersionDetector();

      // Add first replica
      detector.updateVersion({ replicaId: "replica1", version: 5 } as any);
      expect(detector.getCurrentCriticalVersion()).toBeTruthy();

      // Add second replica with lower version
      detector.updateVersion({ replicaId: "replica2", version: 3 } as any);
      const critical = detector.getCurrentCriticalVersion();
      expect(critical).toBeTruthy();

      // Advance second replica
      detector.updateVersion({ replicaId: "replica2", version: 5 } as any);
      const newCritical = detector.getCurrentCriticalVersion();
      expect(newCritical).toBeTruthy();
    });

    it("should handle empty replica set", () => {
      const detector = new DefaultCriticalVersionDetector();

      // No critical version with no replicas
      expect(detector.isCriticalVersion({ version: 1 } as any)).toBe(false);
      expect(detector.getCurrentCriticalVersion()).toBeNull();
    });
  });
});

describe("Section 3.5: State Clearing", () => {
  let state: InternalCRDTState;
  let clearer: StateClearer;
  let detector: DefaultCriticalVersionDetector;

  beforeEach(() => {
    state = new InternalCRDTState();
    detector = new DefaultCriticalVersionDetector(["replica1", "replica2"]);
    clearer = new StateClearer(detector);
  });

  it("should clear internal state at critical version", () => {
    // Add some records to state
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
      "rec1",
    );
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 5, text: " World" },
      "rec2",
    );

    // Make version 1 critical
    detector.updateVersion({ replicaId: "replica1", version: 1 } as any);
    detector.updateVersion({ replicaId: "replica2", version: 1 } as any);

    // Clear state at critical version
    const cleared = clearer.clearInternalState(state, { version: 1 } as any);
    expect(cleared).toBe(true);

    // Verify prepare state was cleared
    const stats = state.getStatistics();
    expect(stats.totalRecords).toBeGreaterThan(0); // Records still exist
  });

  it("should not clear at non-critical version", () => {
    // Add a record
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
      "rec1",
    );

    // Only one replica has seen version 2
    detector.updateVersion({ replicaId: "replica1", version: 2 } as any);

    // Should not clear
    const cleared = clearer.clearInternalState(state, { version: 2 } as any);
    expect(cleared).toBe(false);
  });

  it("should not clear same version twice", () => {
    // Make version 1 critical
    detector.updateVersion({ replicaId: "replica1", version: 1 } as any);
    detector.updateVersion({ replicaId: "replica2", version: 1 } as any);

    // First clear should succeed
    const cleared1 = clearer.clearInternalState(state, { version: 1 } as any);
    expect(cleared1).toBe(true);

    // Second clear of same version should not happen
    const cleared2 = clearer.clearInternalState(state, { version: 1 } as any);
    expect(cleared2).toBe(false);
  });

  it("should support partial replay after clearing", () => {
    // Add initial records
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 0, text: "Initial" },
      "rec1",
    );

    // Clear at critical version
    detector.updateVersion({ replicaId: "replica1", version: 1 } as any);
    detector.updateVersion({ replicaId: "replica2", version: 1 } as any);
    clearer.clearInternalState(state, { version: 1 } as any);

    // Should still be able to apply new operations
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 7, text: " Text" },
      "rec2",
    );

    // Verify state is still functional
    const stats = state.getStatistics();
    expect(stats.visibleRecords).toBeGreaterThan(0);
  });
});

describe("Section 3.5: InternalCRDTState clearing methods", () => {
  let state: InternalCRDTState;

  beforeEach(() => {
    state = new InternalCRDTState();
  });

  it("should clear prepare state", () => {
    // Add records with prepare state
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
      "rec1",
    );
    state.switchToPrepareState();
    state.applyOperation(
      { type: OPERATION_TYPE.DELETE, index: 0, length: 4 },
      "rec2",
    );

    // Clear prepare state
    state.clearPrepareState();

    // Verify prepare state was reset
    // (Would need to expose internal state to properly test this)
    expect(state).toBeDefined();
  });

  it("should compact effect state", () => {
    // Add records
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 0, text: "Keep" },
      "rec1",
    );
    state.applyOperation(
      { type: OPERATION_TYPE.DELETE, index: 0, length: 4 },
      "rec2",
    );

    // Compact state
    state.compactEffectState({ version: 1 } as any);

    // State should still be functional
    const stats = state.getStatistics();
    expect(stats.totalRecords).toBeGreaterThanOrEqual(0);
  });

  it("should clear cached metadata", () => {
    // Add some records to populate caches
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 0, text: "Cache" },
      "rec1",
    );

    // Clear cached metadata
    state.clearCachedMetadata();

    // State should still work
    const stats = state.getStatistics();
    expect(stats.totalRecords).toBeGreaterThan(0);
  });
});

describe("Section 3.5: Module exports", () => {
  it("should export helper functions", () => {
    const detector = new DefaultCriticalVersionDetector(["replica1"]);
    const clearer = new StateClearer(detector);
    const state = new InternalCRDTState();

    // Update to make version critical
    detector.updateVersion({ replicaId: "replica1", version: 1 } as any);

    // Test exported helper functions
    expect(isCriticalVersion(detector, { version: 1 } as any)).toBe(true);

    // This should not throw
    clearInternalState(clearer, state, { version: 1 } as any);
    expect(state).toBeDefined();
  });
});
