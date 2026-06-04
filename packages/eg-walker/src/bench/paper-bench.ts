import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { EgWalkerReplica } from "../core/replica";
import { NativeSnapshotCodec } from "../core/native-snapshot";
import { EventGraph } from "../graph/event-graph";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import type { GraphEvent } from "../types";
import {
  loadPaperTrace,
  parseDatasetList,
  PAPER_DATASETS,
  type PaperDataset,
  type PaperTraceGranularity,
} from "./paper-traces";

const DEFAULT_PAPER_ROOT = "/Users/zhyd1997/workspaces/oss/egwalker-paper";

type BenchCase = Pick<CliOptions, "maxTxns" | "maxEvents" | "granularity"> & {
  readonly dataset: PaperDataset;
  readonly label: string;
};

interface CliOptions {
  readonly datasets: PaperDataset[];
  readonly runs: number;
  readonly paperRoot: string;
  readonly maxTxns?: number;
  readonly maxEvents?: number;
  readonly granularity: PaperTraceGranularity;
  readonly memory: boolean;
  readonly memoryWorker: boolean;
  readonly memoryRun?: number;
  readonly planPhase0: boolean;
}

interface BenchResult {
  readonly dataset: PaperDataset;
  readonly label: string;
  readonly run: number;
  readonly maxTxns?: number;
  readonly maxEvents?: number;
  readonly granularity: PaperTraceGranularity;
  readonly txns: number;
  readonly patches: number;
  readonly events: number;
  readonly finalTextLength: number;
  readonly loadConvertMs: number;
  readonly applyMs: number;
  readonly totalMs: number;
  readonly jsonBytes: number;
  readonly binaryBytes: number;
  readonly nativeDecodeMs: number;
  readonly nativeLoadMs: number;
  readonly snapshotEncodeMs: number;
  readonly snapshotDecodeMs: number;
  readonly snapshotRestoreMs: number;
  readonly snapshotBytes: number;
  readonly snapshotHeapBytes: number;
  readonly snapshotFullReplays: number;
  readonly snapshotPartialReplays: number;
  readonly snapshotIncrementalApplies: number;
  readonly fullReplays: number;
  readonly partialReplays: number;
  readonly incrementalApplies: number;
  readonly retreats: number;
  readonly advances: number;
  readonly checkpointHits: number;
  readonly checkpointMisses: number;
  readonly sequenceRecords: number;
  readonly peakSequenceRecords: number;
}

interface MemoryResult {
  readonly dataset: PaperDataset;
  readonly label: string;
  readonly run: number;
  readonly maxTxns?: number;
  readonly maxEvents?: number;
  readonly granularity: PaperTraceGranularity;
  readonly heapBeforeBytes: number;
  readonly heapAfterDecodeBytes: number;
  readonly heapAfterLoadBytes: number;
  readonly heapAfterSnapshotDecodeBytes: number;
  readonly heapAfterSnapshotRestoreBytes: number;
  readonly nativeDecodeHeapBytes: number;
  readonly nativeLoadHeapBytes: number;
  readonly snapshotDecodeHeapBytes: number;
  readonly snapshotRestoreHeapBytes: number;
  readonly nativeDecodeMs: number;
  readonly nativeLoadMs: number;
  readonly snapshotDecodeMs: number;
  readonly snapshotRestoreMs: number;
  readonly snapshotHeapBytes: number;
}

const readOptionValue = (
  args: ReadonlyArray<string>,
  index: number,
  name: string,
): string => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
};

