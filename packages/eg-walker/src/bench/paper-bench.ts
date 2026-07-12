import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { EgWalkerReplica } from "../core/replica";
import { NativeSnapshotCodec } from "../core/native-snapshot";
import { PortableSnapshotCodec } from "../core/portable-snapshot";
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
import {
  PAPER_BENCHMARK_GRANULARITY,
  parsePaperBenchmarkGranularity,
} from "./paper-bench-options";
import { measurePersistenceMetrics } from "./persistence-metrics";

const DEFAULT_PAPER_ROOT = "../egwalker-paper";

type BenchCase = Pick<CliOptions, "maxTxns" | "maxEvents" | "granularity"> & {
  readonly dataset: PaperDataset;
  readonly label: string;
  readonly gateBudget?: Phase6GateBudget;
};

interface Phase6GateBudget {
  readonly maxPortableSnapshotBytes: number;
  readonly maxPortableSnapshotEncodeMs: number;
  readonly maxPortableSnapshotDecodeMs: number;
  readonly maxPortableSnapshotRestoreMs: number;
  readonly maxPortableSnapshotMaterializeMs: number;
  readonly maxPortableSnapshotDecodeHeapBytes?: number;
  readonly maxPortableSnapshotRestoreHeapBytes?: number;
  readonly maxPortableSnapshotMaterializeHeapBytes?: number;
  readonly maxPortableSnapshotHeapBytes?: number;
}

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
  readonly phase6Gates: boolean;
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
  readonly portableSnapshotEncodeMs: number;
  readonly portableSnapshotDecodeMs: number;
  readonly portableSnapshotRestoreMs: number;
  readonly portableSnapshotMaterializeMs: number;
  readonly portableSnapshotBytes: number;
  readonly nativeSnapshotEncodeMs: number;
  readonly nativeSnapshotDecodeMs: number;
  readonly nativeSnapshotRestoreMs: number;
  readonly nativeSnapshotBytes: number;
  readonly nativeSnapshotFullReplays: number;
  readonly nativeSnapshotPartialReplays: number;
  readonly nativeSnapshotIncrementalApplies: number;
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
  readonly heapAfterPortableSnapshotDecodeBytes: number;
  readonly heapAfterPortableSnapshotRestoreBytes: number;
  readonly heapAfterPortableSnapshotMaterializeBytes: number;
  readonly heapAfterNativeSnapshotDecodeBytes: number;
  readonly heapAfterNativeSnapshotRestoreBytes: number;
  readonly nativeDecodeHeapBytes: number;
  readonly nativeLoadHeapBytes: number;
  readonly portableSnapshotDecodeHeapBytes: number;
  readonly portableSnapshotRestoreHeapBytes: number;
  readonly portableSnapshotMaterializeHeapBytes: number;
  readonly portableSnapshotHeapBytes: number;
  readonly nativeSnapshotDecodeHeapBytes: number;
  readonly nativeSnapshotRestoreHeapBytes: number;
  readonly nativeSnapshotHeapBytes: number;
  readonly nativeDecodeMs: number;
  readonly nativeLoadMs: number;
  readonly portableSnapshotDecodeMs: number;
  readonly portableSnapshotRestoreMs: number;
  readonly portableSnapshotMaterializeMs: number;
  readonly nativeSnapshotDecodeMs: number;
  readonly nativeSnapshotRestoreMs: number;
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
  let granularity: PaperTraceGranularity = PAPER_BENCHMARK_GRANULARITY;
  let memory = false;
  let memoryWorker = false;
  let memoryRun: number | undefined;
  let planPhase0 = false;
  let phase6Gates = false;

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
      granularity = parsePaperBenchmarkGranularity(
        readOptionValue(args, index, arg),
      );
      index++;
      continue;
    }
    if (arg?.startsWith("--granularity=")) {
      granularity = parsePaperBenchmarkGranularity(
        arg.slice("--granularity=".length),
      );
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
    if (arg === "--phase6-gates") {
      phase6Gates = true;
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
    phase6Gates,
  };
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
  --granularity MODE Paper benchmarks require operation. Default: operation
  --memory           Also measure graph, portable snapshot, and native snapshot heap deltas
                     in a separate --expose-gc process
  --plan-phase0      Run the persistence guardrail suite:
                     S1/S2/S3/A1 full, plus C1/C2 bounded 3k and 10k
  --phase6-gates     Run calibrated Phase 6 portable-persistence gates:
                     S1 operation-granularity 1k, 2k, and 4k events

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
      `portableSnapshotEncodeMs=${formatNumber(result.portableSnapshotEncodeMs)}`,
      `portableSnapshotDecodeMs=${formatNumber(result.portableSnapshotDecodeMs)}`,
      `portableSnapshotRestoreMs=${formatNumber(result.portableSnapshotRestoreMs)}`,
      `portableSnapshotMaterializeMs=${formatNumber(result.portableSnapshotMaterializeMs)}`,
      `portableSnapshotBytes=${result.portableSnapshotBytes}`,
      `nativeSnapshotEncodeMs=${formatNumber(result.nativeSnapshotEncodeMs)}`,
      `nativeSnapshotDecodeMs=${formatNumber(result.nativeSnapshotDecodeMs)}`,
      `nativeSnapshotRestoreMs=${formatNumber(result.nativeSnapshotRestoreMs)}`,
      `nativeSnapshotBytes=${result.nativeSnapshotBytes}`,
      `nativeSnapshotFullReplays=${result.nativeSnapshotFullReplays}`,
      `nativeSnapshotPartialReplays=${result.nativeSnapshotPartialReplays}`,
      `nativeSnapshotIncrementalApplies=${result.nativeSnapshotIncrementalApplies}`,
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
      `heapAfterPortableSnapshotDecodeBytes=${result.heapAfterPortableSnapshotDecodeBytes}`,
      `heapAfterPortableSnapshotRestoreBytes=${result.heapAfterPortableSnapshotRestoreBytes}`,
      `heapAfterPortableSnapshotMaterializeBytes=${result.heapAfterPortableSnapshotMaterializeBytes}`,
      `heapAfterNativeSnapshotDecodeBytes=${result.heapAfterNativeSnapshotDecodeBytes}`,
      `heapAfterNativeSnapshotRestoreBytes=${result.heapAfterNativeSnapshotRestoreBytes}`,
      `nativeDecodeHeapBytes=${result.nativeDecodeHeapBytes}`,
      `nativeLoadHeapBytes=${result.nativeLoadHeapBytes}`,
      `portableSnapshotDecodeHeapBytes=${result.portableSnapshotDecodeHeapBytes}`,
      `portableSnapshotRestoreHeapBytes=${result.portableSnapshotRestoreHeapBytes}`,
      `portableSnapshotMaterializeHeapBytes=${result.portableSnapshotMaterializeHeapBytes}`,
      `portableSnapshotHeapBytes=${result.portableSnapshotHeapBytes}`,
      `nativeSnapshotDecodeHeapBytes=${result.nativeSnapshotDecodeHeapBytes}`,
      `nativeSnapshotRestoreHeapBytes=${result.nativeSnapshotRestoreHeapBytes}`,
      `nativeSnapshotHeapBytes=${result.nativeSnapshotHeapBytes}`,
      `nativeDecodeMs=${formatNumber(result.nativeDecodeMs)}`,
      `nativeLoadMs=${formatNumber(result.nativeLoadMs)}`,
      `portableSnapshotDecodeMs=${formatNumber(result.portableSnapshotDecodeMs)}`,
      `portableSnapshotRestoreMs=${formatNumber(result.portableSnapshotRestoreMs)}`,
      `portableSnapshotMaterializeMs=${formatNumber(result.portableSnapshotMaterializeMs)}`,
      `nativeSnapshotDecodeMs=${formatNumber(result.nativeSnapshotDecodeMs)}`,
      `nativeSnapshotRestoreMs=${formatNumber(result.nativeSnapshotRestoreMs)}`,
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
  const persistence = measurePersistenceMetrics(
    replica,
    text,
    `${benchCase.dataset}:${benchCase.label}:${run}`,
  );
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
    ...persistence,
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

const buildPersistencePayload = (
  paperRoot: string,
  dataset: PaperDataset,
  run: number,
  options: Pick<CliOptions, "maxTxns" | "maxEvents" | "granularity">,
): {
  readonly binary: Uint8Array;
  readonly portableSnapshotBinary: Uint8Array;
  readonly nativeSnapshotBinary: Uint8Array;
  readonly text: string;
} => {
  const { replica, text } = applyPaperTrace(paperRoot, dataset, run, options);
  const graph = EventGraph.fromEvents(
    replica.exportEventGraph().map((event) => cloneEvent(event)),
  );
  const binary = new ColumnarEventGraphCodec().encodeBinary(graph);
  const portableSnapshotBinary = new PortableSnapshotCodec().encode(
    replica.createPortableSnapshot(),
  );
  const nativeSnapshotBinary = new NativeSnapshotCodec().encode(
    replica.createNativeSnapshot(),
  );
  return { binary, portableSnapshotBinary, nativeSnapshotBinary, text };
};

const measurePersistenceMemory = (
  paperRoot: string,
  run: number,
  benchCase: BenchCase,
): MemoryResult => {
  const { binary, portableSnapshotBinary, nativeSnapshotBinary, text } =
    buildPersistencePayload(paperRoot, benchCase.dataset, run, benchCase);
  const codec = new ColumnarEventGraphCodec();
  const portableSnapshotCodec = new PortableSnapshotCodec();
  const nativeSnapshotCodec = new NativeSnapshotCodec();

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
  const portableSnapshotHeapBeforeBytes = usedHeap();
  const portableSnapshotDecodeStartedAt = performance.now();
  const decodedPortableSnapshot = portableSnapshotCodec.decode(
    portableSnapshotBinary,
  );
  const portableSnapshotDecodedAt = performance.now();
  runGc();
  const heapAfterPortableSnapshotDecodeBytes = usedHeap();
  const portableSnapshotReplica = EgWalkerReplica.fromPortableSnapshot(
    decodedPortableSnapshot,
    `paper-portable-snapshot-memory:${benchCase.dataset}:${benchCase.label}:${run}`,
  );
  const portableSnapshotRestoredAt = performance.now();
  runGc();
  const heapAfterPortableSnapshotRestoreBytes = usedHeap();
  portableSnapshotReplica.applyRemoteEvents([]);
  const portableSnapshotMaterializedAt = performance.now();
  if (
    portableSnapshotReplica.getText() !== text ||
    portableSnapshotReplica.exportEventGraph().length !==
      decodedGraph.getEventCount()
  ) {
    throw new Error(`${benchCase.dataset}: portable snapshot memory mismatch`);
  }
  runGc();
  const heapAfterPortableSnapshotMaterializeBytes = usedHeap();

  runGc();
  const nativeSnapshotHeapBeforeBytes = usedHeap();
  const nativeSnapshotDecodeStartedAt = performance.now();
  const decodedNativeSnapshot =
    nativeSnapshotCodec.decode(nativeSnapshotBinary);
  const nativeSnapshotDecodedAt = performance.now();
  runGc();
  const heapAfterNativeSnapshotDecodeBytes = usedHeap();
  const nativeSnapshotReplica = EgWalkerReplica.fromNativeSnapshot(
    decodedNativeSnapshot,
    `paper-native-snapshot-memory:${benchCase.dataset}:${benchCase.label}:${run}`,
  );
  const nativeSnapshotRestoredAt = performance.now();
  if (nativeSnapshotReplica.getText() !== text) {
    throw new Error(`${benchCase.dataset}: native snapshot memory mismatch`);
  }
  const nativeSnapshotStats = nativeSnapshotReplica.getReplayStats();
  if (nativeSnapshotStats.fullReplays !== 0) {
    throw new Error(
      `${benchCase.dataset}: native snapshot memory restore unexpectedly performed ${nativeSnapshotStats.fullReplays} full replay(s)`,
    );
  }
  runGc();
  const heapAfterNativeSnapshotRestoreBytes = usedHeap();

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
    heapAfterPortableSnapshotDecodeBytes,
    heapAfterPortableSnapshotRestoreBytes,
    heapAfterPortableSnapshotMaterializeBytes,
    heapAfterNativeSnapshotDecodeBytes,
    heapAfterNativeSnapshotRestoreBytes,
    nativeDecodeHeapBytes: heapAfterDecodeBytes - heapBeforeBytes,
    nativeLoadHeapBytes: heapAfterLoadBytes - heapAfterDecodeBytes,
    portableSnapshotDecodeHeapBytes:
      heapAfterPortableSnapshotDecodeBytes - portableSnapshotHeapBeforeBytes,
    portableSnapshotRestoreHeapBytes:
      heapAfterPortableSnapshotRestoreBytes -
      heapAfterPortableSnapshotDecodeBytes,
    portableSnapshotMaterializeHeapBytes:
      heapAfterPortableSnapshotMaterializeBytes -
      heapAfterPortableSnapshotRestoreBytes,
    portableSnapshotHeapBytes:
      heapAfterPortableSnapshotMaterializeBytes -
      portableSnapshotHeapBeforeBytes,
    nativeSnapshotDecodeHeapBytes:
      heapAfterNativeSnapshotDecodeBytes - nativeSnapshotHeapBeforeBytes,
    nativeSnapshotRestoreHeapBytes:
      heapAfterNativeSnapshotRestoreBytes - heapAfterNativeSnapshotDecodeBytes,
    nativeSnapshotHeapBytes:
      heapAfterNativeSnapshotRestoreBytes - nativeSnapshotHeapBeforeBytes,
    nativeDecodeMs: decodedAt - decodeStartedAt,
    nativeLoadMs: loadedAt - loadStartedAt,
    portableSnapshotDecodeMs:
      portableSnapshotDecodedAt - portableSnapshotDecodeStartedAt,
    portableSnapshotRestoreMs:
      portableSnapshotRestoredAt - portableSnapshotDecodedAt,
    portableSnapshotMaterializeMs:
      portableSnapshotMaterializedAt - portableSnapshotRestoredAt,
    nativeSnapshotDecodeMs:
      nativeSnapshotDecodedAt - nativeSnapshotDecodeStartedAt,
    nativeSnapshotRestoreMs: nativeSnapshotRestoredAt - nativeSnapshotDecodedAt,
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
  if (options.phase6Gates) {
    args.push("--phase6-gates");
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
    const portableSnapshotDecodeTimes = datasetResults.map(
      (result) => result.portableSnapshotDecodeMs,
    );
    const portableSnapshotRestoreTimes = datasetResults.map(
      (result) => result.portableSnapshotRestoreMs,
    );
    const portableSnapshotMaterializeTimes = datasetResults.map(
      (result) => result.portableSnapshotMaterializeMs,
    );
    const portableSnapshotBytes = datasetResults.map(
      (result) => result.portableSnapshotBytes,
    );
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
        `meanPortableSnapshotDecodeMs=${formatNumber(mean(portableSnapshotDecodeTimes))}`,
        `minPortableSnapshotDecodeMs=${formatNumber(Math.min(...portableSnapshotDecodeTimes))}`,
        `maxPortableSnapshotDecodeMs=${formatNumber(Math.max(...portableSnapshotDecodeTimes))}`,
        `meanPortableSnapshotRestoreMs=${formatNumber(mean(portableSnapshotRestoreTimes))}`,
        `minPortableSnapshotRestoreMs=${formatNumber(Math.min(...portableSnapshotRestoreTimes))}`,
        `maxPortableSnapshotRestoreMs=${formatNumber(Math.max(...portableSnapshotRestoreTimes))}`,
        `meanPortableSnapshotMaterializeMs=${formatNumber(mean(portableSnapshotMaterializeTimes))}`,
        `meanPortableSnapshotBytes=${formatNumber(mean(portableSnapshotBytes))}`,
      ].join(" "),
    );
  }
};

