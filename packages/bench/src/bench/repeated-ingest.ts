/**
 * Repeated whole-trace ingest in one process.
 *
 * Each iteration converts a paper trace into causal batches (the batch
 * build), applies them to a fresh replica (the apply), and checks the text
 * against the dataset oracle outside both timers. The previous iteration's
 * replica and batches are dropped first, unless `retainReplicas` keeps every
 * replica alive, so each iteration runs on whatever the earlier ones left in
 * the process: module-level collections, and a heap the collector has to work
 * through. A build without such state keeps every iteration close to the
 * first.
 *
 * GC time is the main-thread pause of each `gc` entry a `PerformanceObserver`
 * reports, charged to the phase it started in. Node delivers these entries
 * from the event loop, so the harness yields between iterations, outside both
 * timers, and attributes the pauses by start time.
 *
 * Every eg-walker function the measurement calls comes from the
 * implementation passed in, so one harness can measure a base and a head
 * build.
 */
import {
  constants,
  performance,
  PerformanceObserver,
  type NodeGCPerformanceDetail,
  type PerformanceEntry,
} from "node:perf_hooks";
import { setImmediate as nextEventLoopTurn } from "node:timers/promises";

import type { EgWalkerReplica } from "@softmaple/eg-walker";

import type { PaperBenchmarkApplyBatchEvents } from "./paper-bench-options";
import { assertFinalText, type FinalTextOracle } from "./paper-final-text";
import {
  convertPaperTraceToCausalBatches,
  type CausalBatchConversionApi,
} from "./paper-trace-causal-batches";
import type { PaperDataset, PaperTrace } from "./paper-traces";

type EgWalkerModule = typeof import("@softmaple/eg-walker");

export type RepeatedIngestApi = Pick<EgWalkerModule, "EgWalkerReplica"> &
  CausalBatchConversionApi;

export interface RepeatedIngestOptions {
  readonly dataset: PaperDataset;
  readonly trace: PaperTrace;
  readonly oracle: FinalTextOracle;
  readonly iterations: number;
  readonly batchEvents: PaperBenchmarkApplyBatchEvents;
  /** Keep every iteration's replica alive until the run ends. */
  readonly retainReplicas?: boolean;
}

/** One main-thread garbage collection pause. */
export interface GcPause {
  readonly startTime: number;
  readonly duration: number;
  /** One of the `perf_hooks.constants.NODE_PERFORMANCE_GC_*` kinds. */
  readonly kind: number;
}

export interface GcTotals {
  readonly gcMs: number;
  readonly majorGcMs: number;
  readonly majorGcs: number;
  readonly minorGcMs: number;
  readonly minorGcs: number;
}

export interface RepeatedIngestIteration {
  readonly iteration: number;
  readonly events: number;
  readonly batches: number;
  readonly finalTextLength: number;
  readonly buildMs: number;
  readonly applyMs: number;
  /** GC pauses that started during the batch build. */
  readonly buildGcMs: number;
  /** GC pauses that started during the apply. */
  readonly applyGcMs: number;
  /** GC pauses of both phases, by kind. */
  readonly gc: GcTotals;
}

interface IterationWindow {
  readonly iteration: number;
  readonly events: number;
  readonly batches: number;
  readonly finalTextLength: number;
  readonly buildStart: number;
  readonly buildEnd: number;
  readonly applyEnd: number;
}

const EMPTY_GC_TOTALS: GcTotals = {
  gcMs: 0,
  majorGcMs: 0,
  majorGcs: 0,
  minorGcMs: 0,
  minorGcs: 0,
};

const addGcPause = (totals: GcTotals, pause: GcPause): GcTotals => {
  const major = pause.kind === constants.NODE_PERFORMANCE_GC_MAJOR;
  const minor = pause.kind === constants.NODE_PERFORMANCE_GC_MINOR;
  return {
    gcMs: totals.gcMs + pause.duration,
    majorGcMs: totals.majorGcMs + (major ? pause.duration : 0),
    majorGcs: totals.majorGcs + (major ? 1 : 0),
    minorGcMs: totals.minorGcMs + (minor ? pause.duration : 0),
    minorGcs: totals.minorGcs + (minor ? 1 : 0),
  };
};

/** Sum the pauses that started in `[start, end)`. */
export const sumGcPauses = (
  pauses: ReadonlyArray<GcPause>,
  start: number,
  end: number,
): GcTotals =>
  pauses
    .filter((pause) => pause.startTime >= start && pause.startTime < end)
    .reduce(addGcPause, EMPTY_GC_TOTALS);

