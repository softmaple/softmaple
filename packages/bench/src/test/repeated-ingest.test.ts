import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { constants } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EgWalkerReplica,
  createCausalEventBatchBuilder,
} from "@softmaple/eg-walker";
import { convertPaperTraceToAtomicSink } from "@softmaple/eg-walker/internal";
import type { FinalTextOracle } from "../bench/paper-final-text";
import { readPaperTrace } from "../bench/paper-traces";
import {
  measureRepeatedIngest,
  sumGcPauses,
  type RepeatedIngestApi,
  type RepeatedIngestOptions,
} from "../bench/repeated-ingest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, "../..");
const paperRoot = resolve(testDirectory, "fixtures/paper-bench");

const api: RepeatedIngestApi = {
  EgWalkerReplica,
  createCausalEventBatchBuilder,
  convertPaperTraceToAtomicSink,
};

const fixtureOptions = (
  overrides: Partial<RepeatedIngestOptions> = {},
): RepeatedIngestOptions => {
  const trace = readPaperTrace(paperRoot, "S1");
  return {
    dataset: "S1",
    trace,
    oracle: { kind: "endContent", text: trace.endContent },
    iterations: 3,
    batchEvents: "all",
    ...overrides,
  };
};

describe("repeated whole-trace ingest", () => {
  it("builds and applies the whole trace once per iteration", async () => {
    const iterations = await measureRepeatedIngest(api, fixtureOptions());

    expect(iterations.map(({ iteration }) => iteration)).toEqual([1, 2, 3]);
    for (const entry of iterations) {
      expect(entry).toMatchObject({
        events: 3,
        batches: 1,
        finalTextLength: 2,
      });
      expect(entry.buildMs).toBeGreaterThanOrEqual(0);
      expect(entry.applyMs).toBeGreaterThanOrEqual(0);
      expect(entry.buildGcMs + entry.applyGcMs).toBeCloseTo(entry.gc.gcMs);
    }
  });

  it("splits the trace into bounded batches", async () => {
    const [first] = await measureRepeatedIngest(
      api,
      fixtureOptions({ iterations: 1, batchEvents: 2 }),
    );

    expect(first).toMatchObject({ events: 3, batches: 2 });
  });

  it("fails an iteration whose text does not match the oracle", async () => {
    const oracle: FinalTextOracle = { kind: "endContent", text: "other" };

    await expect(
      measureRepeatedIngest(api, fixtureOptions({ oracle })),
    ).rejects.toThrow(/S1 iteration 1: final text mismatch/);
  });

  it("rejects an iteration count that is not a positive integer", async () => {
    for (const iterations of [0, 1.5, Number.NaN]) {
      await expect(
        measureRepeatedIngest(api, fixtureOptions({ iterations })),
      ).rejects.toThrow(/positive iteration count/);
    }
  });

  it("charges each GC pause to the window it started in", () => {
    const pauses = [
      { startTime: 5, duration: 1, kind: constants.NODE_PERFORMANCE_GC_MINOR },
      { startTime: 10, duration: 2, kind: constants.NODE_PERFORMANCE_GC_MINOR },
      { startTime: 15, duration: 4, kind: constants.NODE_PERFORMANCE_GC_MAJOR },
      {
        startTime: 18,
        duration: 8,
        kind: constants.NODE_PERFORMANCE_GC_INCREMENTAL,
      },
      {
        startTime: 20,
        duration: 16,
        kind: constants.NODE_PERFORMANCE_GC_MAJOR,
      },
    ];

    expect(sumGcPauses(pauses, 10, 20)).toEqual({
      gcMs: 14,
      majorGcMs: 4,
      majorGcs: 1,
      minorGcMs: 2,
      minorGcs: 1,
    });
    expect(sumGcPauses(pauses, 0, 5).gcMs).toBe(0);
  });

  it("runs the driver against a small paper fixture", () => {
    const output = mkdtempSync(join(tmpdir(), "repeated-ingest-test-"));
    try {
      const result = spawnSync(
        process.execPath,
        [
          resolve(packageRoot, "scripts/run-repeated-ingest-bench.mjs"),
          "--datasets",
          "S1",
          "--iterations",
          "2",
          "--runs",
          "1",
          "--paper-root",
          paperRoot,
          "--output",
          output,
        ],
        { cwd: packageRoot, encoding: "utf8" },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("| S1 | Batch build, iteration 2 |");
      expect(result.stdout).toContain(
        "| S1 | Apply, iteration 2 ÷ iteration 1 |",
      );
      const [sample] = readFileSync(join(output, "runs.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(sample).toMatchObject({
        implementation: "head",
        dataset: "S1",
        finalTextOracle: "endContent",
      });
      expect(sample.iterations).toHaveLength(2);
    } finally {
      rmSync(output, { force: true, recursive: true });
    }
  });
});
