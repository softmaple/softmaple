import { OPERATION_TYPE } from "../constants/operation-types";
import type {
  EventId,
  ExternalOperation,
  SerializedGraphEventOutput,
  SerializedGraphOutput,
} from "../types";
import { EventGraph } from "../graph/event-graph";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { BinaryReader, BinaryWriter } from "../graph/internals/binary-io";
import {
  recordsFromCompactDeleteTargets,
  type CompactDeleteTargetRecords,
  type DeleteTargetRecord,
} from "../engine/eg-walker-engine";
import {
  recordsFromCompactRecords,
  type CompactEngineSequenceRecords,
  type EngineSequenceRecord,
} from "../engine/sequence-records";
import type { CriticalCheckpointSnapshot } from "./internals/critical-checkpoint-store";

export const NATIVE_SNAPSHOT_FORMAT_VERSION = "EGWS1" as const;

export interface NativeSnapshot {
  readonly formatVersion: typeof NATIVE_SNAPSHOT_FORMAT_VERSION;
  readonly text: string;
  readonly initialText: string;
  readonly currentVersion: ReadonlyArray<EventId>;
  readonly eventCount: number;
  readonly nextSequenceNumber: number;
  readonly metadata?: Record<string, unknown>;
  readonly sequenceRecords: ReadonlyArray<EngineSequenceRecord>;
  readonly deleteTargets: ReadonlyArray<DeleteTargetRecord>;
  readonly checkpoints: ReadonlyArray<CriticalCheckpointSnapshot>;
  readonly eventGraph: SerializedGraphOutput;
}

export interface NativeSnapshotHeader {
  readonly formatVersion: typeof NATIVE_SNAPSHOT_FORMAT_VERSION;
  readonly text: string;
  readonly initialText: string;
  readonly currentVersion: ReadonlyArray<EventId>;
  readonly eventCount: number;
  readonly nextSequenceNumber: number;
  readonly metadata?: Record<string, unknown>;
  readonly checkpoints: ReadonlyArray<CriticalCheckpointSnapshot>;
}

type NativeSnapshotWireHeader = NativeSnapshotHeader & {
  readonly sequenceRecords?: ReadonlyArray<EngineSequenceRecord>;
  readonly deleteTargets?: ReadonlyArray<DeleteTargetRecord>;
};

interface NativeRuntimeState {
  readonly sequenceRecords: ReadonlyArray<EngineSequenceRecord>;
  readonly deleteTargets: ReadonlyArray<DeleteTargetRecord>;
}

export interface NativeSnapshotRuntimeState {
  readonly sequenceRecords: CompactEngineSequenceRecords;
  readonly deleteTargets: CompactDeleteTargetRecords;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC_BYTES = encoder.encode(NATIVE_SNAPSHOT_FORMAT_VERSION);
const columnarCodec = new ColumnarEventGraphCodec();
const decodedGraphSourceCache = new WeakMap<NativeSnapshot, () => EventGraph>();
const decodedRuntimeStateCache = new WeakMap<
  NativeSnapshot,
  NativeSnapshotRuntimeState
>();

export class NativeSnapshotCodec {
  encode(snapshot: NativeSnapshot): Uint8Array {
    const validated = validateNativeSnapshot(snapshot);
    const graph = EventGraph.deserialize(validated.eventGraph);
    const header = headerFromSnapshot(validated);
    const body = new BinaryWriter();
    body.writeBytes(encoder.encode(JSON.stringify(header)));
    body.writeBytes(columnarCodec.encodeBinary(graph));
    body.writeBytes(
      encodeRuntimeState({
        sequenceRecords: validated.sequenceRecords,
        deleteTargets: validated.deleteTargets,
      }),
    );

    const payload = body.toUint8Array();
    const out = new Uint8Array(MAGIC_BYTES.byteLength + payload.byteLength);
    out.set(MAGIC_BYTES, 0);
    out.set(payload, MAGIC_BYTES.byteLength);
    return out;
  }