/** Node sets `detail` on `gc` entries; `PerformanceEntry` does not declare it. */
type GcPerformanceEntry = PerformanceEntry & {
  readonly detail?: NodeGCPerformanceDetail;
};

const toGcPause = (entry: GcPerformanceEntry): GcPause => ({
  startTime: entry.startTime,
  duration: entry.duration,
  kind: entry.detail?.kind ?? 0,
});

/**
 * Observe `gc` entries from now on. Node queues each entry on the event loop
 * and the observer callback on the turn after, so `drain` yields two turns
 * and then takes whatever the observer still buffers.
 */
const observeGcPauses = (): {
  readonly drain: () => Promise<ReadonlyArray<GcPause>>;
  readonly disconnect: () => void;
} => {
  const pauses: GcPause[] = [];
  const observer = new PerformanceObserver((list) => {
    pauses.push(...list.getEntries().map(toGcPause));
  });
  observer.observe({ entryTypes: ["gc"] });
  return {
    drain: async () => {
      await nextEventLoopTurn();
      await nextEventLoopTurn();
      pauses.push(...observer.takeRecords().map(toGcPause));
      return [...pauses];
    },
    disconnect: () => observer.disconnect(),
  };
};

/**
 * Run one iteration. The replica and batches stay local, so nothing but
 * `keep` can hold them once it returns.
 */
const ingestOnce = (
  api: RepeatedIngestApi,
  options: RepeatedIngestOptions,
  iteration: number,
  keep: (replica: EgWalkerReplica) => void,
): IterationWindow => {
  const label = `${options.dataset} iteration ${iteration}`;
  const buildStart = performance.now();
  const converted = convertPaperTraceToCausalBatches(
    options.dataset,
    options.trace,
    options.batchEvents,
    {},
    api,
  );
  const buildEnd = performance.now();
  const replica = new api.EgWalkerReplica(
    `repeated-ingest:${options.dataset}:${iteration}`,
  );
  for (const batch of converted.batches) {
    replica.applyCausalBatch(batch);
  }
  const pending = replica.getPendingRemoteCount();
  const text = replica.getText();
  const applyEnd = performance.now();

  if (converted.limited) {
    throw new Error(`${label}: converted only part of the trace`);
  }
  if (pending !== 0) {
    throw new Error(`${label}: ${pending} remote events remain buffered`);
  }
  assertFinalText(label, text, options.oracle);
  keep(replica);
  return {
    iteration,
    events: converted.eventCount,
    batches: converted.batchCount,
    finalTextLength: text.length,
    buildStart,
    buildEnd,
    applyEnd,
  };
};

const withGcPauses = (
  window: IterationWindow,
  pauses: ReadonlyArray<GcPause>,
): RepeatedIngestIteration => ({
  iteration: window.iteration,
  events: window.events,
  batches: window.batches,
  finalTextLength: window.finalTextLength,
  buildMs: window.buildEnd - window.buildStart,
  applyMs: window.applyEnd - window.buildEnd,
  buildGcMs: sumGcPauses(pauses, window.buildStart, window.buildEnd).gcMs,
  applyGcMs: sumGcPauses(pauses, window.buildEnd, window.applyEnd).gcMs,
  gc: sumGcPauses(pauses, window.buildStart, window.applyEnd),
});

/**
 * Build and apply the whole trace `options.iterations` times in this
 * process, each time on a fresh replica.
 */
export const measureRepeatedIngest = async (
  api: RepeatedIngestApi,
  options: RepeatedIngestOptions,
): Promise<ReadonlyArray<RepeatedIngestIteration>> => {
  if (!Number.isSafeInteger(options.iterations) || options.iterations <= 0) {
    throw new Error(
      `repeated ingest needs a positive iteration count, got ${options.iterations}`,
    );
  }

  // Holding the replicas is the point; nothing reads them back.
  const retained: EgWalkerReplica[] = [];
  const keep =
    options.retainReplicas === true
      ? (replica: EgWalkerReplica): void => {
          retained.push(replica);
        }
      : (): void => {};
  const gcPauses = observeGcPauses();
  const windows: IterationWindow[] = [];
  try {
    for (let iteration = 1; iteration <= options.iterations; iteration++) {
      windows.push(ingestOnce(api, options, iteration, keep));
      // Let Node deliver this iteration's gc entries before the next timer.
      await gcPauses.drain();
    }
    const pauses = await gcPauses.drain();
    return windows.map((window) => withGcPauses(window, pauses));
  } finally {
    gcPauses.disconnect();
  }
};
