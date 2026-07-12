import { describe, expect, it } from "vitest";

import { measurePersistenceMetrics } from "../bench/persistence-metrics";
import { EgWalkerReplica } from "../core/replica";

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
});