  decode(bytes: Uint8Array): NativeSnapshot {
    if (bytes.byteLength < MAGIC_BYTES.byteLength) {
      throw new Error("Invalid native snapshot: missing EGWS1 header");
    }
    for (let index = 0; index < MAGIC_BYTES.byteLength; index++) {
      if (bytes[index] !== MAGIC_BYTES[index]) {
        throw new Error("Invalid native snapshot: missing EGWS1 header");
      }
    }

    const body = bytes.subarray(MAGIC_BYTES.byteLength);
    const decoded = decodeLengthPrefixedNativeSnapshotBody(body);
    if (decoded) {
      return decoded;
    }

    const parsed: unknown = JSON.parse(decoder.decode(body)) as unknown;
    return validateNativeSnapshot(parsed);
  }
}

const decodeLengthPrefixedNativeSnapshotBody = (
  body: Uint8Array,
): NativeSnapshot | null => {
  try {
    const reader = new BinaryReader(body);
    const headerPayload = validateNativeSnapshotHeaderPayload(
      JSON.parse(
        decoder.decode(reader.readBytes(reader.readVarint())),
      ) as unknown,
    );
    const graphBytes = reader.readBytes(reader.readVarint());
    const compactRuntimeState =
      reader.remainingByteLength === 0
        ? undefined
        : decodeRuntimeState(reader.readBytes(reader.readVarint()));
    const legacyRuntimeState =
      compactRuntimeState === undefined
        ? {
            sequenceRecords: headerPayload.sequenceRecords,
            deleteTargets: headerPayload.deleteTargets,
          }
        : { sequenceRecords: [], deleteTargets: [] };
    if (reader.remainingByteLength !== 0) {
      throw new Error("Invalid native snapshot: unexpected trailing bytes");
    }
    const graphSource = createMemoizedGraphSource(graphBytes);
    const snapshot = createSnapshotWithLazySections(
      headerPayload.header,
      graphSource,
      compactRuntimeState,
      legacyRuntimeState,
    );
    decodedGraphSourceCache.set(snapshot, graphSource);
    if (compactRuntimeState) {
      decodedRuntimeStateCache.set(snapshot, compactRuntimeState);
    }
    return snapshot;
  } catch (error) {
    if (body[0] === 0x7b) {
      return null;
    }
    throw error;
  }
};

export const consumeDecodedNativeSnapshotGraphSource = (
  snapshot: NativeSnapshot,
): (() => EventGraph) | undefined => {
  const graphSource = decodedGraphSourceCache.get(snapshot);
  if (graphSource) {
    decodedGraphSourceCache.delete(snapshot);
  }
  return graphSource;
};

export const consumeDecodedNativeSnapshotRuntimeState = (
  snapshot: NativeSnapshot,
): NativeSnapshotRuntimeState | undefined => {
  const runtimeState = decodedRuntimeStateCache.get(snapshot);
  if (runtimeState) {
    decodedRuntimeStateCache.delete(snapshot);
  }
  return runtimeState;
};

export const validateNativeSnapshotHeaderOnly = (
  value: unknown,
): NativeSnapshotHeader => validateNativeSnapshotHeader(value);

export const validateGraphMatchesSnapshot = (
  graph: EventGraph,
  snapshot: NativeSnapshotHeader,
): void => {
  validateGraphMatchesHeader(graph, snapshot);
};

const createSnapshotWithLazySections = (
  header: NativeSnapshotHeader,
  graphSource: () => EventGraph,
  runtimeState: NativeSnapshotRuntimeState | undefined,
  legacyRuntimeState: NativeRuntimeState,
): NativeSnapshot => {
  let eventGraph: SerializedGraphOutput | null = null;
  let sequenceRecords: ReadonlyArray<EngineSequenceRecord> | null = null;
  let deleteTargets: ReadonlyArray<DeleteTargetRecord> | null = null;
  return {
    ...header,
    get sequenceRecords(): ReadonlyArray<EngineSequenceRecord> {
      sequenceRecords ??= runtimeState
        ? recordsFromCompactRecords(runtimeState.sequenceRecords)
        : legacyRuntimeState.sequenceRecords;
      return sequenceRecords;
    },
    get deleteTargets(): ReadonlyArray<DeleteTargetRecord> {
      deleteTargets ??= runtimeState
        ? recordsFromCompactDeleteTargets(runtimeState.deleteTargets)
        : legacyRuntimeState.deleteTargets;
      return deleteTargets;
    },
    get eventGraph(): SerializedGraphOutput {
      eventGraph ??= graphSource().serialize();
      return eventGraph;
    },
  };
};

const createMemoizedGraphSource = (bytes: Uint8Array): (() => EventGraph) => {
  let graph: EventGraph | null = null;
  return () => {
    graph ??= columnarCodec.decodeBinary(bytes);
    return graph;
  };
};

const validateGraphMatchesHeader = (
  graph: EventGraph,
  header: NativeSnapshotHeader,
): void => {
  if (graph.getEventCount() !== header.eventCount) {
    throw new Error(
      `Invalid native snapshot: eventCount ${header.eventCount} does not match event graph length ${graph.getEventCount()}`,
    );
  }
  const graphFrontier = graph.getFrontier();
  const snapshotFrontier = new Set(header.currentVersion);
  if (!versionsEqual(graphFrontier, snapshotFrontier)) {
    throw new Error(
      "Invalid native snapshot: currentVersion does not match event graph frontier",
    );
  }
};

const headerFromSnapshot = (
  snapshot: NativeSnapshot,
): NativeSnapshotWireHeader => ({
  formatVersion: snapshot.formatVersion,
  text: snapshot.text,
  initialText: snapshot.initialText,
  currentVersion: snapshot.currentVersion,
  eventCount: snapshot.eventCount,
  nextSequenceNumber: snapshot.nextSequenceNumber,
  metadata: snapshot.metadata,
  checkpoints: snapshot.checkpoints,
});

const encodeRuntimeState = (state: NativeRuntimeState): Uint8Array => {
  const idTable = createIdTable(state);
  const replicaTable = createReplicaTable(state.sequenceRecords);
  const writer = new BinaryWriter();

  writer.writeStringArray(idTable.values);
  writer.writeStringArray(replicaTable.values);
  writeSequenceRecords(writer, state.sequenceRecords, idTable, replicaTable);
  writeDeleteTargets(writer, state.deleteTargets, idTable);

  return writer.toUint8Array();
};

const decodeRuntimeState = (bytes: Uint8Array): NativeSnapshotRuntimeState => {
  const reader = new BinaryReader(bytes);
  const idTable = reader.readStringArray();
  const replicaTable = reader.readStringArray();
  const sequenceRecords = readSequenceRecords(reader, idTable, replicaTable);
  const deleteTargets = readDeleteTargets(reader, idTable);
  if (reader.remainingByteLength !== 0) {
    throw new Error("Invalid native snapshot runtime state: trailing bytes");
  }
  return { sequenceRecords, deleteTargets };
};

interface StringTable {
  readonly values: ReadonlyArray<string>;
  readonly ids: ReadonlyMap<string, number>;
}

const createIdTable = (state: NativeRuntimeState): StringTable => {
  const ids = new Map<string, number>();
  const values: string[] = [];
  const add = (value: string | null): void => {
    if (value === null || ids.has(value)) {
      return;
    }
    ids.set(value, values.length);
    values.push(value);
  };

  for (const record of state.sequenceRecords) {
    add(record.id);
    add(record.eventId);
    add(record.originLeft);
    add(record.originRight);
  }
  for (const target of state.deleteTargets) {
    add(target.deleteEventId);
    for (const targetId of target.targetIds) {
      add(targetId);
    }
  }

  return { values, ids };
};

const createReplicaTable = (
  sequenceRecords: ReadonlyArray<EngineSequenceRecord>,
): StringTable => {
  const ids = new Map<string, number>();
  const values: string[] = [];
  for (const record of sequenceRecords) {
    if (record.run === null || ids.has(record.run.replicaId)) {
      continue;
    }
    ids.set(record.run.replicaId, values.length);
    values.push(record.run.replicaId);
  }
  return { values, ids };
};

const writeSequenceRecords = (
  writer: BinaryWriter,
  records: ReadonlyArray<EngineSequenceRecord>,
  idTable: StringTable,
  replicaTable: StringTable,
): void => {
  writer.writeVarint(records.length);
  writeMappedVarintArray(writer, records, (record) =>
    idIndex(idTable, record.id),
  );
  writeMappedVarintArray(writer, records, (record) =>
    idIndex(idTable, record.eventId),
  );
  writeMappedVarintArray(writer, records, (record) =>
    optionalIdIndex(idTable, record.originLeft),
  );
  writeMappedVarintArray(writer, records, (record) =>
    optionalIdIndex(idTable, record.originRight),
  );
  writeMappedVarintArray(writer, records, (record) =>
    record.everDeleted ? 1 : 0,
  );
  writeMappedVarintArray(writer, records, (record) => record.prepareState);
  writeMappedVarintArray(writer, records, (record) =>
    record.run === null
      ? 0
      : replicaIndex(replicaTable, record.run.replicaId) + 1,
  );
  writeMappedVarintArray(
    writer,
    records,
    (record) => record.run?.startSequence ?? 0,
  );
  writeContentBlob(writer, records);
};

const writeMappedVarintArray = <T>(
  writer: BinaryWriter,
  values: ReadonlyArray<T>,
  mapValue: (value: T) => number,
): void => {
  writer.writeVarint(values.length);
  for (const value of values) {
    writer.writeVarint(mapValue(value));
  }
};

const readSequenceRecords = (
  reader: BinaryReader,
  idTable: ReadonlyArray<string>,
  replicaTable: ReadonlyArray<string>,
): CompactEngineSequenceRecords => {
  const count = reader.readVarint();
  const idRefs = expectColumnLength(
    reader.readVarintUint32Array(),
    count,
    "record ids",
  );
  const eventIds = expectColumnLength(
    reader.readVarintUint32Array(),
    count,
    "record event ids",
  );
  const originLefts = expectColumnLength(
    reader.readVarintUint32Array(),
    count,
    "record originLeft ids",
  );
  const originRights = expectColumnLength(
    reader.readVarintUint32Array(),
    count,
    "record originRight ids",
  );
  const everDeleted = expectColumnLength(
    reader.readVarintUint32Array(),
    count,
    "record deletion flags",
  );
  const prepareStates = expectColumnLength(
    reader.readVarintUint32Array(),
    count,
    "record prepare states",
  );
  const runReplicas = expectColumnLength(
    reader.readVarintUint32Array(),
    count,
    "record run replicas",
  );
  const runStartSequences = expectColumnLength(
    reader.readVarintUint32Array(),
    count,
    "record run start sequences",
  );
  const content = readContentBlob(reader, count);

  return {
    count,
    idTable,
    replicaTable,
    idRefs,
    eventIdRefs: eventIds,
    originLeftRefs: originLefts,
    originRightRefs: originRights,
    everDeleted,
    prepareStates,
    runReplicaRefs: runReplicas,
    runStartSequences,
    contentOffsets: content.offsets,
    contentBytes: content.bytes,
  };
};

const writeContentBlob = (
  writer: BinaryWriter,
  records: ReadonlyArray<EngineSequenceRecord>,
): void => {
  const encoded = records.map((record) => encoder.encode(record.content));
  const offsets: number[] = [0];
  for (const content of encoded) {
    offsets.push(offsets[offsets.length - 1]! + content.byteLength);
  }
  const blob = new Uint8Array(offsets[offsets.length - 1]!);
  encoded.reduce((offset, content) => {
    blob.set(content, offset);
    return offset + content.byteLength;
  }, 0);

  writer.writeZigZagDeltaArray(offsets);
  writer.writeBytes(blob);
};

const readContentBlob = (
  reader: BinaryReader,
  recordCount: number,
): { readonly offsets: Uint32Array; readonly bytes: Uint8Array } => {
  const offsets = expectColumnLength(
    Uint32Array.from(reader.readZigZagDeltaArray()),
    recordCount + 1,
    "record content offsets",
  );
  if (offsets[0] !== 0) {
    throw new Error(
      "Invalid native snapshot runtime state: content offsets must start at zero",
    );
  }
  const blob = reader.readBytes(reader.readVarint());
  for (let index = 0; index < recordCount; index++) {
    const start = offsets[index]!;
    const end = offsets[index + 1]!;
    if (start > end || end > blob.byteLength) {
      throw new Error(
        "Invalid native snapshot runtime state: content offset out of bounds",
      );
    }
  }
  return { offsets, bytes: blob };
};

const writeDeleteTargets = (
  writer: BinaryWriter,
  targets: ReadonlyArray<DeleteTargetRecord>,
  idTable: StringTable,
): void => {
  writer.writeVarint(targets.length);
  for (const target of targets) {
    writer.writeVarint(idIndex(idTable, target.deleteEventId));
    writeMappedVarintArray(writer, target.targetIds, (targetId) =>
      idIndex(idTable, targetId),
    );
  }
};

const readDeleteTargets = (
  reader: BinaryReader,
  idTable: ReadonlyArray<string>,
): CompactDeleteTargetRecords => {
  const count = reader.readVarint();
  const deleteEventRefs = new Uint32Array(count);
  const targetOffsets = new Uint32Array(count + 1);
  const targetRefs: number[] = [];
  for (let index = 0; index < count; index++) {
    deleteEventRefs[index] = reader.readVarint();
    const refs = reader.readVarintUint32Array();
    targetOffsets[index] = targetRefs.length;
    for (const ref of refs) {
      targetRefs.push(ref);
    }
  }
  targetOffsets[count] = targetRefs.length;
  return {
    idTable,
    deleteEventRefs,
    targetOffsets,
    targetRefs: Uint32Array.from(targetRefs),
  };
};

const idIndex = (table: StringTable, value: string): number => {
  const index = table.ids.get(value);
  if (index === undefined) {
    throw new Error(`Missing native snapshot id table entry for ${value}`);
  }
  return index;
};

const optionalIdIndex = (table: StringTable, value: string | null): number =>
  value === null ? 0 : idIndex(table, value) + 1;

const replicaIndex = (table: StringTable, value: string): number => {
  const index = table.ids.get(value);
  if (index === undefined) {
    throw new Error(`Missing native snapshot replica table entry for ${value}`);
  }
  return index;
};

const expectColumnLength = (
  values: Uint32Array,
  expected: number,
  label: string,
): Uint32Array => {
  if (values.length !== expected) {
    throw new Error(
      `Invalid native snapshot runtime state: ${label} has ${values.length} entries but expected ${expected}`,
    );
  }
  return values;
};

const validateNativeSnapshotHeaderPayload = (
  value: unknown,
): {
  readonly header: NativeSnapshotHeader;
  readonly sequenceRecords: ReadonlyArray<EngineSequenceRecord>;
  readonly deleteTargets: ReadonlyArray<DeleteTargetRecord>;
} => {
  const snapshot = expectRecord(value, "native snapshot header");
  return {
    header: validateNativeSnapshotHeaderRecord(snapshot),
    sequenceRecords: expectSequenceRecords(snapshot.sequenceRecords),
    deleteTargets: expectDeleteTargets(snapshot.deleteTargets),
  };
};

const validateNativeSnapshotHeader = (value: unknown): NativeSnapshotHeader =>
  validateNativeSnapshotHeaderRecord(
    expectRecord(value, "native snapshot header"),
  );

const validateNativeSnapshotHeaderRecord = (
  snapshot: Record<string, unknown>,
): NativeSnapshotHeader => {
  const formatVersion = snapshot.formatVersion;
  if (formatVersion !== NATIVE_SNAPSHOT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported native snapshot version: ${String(formatVersion)}`,
    );
  }

  return {
    formatVersion,
    text: expectString(snapshot.text, "native snapshot text"),
    initialText: expectString(
      snapshot.initialText,
      "native snapshot initialText",
    ),
    currentVersion: expectStringArray(
      snapshot.currentVersion,
      "native snapshot currentVersion",
    ),
    eventCount: expectNonNegativeInteger(
      snapshot.eventCount,
      "native snapshot eventCount",
    ),
    nextSequenceNumber: expectNonNegativeInteger(
      snapshot.nextSequenceNumber,
      "native snapshot nextSequenceNumber",
    ),
    metadata:
      snapshot.metadata === undefined
        ? undefined
        : expectRecord(snapshot.metadata, "native snapshot metadata"),
    checkpoints: expectCheckpoints(snapshot.checkpoints),
  };
};

export const validateNativeSnapshot = (value: unknown): NativeSnapshot => {
  const snapshot = expectRecord(value, "native snapshot");
  const formatVersion = snapshot.formatVersion;
  if (formatVersion !== NATIVE_SNAPSHOT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported native snapshot version: ${String(formatVersion)}`,
    );
  }

