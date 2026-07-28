import {
  createCausalEventBatchBuilder,
  type CausalEventBatch,
  type CausalEventBatchBuilder,
} from "@softmaple/eg-walker";
import {
  convertPaperTraceToAtomicSink,
  type AtomicPaperTraceConversionSummary,
  type ConvertAtomicPaperTraceOptions,
} from "@softmaple/eg-walker/internal";
import type { PaperBenchmarkApplyBatchEvents } from "./paper-bench-options";
import {
  readPaperTrace,
  type PaperDataset,
  type PaperTrace,
} from "./paper-traces";

export type StreamPaperTraceCausalBatchesOptions =
  ConvertAtomicPaperTraceOptions;

export interface StreamPaperTraceCausalBatchesResult extends AtomicPaperTraceConversionSummary {
  readonly batchCount: number;
}

export interface ConvertedPaperTraceCausalBatches extends StreamPaperTraceCausalBatchesResult {
  readonly batches: ReadonlyArray<CausalEventBatch>;
}

export interface LoadPaperTraceCausalBatchesOptions {
  readonly batchEvents: PaperBenchmarkApplyBatchEvents;
  readonly maxTxns?: number;
  readonly maxEvents?: number;
}

export interface LoadedPaperTraceCausalBatches extends ConvertedPaperTraceCausalBatches {
  readonly dataset: PaperDataset;
  readonly trace: PaperTrace;
  readonly txnCount: number;
  readonly patchCount: number;
}

/**
 * Convert a paper trace directly into owned causal batches.
 *
 * Scalar insert/delete fields are appended to the active builder as they are
 * decoded. No public `GraphEvent[]`, per-batch `slice()`, or second parent-set
 * copy is introduced between trace conversion and batch ownership.
 */
export const streamPaperTraceToCausalBatches = (
  dataset: PaperDataset,
  trace: PaperTrace,
  batchEvents: PaperBenchmarkApplyBatchEvents,
  onBatch: (batch: CausalEventBatch) => void,
  options: StreamPaperTraceCausalBatchesOptions = {},
): StreamPaperTraceCausalBatchesResult => {
  assertValidBatchEvents(batchEvents);

  let builder: CausalEventBatchBuilder | undefined;
  let batchCount = 0;

  const finishBatch = (): void => {
    if (builder === undefined || builder.eventCount === 0) {
      return;
    }
    const batch = builder.finish();
    builder = undefined;
    onBatch(batch);
    batchCount++;
  };

  const activeBuilder = (): CausalEventBatchBuilder => {
    builder ??= createCausalEventBatchBuilder(
      initialBatchCapacity(trace, batchEvents, options.maxEvents),
    );
    return builder;
  };

  const finishBoundedBatch = (): void => {
    if (
      batchEvents !== "all" &&
      builder !== undefined &&
      builder.eventCount === batchEvents
    ) {
      finishBatch();
    }
  };

  const summary = convertPaperTraceToAtomicSink(
    dataset,
    trace,
    {
      appendInsert: (id, parentVersion, index, text, timestamp) => {
        activeBuilder().appendInsert(id, parentVersion, index, text, timestamp);
        finishBoundedBatch();
      },
      appendDelete: (id, parentVersion, index, length, timestamp) => {
        activeBuilder().appendDelete(
          id,
          parentVersion,
          index,
          length,
          timestamp,
        );
        finishBoundedBatch();
      },
    },
    {
      ...options,
      // This path feeds performance measurements. Semantic conformance uses
      // convertPaperTraceToAtomicEvents with validation enabled by default.
      validateFinalText: options.validateFinalText ?? false,
    },
  );
  finishBatch();

  return { ...summary, batchCount };
};

/** Collect streamed batches for a benchmark run without exposing events. */
export const convertPaperTraceToCausalBatches = (
  dataset: PaperDataset,
  trace: PaperTrace,
  batchEvents: PaperBenchmarkApplyBatchEvents,
  options: StreamPaperTraceCausalBatchesOptions = {},
): ConvertedPaperTraceCausalBatches => {
  const batches: CausalEventBatch[] = [];
  const summary = streamPaperTraceToCausalBatches(
    dataset,
    trace,
    batchEvents,
    (batch) => batches.push(batch),
    options,
  );
  return { ...summary, batches };
};

/** Read and convert one benchmark trace through the owned causal-batch path. */
export const loadPaperTraceCausalBatches = (
  paperRoot: string,
  dataset: PaperDataset,
  options: LoadPaperTraceCausalBatchesOptions,
): LoadedPaperTraceCausalBatches => {
  const trace = readPaperTrace(paperRoot, dataset);
  const txns =
    options.maxTxns === undefined
      ? trace.txns
      : trace.txns.slice(0, options.maxTxns);
  const limitedTrace: PaperTrace =
    txns === trace.txns ? trace : { ...trace, txns };
  const converted = convertPaperTraceToCausalBatches(
    dataset,
    limitedTrace,
    options.batchEvents,
    { maxEvents: options.maxEvents },
  );
  const patchCount = txns.reduce((count, txn) => count + txn.patches.length, 0);

  return {
    dataset,
    trace,
    ...converted,
    txnCount: txns.length,
    patchCount,
    limited: txns.length !== trace.txns.length || converted.limited,
  };
};

const assertValidBatchEvents = (
  batchEvents: PaperBenchmarkApplyBatchEvents,
): void => {
  if (
    batchEvents !== "all" &&
    (!Number.isSafeInteger(batchEvents) || batchEvents <= 0)
  ) {
    throw new Error(
      "paper trace causal batch size must be a positive safe integer or all",
    );
  }
};

/** Avoid trusting a trace-provided span enough to make an unbounded allocation. */
const MAX_INITIAL_BATCH_CAPACITY = 1_048_576;

const initialBatchCapacity = (
  trace: PaperTrace,
  batchEvents: PaperBenchmarkApplyBatchEvents,
  maxEvents: number | undefined,
): number => {
  if (batchEvents !== "all") {
    return Math.min(
      batchEvents,
      maxEvents ?? batchEvents,
      MAX_INITIAL_BATCH_CAPACITY,
    );
  }

  let spanEventCount = 0;
  for (const transaction of trace.txns) {
    const span = transaction._dtSpan;
    if (
      span === undefined ||
      !Number.isSafeInteger(span[0]) ||
      !Number.isSafeInteger(span[1]) ||
      span[1] < span[0]
    ) {
      return 0;
    }
    spanEventCount += span[1] - span[0];
    if (!Number.isSafeInteger(spanEventCount)) {
      return 0;
    }
  }

  return Math.min(
    spanEventCount,
    maxEvents ?? spanEventCount,
    MAX_INITIAL_BATCH_CAPACITY,
  );
};
