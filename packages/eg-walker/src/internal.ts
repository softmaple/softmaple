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
  itemFromRecord,
  itemsFromRecords,
  recordFromItem,
  recordsFromItems,
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
  type ColumnarEventGraph,
  type IdRun,
  type OperationRun,
  type ParentOverride,
} from "./graph/columnar-codec";
export {
  NativeSnapshotCodec,
  NATIVE_SNAPSHOT_FORMAT_VERSION,
  type NativeSnapshot,
} from "./core/native-snapshot";
export {
  PersistentUtf16Rope,
  UTF16_ROPE_BRANCH_FACTOR,
  UTF16_ROPE_MAX_LEAF,
  UTF16_ROPE_MIN_LEAF,
  UTF16_ROPE_TARGET_LEAF,
  type Utf16RopeInstrumentation,
} from "./text/persistent-utf16-rope";