  const text = expectString(snapshot.text, "native snapshot text");
  const initialText = expectString(
    snapshot.initialText,
    "native snapshot initialText",
  );
  const currentVersion = expectStringArray(
    snapshot.currentVersion,
    "native snapshot currentVersion",
  );
  const eventCount = expectNonNegativeInteger(
    snapshot.eventCount,
    "native snapshot eventCount",
  );
  const nextSequenceNumber = expectNonNegativeInteger(
    snapshot.nextSequenceNumber,
    "native snapshot nextSequenceNumber",
  );
  const metadata =
    snapshot.metadata === undefined
      ? undefined
      : expectRecord(snapshot.metadata, "native snapshot metadata");
  const sequenceRecords = expectSequenceRecords(snapshot.sequenceRecords);
  const deleteTargets = expectDeleteTargets(snapshot.deleteTargets);
  const checkpoints = expectCheckpoints(snapshot.checkpoints);
  const eventGraph = expectSerializedGraph(snapshot.eventGraph);

  if (eventGraph.events.length !== eventCount) {
    throw new Error(
      `Invalid native snapshot: eventCount ${eventCount} does not match event graph length ${eventGraph.events.length}`,
    );
  }

  return {
    formatVersion,
    text,
    initialText,
    currentVersion,
    eventCount,
    nextSequenceNumber,
    metadata,
    sequenceRecords,
    deleteTargets,
    checkpoints,
    eventGraph,
  };
};