const parseCliOptions = (args: ReadonlyArray<string>): CliOptions => {
  let datasets: PaperDataset[] = ["S1"];
  let runs = 1;
  let paperRoot = DEFAULT_PAPER_ROOT;
  let maxTxns: number | undefined;
  let maxEvents: number | undefined;
  let granularity: PaperTraceGranularity = "patch";
  let memory = false;
  let memoryWorker = false;
  let memoryRun: number | undefined;
  let planPhase0 = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--datasets") {
      datasets = parseDatasetList(readOptionValue(args, index, arg));
      index++;
      continue;
    }
    if (arg?.startsWith("--datasets=")) {
      datasets = parseDatasetList(arg.slice("--datasets=".length));
      continue;
    }
    if (arg === "--runs") {
      runs = Number(readOptionValue(args, index, arg));
      index++;
      continue;
    }
    if (arg?.startsWith("--runs=")) {
      runs = Number(arg.slice("--runs=".length));
      continue;
    }
    if (arg === "--paper-root") {
      paperRoot = readOptionValue(args, index, arg);
      index++;
      continue;
    }
    if (arg?.startsWith("--paper-root=")) {
      paperRoot = arg.slice("--paper-root=".length);
      continue;
    }
    if (arg === "--max-txns") {
      maxTxns = Number(readOptionValue(args, index, arg));
      index++;
      continue;
    }
    if (arg?.startsWith("--max-txns=")) {
      maxTxns = Number(arg.slice("--max-txns=".length));
      continue;
    }
    if (arg === "--max-events") {
      maxEvents = Number(readOptionValue(args, index, arg));
      index++;
      continue;
    }
    if (arg?.startsWith("--max-events=")) {
      maxEvents = Number(arg.slice("--max-events=".length));
      continue;
    }
    if (arg === "--granularity") {
      granularity = parseGranularity(readOptionValue(args, index, arg));
      index++;
      continue;
    }
    if (arg?.startsWith("--granularity=")) {
      granularity = parseGranularity(arg.slice("--granularity=".length));
      continue;
    }
    if (arg === "--memory") {
      memory = true;
      continue;
    }
    if (arg === "--plan-phase0") {
      planPhase0 = true;
      continue;
    }
    if (arg === "--memory-worker") {
      memoryWorker = true;
      continue;
    }
    if (arg === "--memory-run") {
      memoryRun = Number(readOptionValue(args, index, arg));
      index++;
      continue;
    }
    if (arg?.startsWith("--memory-run=")) {
      memoryRun = Number(arg.slice("--memory-run=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(runs) || runs <= 0) {
    throw new Error(`--runs must be a positive integer, got ${runs}`);
  }
  if (maxTxns !== undefined && (!Number.isInteger(maxTxns) || maxTxns <= 0)) {
    throw new Error(`--max-txns must be a positive integer, got ${maxTxns}`);
  }
  if (
    maxEvents !== undefined &&
    (!Number.isInteger(maxEvents) || maxEvents <= 0)
  ) {
    throw new Error(
      `--max-events must be a positive integer, got ${maxEvents}`,
    );
  }
  if (
    memoryRun !== undefined &&
    (!Number.isInteger(memoryRun) || memoryRun <= 0)
  ) {
    throw new Error(
      `--memory-run must be a positive integer, got ${memoryRun}`,
    );
  }

  return {
    datasets,
    runs,
    paperRoot: resolve(paperRoot),
    maxTxns,
    maxEvents,
    granularity,
    memory,
    memoryWorker,
    memoryRun,
    planPhase0,
  };
};

const parseGranularity = (value: string): PaperTraceGranularity => {
  if (value === "patch" || value === "operation") {
    return value;
  }
  throw new Error(`--granularity must be "patch" or "operation", got ${value}`);
};

const printUsage = (): void => {
  console.log(`Usage:
  pnpm --filter @softmaple/eg-walker paper-bench -- [options]

Options:
  --datasets S1,S2   Comma-separated datasets, or "all". Default: S1
  --runs 3           Number of runs per dataset. Default: 1
  --paper-root PATH  Path to egwalker-paper. Default: ${DEFAULT_PAPER_ROOT}
  --max-txns 100     Limit each dataset to the first N txns; skips final text check
  --max-events 1000  Limit each dataset to the first N converted events; skips final text check
  --granularity MODE patch or operation. Default: patch
  --memory           Also measure native decode/load heap deltas in a separate --expose-gc process
  --plan-phase0      Run the native snapshot guardrail suite:
                     S1/S2/S3/A1 full, plus C1/C2 bounded 3k and 10k

Known datasets: ${PAPER_DATASETS.join(", ")}`);
};

const cloneEvent = (event: GraphEvent): GraphEvent => ({
  id: event.id,
  parentVersion: new Set(event.parentVersion),
  operation:
    event.operation.type === "insert"
      ? { ...event.operation }
      : { ...event.operation },
  timestamp: event.timestamp,
});

const utf8Bytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

const runGc = (): void => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) {
    throw new Error("Memory worker requires node --expose-gc");
  }
  gc();
};

