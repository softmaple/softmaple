import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAPER_BENCHMARK_APPLY_API,
  DEFAULT_PAPER_BENCHMARK_APPLY_BATCH_EVENTS,
  PAPER_BENCHMARK_GRANULARITY,
  parsePaperBenchmarkApplyApi,
  parsePaperBenchmarkApplyBatchEvents,
  parsePaperBenchmarkGranularity,
} from "../bench/paper-bench-options";

describe("parsePaperBenchmarkApplyApi", () => {
  it("defaults to and accepts the strict causal lane", () => {
    expect(DEFAULT_PAPER_BENCHMARK_APPLY_API).toBe("causal");
    expect(parsePaperBenchmarkApplyApi("causal")).toBe("causal");
    expect(parsePaperBenchmarkApplyApi("detailed")).toBe("detailed");
  });

  it.each(["", "remote", "CAUSAL"])("rejects invalid API %j", (value) => {
    expect(() => parsePaperBenchmarkApplyApi(value)).toThrow(/apply-api/);
  });
});

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

describe("parsePaperBenchmarkApplyBatchEvents", () => {
  it("should accept bounded and whole-trace receive batches", () => {
    expect(DEFAULT_PAPER_BENCHMARK_APPLY_BATCH_EVENTS).toBe(4_096);
    expect(parsePaperBenchmarkApplyBatchEvents("16384")).toBe(16_384);
    expect(parsePaperBenchmarkApplyBatchEvents("all")).toBe("all");
  });

  it.each(["", "0", "-1", "1.5", "Infinity", "9007199254740992", "ALL"])(
    "should reject invalid batch size %j",
    (requested) => {
      expect(() => parsePaperBenchmarkApplyBatchEvents(requested)).toThrow(
        /positive safe integer or "all"/,
      );
    },
  );
});