const expectSequenceRecords = (
  value: unknown,
): ReadonlyArray<EngineSequenceRecord> => {
  if (value === undefined) {
    return [];
  }
  return expectArray(value, "native snapshot sequenceRecords").map(
    expectSequenceRecord,
  );
};

const expectSequenceRecord = (value: unknown): EngineSequenceRecord => {
  const record = expectRecord(value, "native snapshot sequence record");
  return {
    id: expectString(record.id, "native snapshot sequence record id"),
    eventId: expectString(
      record.eventId,
      "native snapshot sequence record eventId",
    ),
    content: expectString(
      record.content,
      "native snapshot sequence record content",
    ),
    originLeft:
      record.originLeft === null
        ? null
        : expectString(
            record.originLeft,
            "native snapshot sequence record originLeft",
          ),
    originRight:
      record.originRight === null
        ? null
        : expectString(
            record.originRight,
            "native snapshot sequence record originRight",
          ),
    everDeleted: expectBoolean(
      record.everDeleted,
      "native snapshot sequence record everDeleted",
    ),
    prepareState: expectNonNegativeInteger(
      record.prepareState,
      "native snapshot sequence record prepareState",
    ),
    run:
      record.run === null
        ? null
        : expectTypedRun(record.run, "native snapshot sequence record run"),
  };
};