const MB = 1024 * 1024;

const phase6GateBudgets: Readonly<Record<string, Phase6GateBudget>> = {
  "S1-events-1000-operation": {
    maxPortableSnapshotBytes: 12 * 1024,
    maxPortableSnapshotEncodeMs: 40,
    maxPortableSnapshotDecodeMs: 10,
    maxPortableSnapshotRestoreMs: 10,
    maxPortableSnapshotMaterializeMs: 25,
    maxPortableSnapshotDecodeHeapBytes: 8 * MB,
    maxPortableSnapshotRestoreHeapBytes: 8 * MB,
    maxPortableSnapshotMaterializeHeapBytes: 16 * MB,
    maxPortableSnapshotHeapBytes: 24 * MB,
  },
  "S1-events-2000-operation": {
    maxPortableSnapshotBytes: 24 * 1024,
    maxPortableSnapshotEncodeMs: 60,
    maxPortableSnapshotDecodeMs: 10,
    maxPortableSnapshotRestoreMs: 10,
    maxPortableSnapshotMaterializeMs: 50,
    maxPortableSnapshotDecodeHeapBytes: 8 * MB,
    maxPortableSnapshotRestoreHeapBytes: 8 * MB,
    maxPortableSnapshotMaterializeHeapBytes: 32 * MB,
    maxPortableSnapshotHeapBytes: 48 * MB,
  },
  "S1-events-4000-operation": {
    maxPortableSnapshotBytes: 40 * 1024,
    maxPortableSnapshotEncodeMs: 100,
    maxPortableSnapshotDecodeMs: 10,
    maxPortableSnapshotRestoreMs: 10,
    maxPortableSnapshotMaterializeMs: 100,
    maxPortableSnapshotDecodeHeapBytes: 8 * MB,
    maxPortableSnapshotRestoreHeapBytes: 8 * MB,
    maxPortableSnapshotMaterializeHeapBytes: 64 * MB,
    maxPortableSnapshotHeapBytes: 96 * MB,
  },
};

