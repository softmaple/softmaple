import type { PaperTraceGranularity } from "./paper-traces";

export const PAPER_BENCHMARK_GRANULARITY: PaperTraceGranularity = "operation";

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