const expectTypedRun = (
  value: unknown,
  label: string,
): EngineSequenceRecord["run"] => {
  const run = expectRecord(value, label);
  return {
    replicaId: expectString(run.replicaId, `${label}.replicaId`),
    startSequence: expectNonNegativeInteger(
      run.startSequence,
      `${label}.startSequence`,
    ),
  };
};

const expectDeleteTargets = (
  value: unknown,
): ReadonlyArray<DeleteTargetRecord> => {
  if (value === undefined) {
    return [];
  }
  return expectArray(value, "native snapshot deleteTargets").map(
    expectDeleteTarget,
  );
};

const expectDeleteTarget = (value: unknown): DeleteTargetRecord => {
  const record = expectRecord(value, "native snapshot delete target");
  return {
    deleteEventId: expectString(
      record.deleteEventId,
      "native snapshot delete target deleteEventId",
    ),
    targetIds: expectStringArray(
      record.targetIds,
      "native snapshot delete target targetIds",
    ),
  };
};

const expectCheckpoints = (
  value: unknown,
): ReadonlyArray<CriticalCheckpointSnapshot> => {
  if (value === undefined) {
    return [];
  }
  return expectArray(value, "native snapshot checkpoints").map(
    expectCheckpoint,
  );
};

const expectCheckpoint = (value: unknown): CriticalCheckpointSnapshot => {
  const checkpoint = expectRecord(value, "native snapshot checkpoint");
  return {
    version: expectStringArray(
      checkpoint.version,
      "native snapshot checkpoint version",
    ),
    text: expectString(checkpoint.text, "native snapshot checkpoint text"),
    eventCount: expectNonNegativeInteger(
      checkpoint.eventCount,
      "native snapshot checkpoint eventCount",
    ),
  };
};

