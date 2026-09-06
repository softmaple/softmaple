import { describe, expect, it, vi } from "vitest";

import { measurePersistenceMetrics } from "../bench/persistence-metrics";
import { EgWalkerReplica } from "@softmaple/eg-walker";
import { EgWalkerEngine } from "@softmaple/eg-walker/internal";

describe("measurePersistenceMetrics", () => {
  it("should report portable persistence separately from native resume state", () => {
    // Arrange
    const replica = new EgWalkerReplica("author", "base");
    replica.insert(4, " text");

    // Act
    const result = measurePersistenceMetrics(
      replica,
      replica.getText(),
      "fixture",
    );

    // Assert
    expect(result.portableSnapshotBytes).toBeGreaterThan(0);
    expect(result.portableSnapshotMaterializeMs).toBeGreaterThanOrEqual(0);
    expect(result.nativeSnapshotBytes).toBeGreaterThan(0);
    expect(result.nativeSnapshotFullReplays).toBe(0);
    expect(Object.keys(result)).toContain("portableSnapshotDecodeMs");
    expect(Object.keys(result)).toContain("nativeSnapshotDecodeMs");
  });

  it("measures portable materialization after validation provenance is lost", () => {
    const replica = new EgWalkerReplica("author", "base");
    replica.insert(4, " text");
    const generated = vi.spyOn(EgWalkerEngine.prototype, "generate");

    try {
      const metrics = measurePersistenceMetrics(
        replica,
        replica.getText(),
        "persisted",
      );

      expect(metrics.portableSnapshotValidationReplays).toBe(1);
      expect(metrics.portableSnapshotValidationLinearReplays).toBe(1);
      expect(metrics.portableSnapshotValidationEvents).toBe(
        replica.exportEventGraph().length,
      );
      expect(generated).not.toHaveBeenCalled();
    } finally {
      generated.mockRestore();
    }
  });
});
