/**
 * Internal replay primitives.
 *
 * These exports are intentionally outside the package's stable `.` entry.
 * Names, signatures, and presence here may change between minor versions
 * without notice — depend on them only for tests, diagnostics, or
 * advanced integrations that already pin a specific version.
 */

export {
  EgWalkerEngine,
  type GeneratedDocument,
} from "./engine/eg-walker-engine";
export { IndexedSequence } from "./engine/indexed-sequence";
export {
  FugueOrderIndex,
  type FugueOrderStats,
} from "./engine/internals/fugue-order-index";
export {
  itemsFromRecords,
  sequenceFromRecords,
  type EngineSequenceRecord,
} from "./engine/sequence-records";
export {
  CriticalVersionAnalyzer,
  type CriticalCheckpoint,
} from "./engine/critical-version";
export {
  PartialReplayManager,
  type PartialReplayResult,
  type ReplayCheckpoint,
} from "./engine/partial-replay";
export {
  ColumnarEventGraphCodec,
  type ColumnarDecodeOptions,
  type ColumnarEventGraph,
  type IdRun,
  type OperationRun,
  type ParentOverride,
} from "./graph/columnar-codec";
export {
  encodeTopologicallyOrderedEventsBinary,
  type TopologicalEventGraphEncoding,
} from "./graph/columnar-codec/topological-binary-encoder";
export {
  NativeSnapshotCodec,
  NATIVE_SNAPSHOT_FORMAT_VERSION,
  type NativeSnapshot,
} from "./core/native-snapshot";
export type {
  CreateNativeSnapshotOptions,
  NativeSnapshotResumeCacheMode,
  PrepareReplicaOptions,
  RestoreSnapshotOptions,
} from "./core/replica";
export {
  PORTABLE_SNAPSHOT_FORMAT_VERSION,
  type PortableSnapshot,
} from "./core/portable-snapshot";
export { PortableSnapshotCodec } from "./core/portable-snapshot-codec";
export { inspectCausalEventBatch } from "./core/causal-event-batch";
export {
  PersistentUtf16Rope,
  UTF16_ROPE_BRANCH_FACTOR,
  UTF16_ROPE_MAX_LEAF,
  UTF16_ROPE_MIN_LEAF,
  UTF16_ROPE_TARGET_LEAF,
  type Utf16RopeInstrumentation,
} from "./text/persistent-utf16-rope";
export {
  PaperEventAdapter,
  type PaperEventExpansion,
  type PaperEventIdentity,
} from "./conformance/paper-event-adapter";
export {
  convertPaperTraceToAtomicEvents,
  convertPaperTraceToAtomicSink,
  type AtomicPaperTraceConversionSummary,
  type ConvertAtomicPaperTraceOptions,
} from "./conformance/paper-trace-converter";