const expectSerializedGraph = (value: unknown): SerializedGraphOutput => {
  const graph = expectRecord(value, "native snapshot eventGraph");
  const version = expectStringArray(
    graph.version,
    "native snapshot eventGraph.version",
  );
  const events = expectArray(
    graph.events,
    "native snapshot eventGraph.events",
  ).map(expectSerializedGraphEvent);
  const metadata =
    graph.metadata === undefined
      ? undefined
      : expectRecord(graph.metadata, "native snapshot eventGraph.metadata");

  return { version, events, metadata };
};

const expectSerializedGraphEvent = (
  value: unknown,
): SerializedGraphEventOutput => {
  const event = expectRecord(value, "native snapshot eventGraph event");
  return {
    id: expectString(event.id, "native snapshot event id"),
    operation: expectExternalOperation(event.operation),
    parentVersion: expectStringArray(
      event.parentVersion,
      "native snapshot event parentVersion",
    ),
    timestamp: expectNumber(event.timestamp, "native snapshot event timestamp"),
  };
};

const expectExternalOperation = (value: unknown): ExternalOperation => {
  const operation = expectRecord(value, "native snapshot operation");
  const type = operation.type;
  if (type === OPERATION_TYPE.INSERT) {
    return {
      type,
      index: expectNonNegativeInteger(
        operation.index,
        "native snapshot insert index",
      ),
      text: expectString(operation.text, "native snapshot insert text"),
    };
  }
  if (type === OPERATION_TYPE.DELETE) {
    return {
      type,
      index: expectNonNegativeInteger(
        operation.index,
        "native snapshot delete index",
      ),
      length: expectNonNegativeInteger(
        operation.length,
        "native snapshot delete length",
      ),
    };
  }
  throw new Error(`Invalid native snapshot operation type: ${String(type)}`);
};

const expectRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`Invalid ${label}: expected object`);
};

const expectArray = (value: unknown, label: string): ReadonlyArray<unknown> => {
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error(`Invalid ${label}: expected array`);
};

const expectStringArray = (
  value: unknown,
  label: string,
): ReadonlyArray<string> =>
  expectArray(value, label).map((item) => expectString(item, label));

const expectString = (value: unknown, label: string): string => {
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Invalid ${label}: expected string`);
};

const expectNumber = (value: unknown, label: string): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Invalid ${label}: expected finite number`);
};

const expectBoolean = (value: unknown, label: string): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`Invalid ${label}: expected boolean`);
};

const expectNonNegativeInteger = (value: unknown, label: string): number => {
  const number = expectNumber(value, label);
  if (Number.isInteger(number) && number >= 0) {
    return number;
  }
  throw new Error(`Invalid ${label}: expected non-negative integer`);
};

const versionsEqual = (
  left: ReadonlySet<EventId>,
  right: ReadonlySet<EventId>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }
  return true;
};