const usedHeap = (): number => process.memoryUsage().heapUsed;

const printResult = (result: BenchResult): void => {
  console.log(
    [
      "paper-bench",
      `dataset=${result.dataset}`,
      `label=${result.label}`,
      `run=${result.run}`,
      `maxTxns=${result.maxTxns ?? "none"}`,
      `maxEvents=${result.maxEvents ?? "none"}`,
      `granularity=${result.granularity}`,
      `txns=${result.txns}`,
      `patches=${result.patches}`,
      `events=${result.events}`,
      `text=${result.finalTextLength}`,
      `loadConvertMs=${formatNumber(result.loadConvertMs)}`,
      `applyMs=${formatNumber(result.applyMs)}`,
      `totalMs=${formatNumber(result.totalMs)}`,
      `jsonBytes=${result.jsonBytes}`,
      `binaryBytes=${result.binaryBytes}`,
      `nativeDecodeMs=${formatNumber(result.nativeDecodeMs)}`,
      `nativeLoadMs=${formatNumber(result.nativeLoadMs)}`,
      `snapshotEncodeMs=${formatNumber(result.snapshotEncodeMs)}`,
      `snapshotDecodeMs=${formatNumber(result.snapshotDecodeMs)}`,
      `snapshotRestoreMs=${formatNumber(result.snapshotRestoreMs)}`,
      `snapshotBytes=${result.snapshotBytes}`,
      `snapshotHeapBytes=${result.snapshotHeapBytes}`,
      `snapshotFullReplays=${result.snapshotFullReplays}`,
      `snapshotPartialReplays=${result.snapshotPartialReplays}`,
      `snapshotIncrementalApplies=${result.snapshotIncrementalApplies}`,
      `fullReplays=${result.fullReplays}`,
      `partialReplays=${result.partialReplays}`,
      `incrementalApplies=${result.incrementalApplies}`,
      `retreats=${result.retreats}`,
      `advances=${result.advances}`,
      `checkpointHits=${result.checkpointHits}`,
      `checkpointMisses=${result.checkpointMisses}`,
      `sequenceRecords=${result.sequenceRecords}`,
      `peakSequenceRecords=${result.peakSequenceRecords}`,
    ].join(" "),
  );
};

const printMemoryResult = (result: MemoryResult): void => {
  console.log(
    [
      "paper-bench-memory",
      `dataset=${result.dataset}`,
      `label=${result.label}`,
      `run=${result.run}`,
      `maxTxns=${result.maxTxns ?? "none"}`,
      `maxEvents=${result.maxEvents ?? "none"}`,
      `granularity=${result.granularity}`,
      `heapBeforeBytes=${result.heapBeforeBytes}`,
      `heapAfterDecodeBytes=${result.heapAfterDecodeBytes}`,
      `heapAfterLoadBytes=${result.heapAfterLoadBytes}`,
      `heapAfterSnapshotDecodeBytes=${result.heapAfterSnapshotDecodeBytes}`,
      `heapAfterSnapshotRestoreBytes=${result.heapAfterSnapshotRestoreBytes}`,
      `nativeDecodeHeapBytes=${result.nativeDecodeHeapBytes}`,
      `nativeLoadHeapBytes=${result.nativeLoadHeapBytes}`,
      `snapshotDecodeHeapBytes=${result.snapshotDecodeHeapBytes}`,
      `snapshotRestoreHeapBytes=${result.snapshotRestoreHeapBytes}`,
      `nativeDecodeMs=${formatNumber(result.nativeDecodeMs)}`,
      `nativeLoadMs=${formatNumber(result.nativeLoadMs)}`,
      `snapshotDecodeMs=${formatNumber(result.snapshotDecodeMs)}`,
      `snapshotRestoreMs=${formatNumber(result.snapshotRestoreMs)}`,
      `snapshotHeapBytes=${result.snapshotHeapBytes}`,
    ].join(" "),
  );
};

