import { describe, expect, it } from "vitest";

import {
  PAPER_BENCHMARK_GRANULARITY,
  parsePaperBenchmarkGranularity,
} from "../bench/paper-bench-options";

describe("parsePaperBenchmarkGranularity", () => {
  it("should use operation granularity for paper benchmarks", () => {
    // Arrange
    const requested = "operation";

    // Act
    const granularity = parsePaperBenchmarkGranularity(requested);

    // Assert
    expect(PAPER_BENCHMARK_GRANULARITY).toBe("operation");
    expect(granularity).toBe("operation");
  });

  it("should reject patch-level paper benchmark reports", () => {
    // Arrange
    const requested = "patch";

    // Act
    const parse = () => parsePaperBenchmarkGranularity(requested);

    // Assert
    expect(parse).toThrow(/non-conformant import-stress tooling/);
  });
});