const phase6GateBudgetFor = (label: string): Phase6GateBudget => {
  const budget = phase6GateBudgets[label];
  if (!budget) {
    throw new Error(`Missing Phase 6 gate budget for ${label}`);
  }
  return budget;
};

const phase6GateCase = (
  dataset: PaperDataset,
  options: Pick<CliOptions, "maxTxns" | "maxEvents" | "granularity">,
): BenchCase => {
  const label = labelForCase(dataset, options);
  return {
    dataset,
    label,
    maxTxns: options.maxTxns,
    maxEvents: options.maxEvents,
    granularity: options.granularity,
    gateBudget: phase6GateBudgetFor(label),
  };
};

const assertUnderBudget = (
  label: string,
  metric: string,
  actual: number,
  max: number | undefined,
): void => {
  if (max === undefined || actual <= max) {
    return;
  }
  throw new Error(
    `${label}: ${metric} ${formatNumber(actual)} exceeded Phase 6 gate ${formatNumber(max)}`,
  );
};

const assertPhase6BenchGate = (
  result: BenchResult,
  budget: Phase6GateBudget | undefined,
): void => {
  if (!budget) {
    return;
  }
  assertUnderBudget(
    result.label,
    "portableSnapshotBytes",
    result.portableSnapshotBytes,
    budget.maxPortableSnapshotBytes,
  );
  assertUnderBudget(
    result.label,
    "portableSnapshotEncodeMs",
    result.portableSnapshotEncodeMs,
    budget.maxPortableSnapshotEncodeMs,
  );
  assertUnderBudget(
    result.label,
    "portableSnapshotDecodeMs",
    result.portableSnapshotDecodeMs,
    budget.maxPortableSnapshotDecodeMs,
  );
  assertUnderBudget(
    result.label,
    "portableSnapshotRestoreMs",
    result.portableSnapshotRestoreMs,
    budget.maxPortableSnapshotRestoreMs,
  );
  assertUnderBudget(
    result.label,
    "portableSnapshotMaterializeMs",
    result.portableSnapshotMaterializeMs,
    budget.maxPortableSnapshotMaterializeMs,
  );
};