const applyLoadedPaperTrace = (
  dataset: PaperDataset,
  run: number,
  loaded: ReturnType<typeof loadPaperTrace>,
): {
  readonly replica: EgWalkerReplica;
  readonly text: string;
} => {
  const replica = new EgWalkerReplica(`paper-bench:${dataset}:${run}`);
  for (const event of loaded.events) {
    try {
      replica.applyRemoteEvent(event);
    } catch (error) {
      const detail = JSON.stringify({
        id: event.id,
        parents: Array.from(event.parentVersion),
        operation: event.operation,
      });
      throw new Error(
        `${dataset}: failed applying ${detail}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const pending = replica.getPendingRemoteCount();
  if (pending !== 0) {
    throw new Error(`${dataset}: ${pending} remote events remain buffered`);
  }

  const text = replica.getText();
  if (!loaded.limited && text !== loaded.trace.endContent) {
    throw new Error(
      `${dataset}: final text mismatch, got ${text.length} UTF-16 code units, expected ${loaded.trace.endContent.length}`,
    );
  }

  return { replica, text };
};

const applyPaperTrace = (
  paperRoot: string,
  dataset: PaperDataset,
  run: number,
  options: Pick<CliOptions, "maxTxns" | "maxEvents" | "granularity">,
): {
  readonly loaded: ReturnType<typeof loadPaperTrace>;
  readonly replica: EgWalkerReplica;
  readonly text: string;
} => {
  const loaded = loadPaperTrace(paperRoot, dataset, options);
  return {
    loaded,
    ...applyLoadedPaperTrace(dataset, run, loaded),
  };
};

const runDatasetOnce = (
  paperRoot: string,
  run: number,
  benchCase: BenchCase,
): BenchResult => {
  const startedAt = performance.now();
  const loaded = loadPaperTrace(paperRoot, benchCase.dataset, benchCase);
  const convertedAt = performance.now();
  const { replica, text } = applyLoadedPaperTrace(
    benchCase.dataset,
    run,
    loaded,
  );
  const appliedAt = performance.now();

  const serialized = replica.serialize();
  const jsonBytes = utf8Bytes(JSON.stringify(serialized));
  const graph = EventGraph.fromEvents(
    replica.exportEventGraph().map((event) => cloneEvent(event)),
  );
  const codec = new ColumnarEventGraphCodec();
  const binary = codec.encodeBinary(graph);
  const decodedAt = performance.now();
  const decodedGraph = codec.decodeBinary(binary);
  const loadedAt = performance.now();
  const nativeReplica = new EgWalkerReplica(
    `paper-native-load:${benchCase.dataset}:${benchCase.label}:${run}`,
    "",
    decodedGraph,
  );
  const nativeLoadedAt = performance.now();
  if (nativeReplica.getText() !== text) {
    throw new Error(
      `${benchCase.dataset}: native load text mismatch, got ${nativeReplica.getText().length} UTF-16 code units, expected ${text.length}`,
    );
  }
  const snapshotCodec = new NativeSnapshotCodec();
  const snapshotEncodeStartedAt = performance.now();
  const snapshotBinary = snapshotCodec.encode(replica.createNativeSnapshot());
  const snapshotEncodedAt = performance.now();
  const decodedSnapshot = snapshotCodec.decode(snapshotBinary);
  const snapshotDecodedAt = performance.now();
  const snapshotReplica = EgWalkerReplica.fromNativeSnapshot(
    decodedSnapshot,
    `paper-snapshot-load:${benchCase.dataset}:${benchCase.label}:${run}`,
  );
  const snapshotRestoredAt = performance.now();
  if (snapshotReplica.getText() !== text) {
    throw new Error(
      `${benchCase.dataset}: snapshot load text mismatch, got ${snapshotReplica.getText().length} UTF-16 code units, expected ${text.length}`,
    );
  }
  const snapshotStats = snapshotReplica.getReplayStats();
  if (snapshotStats.fullReplays !== 0) {
    throw new Error(
      `${benchCase.dataset}: snapshot restore unexpectedly performed ${snapshotStats.fullReplays} full replay(s)`,
    );
  }
  const stats = replica.getReplayStats();

  return {
    dataset: benchCase.dataset,
    label: benchCase.label,
    run,
    maxTxns: benchCase.maxTxns,
    maxEvents: benchCase.maxEvents,
    granularity: benchCase.granularity,
    txns: loaded.txnCount,
    patches: loaded.patchCount,
    events: loaded.events.length,
    finalTextLength: text.length,
    loadConvertMs: convertedAt - startedAt,
    applyMs: appliedAt - convertedAt,
    totalMs: appliedAt - startedAt,
    jsonBytes,
    binaryBytes: binary.byteLength,
    nativeDecodeMs: loadedAt - decodedAt,
    nativeLoadMs: nativeLoadedAt - loadedAt,
    snapshotEncodeMs: snapshotEncodedAt - snapshotEncodeStartedAt,
    snapshotDecodeMs: snapshotDecodedAt - snapshotEncodedAt,
    snapshotRestoreMs: snapshotRestoredAt - snapshotDecodedAt,
    snapshotBytes: snapshotBinary.byteLength,
    snapshotHeapBytes: 0,
    snapshotFullReplays: snapshotStats.fullReplays,
    snapshotPartialReplays: snapshotStats.partialReplays,
    snapshotIncrementalApplies: snapshotStats.incrementalApplies,
    fullReplays: stats.fullReplays,
    partialReplays: stats.partialReplays,
    incrementalApplies: stats.incrementalApplies,
    retreats: stats.engineRetreats,
    advances: stats.engineAdvances,
    checkpointHits: stats.criticalCheckpointHits,
    checkpointMisses: stats.criticalCheckpointMisses,
    sequenceRecords: stats.sequenceRecordCount,
    peakSequenceRecords: stats.peakSequenceRecordCount,
  };
};

const buildNativePayload = (
  paperRoot: string,
  dataset: PaperDataset,
  run: number,
  options: Pick<CliOptions, "maxTxns" | "maxEvents" | "granularity">,
): {
  readonly binary: Uint8Array;
  readonly snapshotBinary: Uint8Array;
  readonly text: string;
} => {
  const { replica, text } = applyPaperTrace(paperRoot, dataset, run, options);
  const graph = EventGraph.fromEvents(
    replica.exportEventGraph().map((event) => cloneEvent(event)),
  );
  const binary = new ColumnarEventGraphCodec().encodeBinary(graph);
  const snapshotBinary = new NativeSnapshotCodec().encode(
    replica.createNativeSnapshot(),
  );
  return { binary, snapshotBinary, text };
};

const measureNativeMemory = (
  paperRoot: string,
  run: number,
  benchCase: BenchCase,
): MemoryResult => {
  const { binary, snapshotBinary, text } = buildNativePayload(
    paperRoot,
    benchCase.dataset,
    run,
    benchCase,
  );
  const codec = new ColumnarEventGraphCodec();
  const snapshotCodec = new NativeSnapshotCodec();

  runGc();
  const heapBeforeBytes = usedHeap();
  const decodeStartedAt = performance.now();
  const decodedGraph = codec.decodeBinary(binary);
  const decodedAt = performance.now();
  runGc();
  const heapAfterDecodeBytes = usedHeap();

  const loadStartedAt = performance.now();
  const nativeReplica = new EgWalkerReplica(
    `paper-native-memory:${benchCase.dataset}:${benchCase.label}:${run}`,
    "",
    decodedGraph,
  );
  const loadedAt = performance.now();
  if (nativeReplica.getText() !== text) {
    throw new Error(
      `${benchCase.dataset}: native memory load text mismatch, got ${nativeReplica.getText().length} UTF-16 code units, expected ${text.length}`,
    );
  }
  runGc();
  const heapAfterLoadBytes = usedHeap();

  runGc();
  const snapshotHeapBeforeBytes = usedHeap();
  const snapshotDecodeStartedAt = performance.now();
  const decodedSnapshot = snapshotCodec.decode(snapshotBinary);
  const snapshotDecodedAt = performance.now();
  runGc();
  const heapAfterSnapshotDecodeBytes = usedHeap();

  const snapshotReplica = EgWalkerReplica.fromNativeSnapshot(
    decodedSnapshot,
    `paper-snapshot-memory:${benchCase.dataset}:${benchCase.label}:${run}`,
  );
  const snapshotRestoredAt = performance.now();
  if (snapshotReplica.getText() !== text) {
    throw new Error(
      `${benchCase.dataset}: snapshot memory load text mismatch, got ${snapshotReplica.getText().length} UTF-16 code units, expected ${text.length}`,
    );
  }
  const snapshotStats = snapshotReplica.getReplayStats();
  if (snapshotStats.fullReplays !== 0) {
    throw new Error(
      `${benchCase.dataset}: snapshot memory restore unexpectedly performed ${snapshotStats.fullReplays} full replay(s)`,
    );
  }
  runGc();
  const heapAfterSnapshotRestoreBytes = usedHeap();

  return {
    dataset: benchCase.dataset,
    label: benchCase.label,
    run,
    maxTxns: benchCase.maxTxns,
    maxEvents: benchCase.maxEvents,
    granularity: benchCase.granularity,
    heapBeforeBytes,
    heapAfterDecodeBytes,
    heapAfterLoadBytes,
    heapAfterSnapshotDecodeBytes,
    heapAfterSnapshotRestoreBytes,
    nativeDecodeHeapBytes: heapAfterDecodeBytes - heapBeforeBytes,
    nativeLoadHeapBytes: heapAfterLoadBytes - heapAfterDecodeBytes,
    snapshotDecodeHeapBytes:
      heapAfterSnapshotDecodeBytes - snapshotHeapBeforeBytes,
    snapshotRestoreHeapBytes:
      heapAfterSnapshotRestoreBytes - heapAfterSnapshotDecodeBytes,
    nativeDecodeMs: decodedAt - decodeStartedAt,
    nativeLoadMs: loadedAt - loadStartedAt,
    snapshotDecodeMs: snapshotDecodedAt - snapshotDecodeStartedAt,
    snapshotRestoreMs: snapshotRestoredAt - snapshotDecodedAt,
    snapshotHeapBytes: heapAfterSnapshotRestoreBytes - snapshotHeapBeforeBytes,
  };
};

const runMemoryWorkerProcess = (
  options: CliOptions,
  benchCase: BenchCase,
  run: number,
): void => {
  const script = process.argv[1];
  if (!script) {
    throw new Error("Cannot locate paper-bench script for memory worker");
  }

  const args = [
    "--expose-gc",
    ...process.execArgv,
    script,
    "--memory-worker",
    "--datasets",
    benchCase.dataset,
    "--runs",
    "1",
    "--memory-run",
    String(run),
    "--paper-root",
    options.paperRoot,
    "--granularity",
    benchCase.granularity,
  ];
  if (benchCase.maxTxns !== undefined) {
    args.push("--max-txns", String(benchCase.maxTxns));
  }
  if (benchCase.maxEvents !== undefined) {
    args.push("--max-events", String(benchCase.maxEvents));
  }

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(
      `${benchCase.label}: memory worker failed with exit code ${result.status ?? "unknown"}`,
    );
  }
};

const mean = (values: ReadonlyArray<number>): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const printSummaries = (results: ReadonlyArray<BenchResult>): void => {
  for (const label of new Set(results.map((result) => result.label))) {
    const datasetResults = results.filter((result) => result.label === label);
    const first = datasetResults[0];
    if (!first) {
      continue;
    }
    const applyTimes = datasetResults.map((result) => result.applyMs);
    const totalTimes = datasetResults.map((result) => result.totalMs);
    const nativeDecodeTimes = datasetResults.map(
      (result) => result.nativeDecodeMs,
    );
    const nativeLoadTimes = datasetResults.map((result) => result.nativeLoadMs);
    const snapshotDecodeTimes = datasetResults.map(
      (result) => result.snapshotDecodeMs,
    );
    const snapshotRestoreTimes = datasetResults.map(
      (result) => result.snapshotRestoreMs,
    );
    const snapshotBytes = datasetResults.map((result) => result.snapshotBytes);
    console.log(
      [
        "paper-bench-summary",
        `dataset=${first.dataset}`,
        `label=${label}`,
        `runs=${datasetResults.length}`,
        `maxTxns=${first.maxTxns ?? "none"}`,
        `maxEvents=${first.maxEvents ?? "none"}`,
        `granularity=${first.granularity}`,
        `meanApplyMs=${formatNumber(mean(applyTimes))}`,
        `minApplyMs=${formatNumber(Math.min(...applyTimes))}`,
        `maxApplyMs=${formatNumber(Math.max(...applyTimes))}`,
        `meanTotalMs=${formatNumber(mean(totalTimes))}`,
        `meanNativeDecodeMs=${formatNumber(mean(nativeDecodeTimes))}`,
        `meanNativeLoadMs=${formatNumber(mean(nativeLoadTimes))}`,
        `meanSnapshotDecodeMs=${formatNumber(mean(snapshotDecodeTimes))}`,
        `minSnapshotDecodeMs=${formatNumber(Math.min(...snapshotDecodeTimes))}`,
        `maxSnapshotDecodeMs=${formatNumber(Math.max(...snapshotDecodeTimes))}`,
        `meanSnapshotRestoreMs=${formatNumber(mean(snapshotRestoreTimes))}`,
        `minSnapshotRestoreMs=${formatNumber(Math.min(...snapshotRestoreTimes))}`,
        `maxSnapshotRestoreMs=${formatNumber(Math.max(...snapshotRestoreTimes))}`,
        `meanSnapshotBytes=${formatNumber(mean(snapshotBytes))}`,
      ].join(" "),
    );
  }
};

const buildBenchCases = (options: CliOptions): BenchCase[] => {
  if (!options.planPhase0) {
    return options.datasets.map((dataset) => ({
      dataset,
      label: labelForCase(dataset, options),
      maxTxns: options.maxTxns,
      maxEvents: options.maxEvents,
      granularity: options.granularity,
    }));
  }

  return [
    ...(["S1", "S2", "S3", "A1"] as const).map((dataset) => ({
      dataset,
      label: labelForCase(dataset, {
        maxTxns: undefined,
        maxEvents: undefined,
        granularity: options.granularity,
      }),
      granularity: options.granularity,
    })),
    ...(["C1", "C2"] as const).flatMap((dataset) =>
      [3_000, 10_000].map((maxEvents) => ({
        dataset,
        label: labelForCase(dataset, {
          maxTxns: undefined,
          maxEvents,
          granularity: options.granularity,
        }),
        maxEvents,
        granularity: options.granularity,
      })),
    ),
  ];
};

const labelForCase = (
  dataset: PaperDataset,
  options: Pick<CliOptions, "maxTxns" | "maxEvents" | "granularity">,
): string => {
  const limit =
    options.maxEvents !== undefined
      ? `events-${options.maxEvents}`
      : options.maxTxns !== undefined
        ? `txns-${options.maxTxns}`
        : "full";
  return `${dataset}-${limit}-${options.granularity}`;
};

const main = (): void => {
  const options = parseCliOptions(process.argv.slice(2));
  const benchCases = buildBenchCases(options);
  if (options.memoryWorker) {
    const benchCase = benchCases[0];
    if (!benchCase) {
      throw new Error("Memory worker requires one benchmark case");
    }
    printMemoryResult(
      measureNativeMemory(options.paperRoot, options.memoryRun ?? 1, benchCase),
    );
    return;
  }

  const results: BenchResult[] = [];

  console.log(
    [
      "paper-bench-config",
      `paperRoot=${options.paperRoot}`,
      `datasets=${options.datasets.join(",")}`,
      `cases=${benchCases.map((benchCase) => benchCase.label).join(",")}`,
      `runs=${options.runs}`,
      `maxTxns=${options.maxTxns ?? "none"}`,
      `maxEvents=${options.maxEvents ?? "none"}`,
      `granularity=${options.granularity}`,
      `memory=${options.memory}`,
      `planPhase0=${options.planPhase0}`,
    ].join(" "),
  );

  for (const benchCase of benchCases) {
    for (let run = 1; run <= options.runs; run++) {
      const result = runDatasetOnce(options.paperRoot, run, benchCase);
      results.push(result);
      printResult(result);
      if (options.memory) {
        runMemoryWorkerProcess(options, benchCase, run);
      }
    }
  }

  printSummaries(results);
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
