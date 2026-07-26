import type { PaperTraceGranularity } from "./paper-traces";

export const PAPER_BENCHMARK_GRANULARITY: PaperTraceGranularity = "operation";
export const DEFAULT_PAPER_BENCHMARK_APPLY_BATCH_EVENTS = 4_096;
export const DEFAULT_PAPER_BENCHMARK_APPLY_API = "causal" as const;

export type PaperBenchmarkApplyBatchEvents = number | "all";
export type PaperBenchmarkApplyApi = "causal" | "detailed";

export const parsePaperBenchmarkGranularity = (
  value: string,
): PaperTraceGranularity => {
  if (value === PAPER_BENCHMARK_GRANULARITY) {
    return value;
  }
  throw new Error(
    `paper benchmarks require --granularity operation; ${JSON.stringify(value)} is reserved for non-conformant import-stress tooling`,
  );
};

export const parsePaperBenchmarkApplyBatchEvents = (
  value: string,
): PaperBenchmarkApplyBatchEvents => {
  if (value === "all") {
    return value;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `--apply-batch-events must be a positive safe integer or "all", got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
};

export const parsePaperBenchmarkApplyApi = (
  value: string,
): PaperBenchmarkApplyApi => {
  if (value === "causal" || value === "detailed") {
    return value;
  }
  throw new Error(
    `--apply-api must be "causal" or "detailed", got ${JSON.stringify(value)}`,
  );
};