const assertPhase6MemoryGate = (
  result: MemoryResult,
  budget: Phase6GateBudget | undefined,
): void => {
  if (!budget) {
    return;
  }
  assertUnderBudget(
    result.label,
    "portableSnapshotDecodeHeapBytes",
    result.portableSnapshotDecodeHeapBytes,
    budget.maxPortableSnapshotDecodeHeapBytes,
  );
  assertUnderBudget(
    result.label,
    "portableSnapshotRestoreHeapBytes",
    result.portableSnapshotRestoreHeapBytes,
    budget.maxPortableSnapshotRestoreHeapBytes,
  );
  assertUnderBudget(
    result.label,
    "portableSnapshotMaterializeHeapBytes",
    result.portableSnapshotMaterializeHeapBytes,
    budget.maxPortableSnapshotMaterializeHeapBytes,
  );
  assertUnderBudget(
    result.label,
    "portableSnapshotHeapBytes",
    result.portableSnapshotHeapBytes,
    budget.maxPortableSnapshotHeapBytes,
  );
};

const buildBenchCases = (options: CliOptions): BenchCase[] => {
  if (options.phase6Gates && options.memoryWorker) {
    return options.datasets.map((dataset) =>
      phase6GateCase(dataset, {
        maxTxns: options.maxTxns,
        maxEvents: options.maxEvents,
        granularity: options.granularity,
      }),
    );
  }

  if (options.phase6Gates) {
    return [1_000, 2_000, 4_000].map((maxEvents) =>
      phase6GateCase("S1", {
        maxTxns: undefined,
        maxEvents,
        granularity: PAPER_BENCHMARK_GRANULARITY,
      }),
    );
  }

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
    const memoryResult = measurePersistenceMemory(
      options.paperRoot,
      options.memoryRun ?? 1,
      benchCase,
    );
    assertPhase6MemoryGate(memoryResult, benchCase.gateBudget);
    printMemoryResult(memoryResult);
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
      `phase6Gates=${options.phase6Gates}`,
    ].join(" "),
  );

  for (const benchCase of benchCases) {
    for (let run = 1; run <= options.runs; run++) {
      const result = runDatasetOnce(options.paperRoot, run, benchCase);
      assertPhase6BenchGate(result, benchCase.gateBudget);
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
