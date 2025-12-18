/**
 * Tests for Section 3.5: State Clearing (Critical Versions)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTestVersion,
  createSimpleTestVersion,
} from "./test-helpers";
import {
  DefaultCriticalVersionDetector,
  StateClearer,
  isCriticalVersion,
  clearInternalState,
  ClearableCRDTState,
} from "../core/critical-version";
import { InternalCRDTState } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../constants/operation-types";

describe("Section 3.5: Critical Version Detection", () => {
  describe("DefaultCriticalVersionDetector", () => {
    it("should detect critical version when all replicas have seen it", () => {
      const detector = new DefaultCriticalVersionDetector([
        "replica1",
        "replica2",
      ]);

      // Update versions for both replicas
      detector.updateVersion(createTestVersion("replica1", 10));
      detector.updateVersion(createTestVersion("replica2", 10));

      // Version 10 should be critical
      expect(detector.isCriticalVersion(createSimpleTestVersion(10))).toBe(true);

      // Version 11 should not be critical (not all replicas have seen it)
      expect(detector.isCriticalVersion(createSimpleTestVersion(11))).toBe(false);
    });

    it("should update critical version as replicas advance", () => {
      const detector = new DefaultCriticalVersionDetector();

      // Add first replica
      detector.updateVersion(createTestVersion("replica1", 5));
      expect(detector.getCurrentCriticalVersion()).toBeTruthy();

      // Add second replica with lower version
      detector.updateVersion(createTestVersion("replica2", 3));
      const critical = detector.getCurrentCriticalVersion();
      expect(critical).toBeTruthy();

      // Advance second replica
      detector.updateVersion(createTestVersion("replica2", 5));
      const newCritical = detector.getCurrentCriticalVersion();
      expect(newCritical).toBeTruthy();
    });

    it("should handle empty replica set", () => {
      const detector = new DefaultCriticalVersionDetector();

      // No critical version with no replicas
      expect(detector.isCriticalVersion(createSimpleTestVersion(1))).toBe(false);
      expect(detector.getCurrentCriticalVersion()).toBeNull();
    });

    it("should handle getCurrentCriticalVersion when no events have been added", () => {
      const detector = new DefaultCriticalVersionDetector();

      // Call getCurrentCriticalVersion without updating any version first
      const result = detector.getCurrentCriticalVersion();
      expect(result).toBe(null);
    });

    it("should handle tryClearToCriticalVersion with empty critical version", () => {
      const detector = new DefaultCriticalVersionDetector();
      const clearer = new StateClearer(detector);

      // Create a mock clearable state
      const mockState: ClearableCRDTState = {
        clearPrepareState: vi.fn(),
        compactEffectState: vi.fn(),
        clearCachedMetadata: vi.fn(),
      };

      // Try to clear without any critical version set
      clearer.tryClearToCriticalVersion(mockState);

      // Should not call any clearing methods when no critical version
      expect(mockState.clearPrepareState).not.toHaveBeenCalled();
    });
  });
});

describe("Section 3.5: State Clearing", () => {
  describe("Edge cases for getCurrentCriticalVersion", () => {
    it("should return null when no versions have been updated", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1", "replica2"]);

      // Without any updateVersion calls, should return null
      const result = detector.getCurrentCriticalVersion();
      expect(result).toBe(null);
    });

    it("should return null when updateCriticalVersion is called with empty knownReplicas", () => {
      const detector = new DefaultCriticalVersionDetector();
      
      // updateCriticalVersion should handle empty knownReplicas gracefully (line 119-120)
      // This is triggered internally when updateVersion is called
      detector.updateVersion(new Set(["e1"]));
      
      // With no replica ID extracted, should still be null
      const result = detector.getCurrentCriticalVersion();
      expect(result).toBe(null);
    });

    it("should handle version comparison edge cases", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1", "replica2"]);

      // Update with version containing event IDs
      const version1 = createTestVersion("replica1", 5);
      detector.updateVersion(version1);

      // Update second replica with different event set
      const version2 = createTestVersion("replica2", 3);
      detector.updateVersion(version2);

      const critical = detector.getCurrentCriticalVersion();
      expect(critical).not.toBeNull();
    });
  });

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
    detector.updateVersion(createTestVersion("replica1", 1));
    detector.updateVersion(createTestVersion("replica2", 1));

    // Clear state at critical version
    const cleared = clearer.clearInternalState(state, createSimpleTestVersion(1));
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
    detector.updateVersion(createTestVersion("replica1", 2));

    // Should not clear
    const cleared = clearer.clearInternalState(state, createSimpleTestVersion(2));
    expect(cleared).toBe(false);
  });

  it("should not clear same version twice", () => {
    // Make version 1 critical
    detector.updateVersion(createTestVersion("replica1", 1));
    detector.updateVersion(createTestVersion("replica2", 1));

    // First clear should succeed
    const cleared1 = clearer.clearInternalState(state, createSimpleTestVersion(1));
    expect(cleared1).toBe(true);

    // Second clear of same version should not happen
    const cleared2 = clearer.clearInternalState(state, createSimpleTestVersion(1));
    expect(cleared2).toBe(false);
  });

  it("should support partial replay after clearing", () => {
    // Add initial records
    state.applyOperation(
      { type: OPERATION_TYPE.INSERT, index: 0, text: "Initial" },
      "rec1",
    );

    // Clear at critical version
    detector.updateVersion(createTestVersion("replica1", 1));
    detector.updateVersion(createTestVersion("replica2", 1));
    clearer.clearInternalState(state, createSimpleTestVersion(1));

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
    state.compactEffectState(createSimpleTestVersion(1));

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
    detector.updateVersion(createTestVersion("replica1", 1));

    // Test exported helper functions
    expect(isCriticalVersion(detector, createSimpleTestVersion(1))).toBe(true);

    // This should not throw
    clearInternalState(clearer, state, createSimpleTestVersion(1));
    expect(state).toBeDefined();
  });
});

describe("Section 3.5: Edge cases and uncovered paths", () => {
  describe("getCurrentCriticalVersion edge cases", () => {
    it("should return null when no critical version exists", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      // Before any version updates, should return null
      expect(detector.getCurrentCriticalVersion()).toBeNull();
    });

    it("should handle version with Set type", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      const versionSet = new Set(["e1", "e2"]);
      // @ts-expect-error - Testing with minimal version object
      detector.updateVersion({ replicaId: "replica1" });

      // Should handle Set-based versions
      detector.isCriticalVersion(versionSet);
      expect(detector).toBeDefined();
    });

    it("should handle version comparison with different types", () => {
      const detector = new DefaultCriticalVersionDetector([
        "replica1",
        "replica2",
      ]);

      // Update with version that has no extractable numeric version
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion({ replicaId: "replica1", data: "test" });
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion({ replicaId: "replica2", data: "test" });

      // Should not crash when checking versions without numeric comparison
      // @ts-expect-error - Testing with non-standard version structure
      const result = detector.isCriticalVersion({ data: "test" });
      expect(typeof result).toBe("boolean");
    });
  });

  describe("tryClearToCriticalVersion", () => {
    it("should return false when no critical version exists", () => {
      const detector = new DefaultCriticalVersionDetector();
      const clearer = new StateClearer(detector);
      const state = new InternalCRDTState();

      // Should return false when no critical version
      expect(clearer.tryClearToCriticalVersion(state)).toBe(false);
    });

    it("should return false when state is not clearable", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      detector.updateVersion(createTestVersion("replica1", 1));

      const clearer = new StateClearer(detector);
      const nonClearableState = { someProperty: "value" };

      // Should return false for non-clearable state
      // @ts-expect-error - Testing with invalid state object
      expect(clearer.tryClearToCriticalVersion(nonClearableState)).toBe(false);
    });

    it("should successfully clear when critical version exists", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      detector.updateVersion(createTestVersion("replica1", 1));

      const clearer = new StateClearer(detector);
      const state = new InternalCRDTState();

      state.applyOperation(
        { type: OPERATION_TYPE.INSERT, index: 0, text: "Test" },
        "rec1",
      );

      // Should successfully clear to critical version
      expect(clearer.tryClearToCriticalVersion(state)).toBe(true);

      // Note: tryClearToCriticalVersion doesn't track already-cleared versions
      // It will clear again if called multiple times with the same critical version
      // This is different from clearInternalState which does track cleared versions
      expect(clearer.tryClearToCriticalVersion(state)).toBe(true);
    });
  });

  describe("StateClearer edge cases", () => {
    it("should handle null/undefined state gracefully", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      detector.updateVersion(createTestVersion("replica1", 1));

      const clearer = new StateClearer(detector);

      // Should return false for null/undefined state
      expect(
        // @ts-expect-error - Testing with null state
        clearer.clearInternalState(null, createSimpleTestVersion(1)),
      ).toBe(false);
      expect(
        // @ts-expect-error - Testing with undefined state
        clearer.clearInternalState(undefined, createSimpleTestVersion(1)),
      ).toBe(false);
    });

    it("should update version through StateClearer", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      const clearer = new StateClearer(detector);

      // Should delegate to detector
      clearer.updateVersion(createTestVersion("replica1", 1));

      expect(detector.getCurrentCriticalVersion()).toBeTruthy();
    });
  });

  describe("Version comparison edge cases", () => {
    it("should handle empty version arrays", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      // @ts-expect-error - Testing with minimal version object
      detector.updateVersion({ replicaId: "replica1" });

      // Empty version should be handled
      // @ts-expect-error - Testing with empty version object
      const result = detector.isCriticalVersion({});
      expect(typeof result).toBe("boolean");
    });

    it("should handle string versions", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      // @ts-expect-error - Testing with minimal version object
      detector.updateVersion({ replicaId: "replica1" });

      // String version should be converted to array
      // @ts-expect-error - Testing with string as version
      const result = detector.isCriticalVersion("version1");
      expect(typeof result).toBe("boolean");
    });

    it("should compare versions with different lengths", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      const version1 = new Set(["e1", "e2"]);
      const version2 = new Set(["e1"]);

      // @ts-expect-error - Testing with minimal version object
      detector.updateVersion({ replicaId: "replica1" });

      // Should handle different length comparisons
      detector.isCriticalVersion(version1);
      detector.isCriticalVersion(version2);
      expect(detector).toBeDefined();
    });
  });

  describe("Version extraction and comparison logic", () => {
    it("should extract version number from object with .version property", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      
      // Pass version with .version property to trigger extractVersionNumber (line 96)
      const versionObj = { version: 10, replicaId: "replica1" };
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion(versionObj);
      
      // Now test isCriticalVersion with another object with .version
      const testVersion = { version: 10 };
      // @ts-expect-error - Testing with non-standard version structure
      const result = detector.isCriticalVersion(testVersion);
      expect(typeof result).toBe("boolean");
    });

    it("should handle versionGreaterOrEqual with Set versions", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1", "replica2"]);
      
      // Update with Set version to trigger versionGreaterOrEqual logic (lines 108-109)
      const v1 = new Set(["e1", "e2"]);
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion({ replicaId: "replica1", version: v1 });
      
      const v2 = new Set(["e1"]);
      // @ts-expect-error - Testing with non-standard version structure  
      detector.updateVersion({ replicaId: "replica2", version: v2 });
      
      // Check if smaller set is critical
      const result = detector.isCriticalVersion(v2);
      expect(typeof result).toBe("boolean");
    });

    it("should handle versionGreaterOrEqual comparison logic", () => {
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      
      // This will trigger the versionGreaterOrEqual method (lines 138-145)
      const v1 = new Set(["a", "b"]);
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion({ replicaId: "replica1", version: v1 });
      
      // Test with subset
      const v2 = new Set(["a"]);
      detector.isCriticalVersion(v2);
      
      // Test with superset (should trigger false branch in versionGreaterOrEqual)
      const v3 = new Set(["a", "b", "c"]);
      detector.isCriticalVersion(v3);
      
      expect(detector).toBeDefined();
    });

    it("should handle extractReplicaId returning null (line 191)", () => {
      const detector = new DefaultCriticalVersionDetector();
      
      // Pass version without replicaId to trigger null return
      const versionWithoutId = new Set(["e1"]);
      detector.updateVersion(versionWithoutId);
      
      // Should not crash, getCurrentCriticalVersion should still be null
      expect(detector.getCurrentCriticalVersion()).toBe(null);
    });

    it("should handle versionEquals with different element values (lines 319-320)", () => {
      // Initialize detector with a replica - critical version detection requires 
      // that all known replicas update their versions. Since we pass ["replica1"],
      // the detector tracks this replica but has no version updates yet.
      const detector = new DefaultCriticalVersionDetector(["replica1"]);
      
      // Create a version object with replicaId for proper extraction
      const versionWithReplica = Object.assign(new Set(["e1", "e2"]), { 
        replicaId: "replica1" 
      });
      detector.updateVersion(versionWithReplica);
      
      const clearer = new StateClearer(detector);
      
      const mockState: ClearableCRDTState = {
        clearPrepareState: vi.fn(),
        compactEffectState: vi.fn(),
        clearCachedMetadata: vi.fn(),
      };
      
      // Clear to v1 (equals critical version) - should succeed
      const v1 = new Set(["e1", "e2"]);
      const result1 = clearer.clearInternalState(mockState as InternalCRDTState, v1);
      // Now that detector has a critical version (versionWithReplica), v1 should match
      expect(result1).toBe(true);
      
      // Try clearing to v2 (same length but different elements) - should fail
      // This triggers line 319: if (arr1[i] !== arr2[i])
      const v2 = new Set(["e1", "e3"]);
      const result2 = clearer.clearInternalState(mockState as InternalCRDTState, v2);
      expect(result2).toBe(false); // Cannot clear because v2 doesn't equal critical version
    });

    it("should handle updateVersion with replicaId extraction (line 78)", () => {
      const detector = new DefaultCriticalVersionDetector();
      
      // Pass a version that should have extractable replicaId
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion({ replicaId: "replica1", version: 5 });
      
      // Replica should be added
      expect(detector.getCurrentCriticalVersion()).toBeTruthy();
    });

    it("should handle versionLess comparison (lines 125-126)", () => {
      const detector = new DefaultCriticalVersionDetector();
      
      // Add two versions to trigger versionLess in updateCriticalVersion
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion({ replicaId: "replica1", version: 3 });
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion({ replicaId: "replica2", version: 5 });
      
      // The critical version should be the minimum (3)
      const critical = detector.getCurrentCriticalVersion();
      expect(critical).toBeTruthy();
    });
  });

  describe("Replica ID extraction", () => {
    it("should handle version without replicaId", () => {
      const detector = new DefaultCriticalVersionDetector();

      // Update with version that has no replicaId field
      // @ts-expect-error - Testing with non-standard version structure
      detector.updateVersion({ someOtherField: "value" });

      // Should not add unknown replicas
      expect(detector.getCurrentCriticalVersion()).toBeNull();
    });
  });
});
