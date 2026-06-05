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

export interface NativeSnapshotRuntimeState {
  readonly sequenceRecords: CompactEngineSequenceRecords;
  readonly deleteTargets: CompactDeleteTargetRecords;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC_BYTES = encoder.encode(NATIVE_SNAPSHOT_FORMAT_VERSION);
const RUNTIME_STATE_FORMAT_VERSION = 1;
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
    body.writeBytes(encodeRuntimeState(validated));

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
    const runtimeState = reader.hasRemaining()
      ? decodeRuntimeState(reader.readBytes(reader.readVarint()))
      : undefined;
    const graphSource = createMemoizedGraphSource(graphBytes);
    const snapshot = createSnapshotWithLazySections(
      headerPayload.header,
      graphSource,
      runtimeState,
      {
        sequenceRecords: headerPayload.sequenceRecords,
        deleteTargets: headerPayload.deleteTargets,
      },
    );
    decodedGraphSourceCache.set(snapshot, graphSource);
    if (runtimeState) {
      decodedRuntimeStateCache.set(snapshot, runtimeState);
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
  legacyRuntimeState: {
    readonly sequenceRecords: ReadonlyArray<EngineSequenceRecord>;
    readonly deleteTargets: ReadonlyArray<DeleteTargetRecord>;
  },
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

const encodeRuntimeState = (snapshot: NativeSnapshot): Uint8Array => {
  const sequenceRecords = snapshot.sequenceRecords;
  const deleteTargets = snapshot.deleteTargets;
  const idRefs = createStringTableRefBuilder<EventId>();
  const replicaRefs = createStringTableRefBuilder<string>();

  for (const record of sequenceRecords) {
    idRefs.ref(record.id);
    idRefs.ref(record.eventId);
    if (record.originLeft !== null) {
      idRefs.ref(record.originLeft);
    }
    if (record.originRight !== null) {
      idRefs.ref(record.originRight);
    }
    if (record.run !== null) {
      replicaRefs.ref(record.run.replicaId);
    }
  }
  for (const record of deleteTargets) {
    idRefs.ref(record.deleteEventId);
    for (const targetId of record.targetIds) {
      idRefs.ref(targetId);
    }
  }

  const { bytes: contentBytes, offsets: contentOffsets } =
    encodeContentBlob(sequenceRecords);
  const targetOffsets = createTargetOffsets(deleteTargets);
  const targetCount = targetOffsets[targetOffsets.length - 1] ?? 0;
  const targetRefAt = createTargetRefReader(deleteTargets, targetOffsets);

  const writer = new BinaryWriter();
  writer.writeVarint(RUNTIME_STATE_FORMAT_VERSION);
  writer.writeStringArray(idRefs.values);
  writer.writeStringArray(replicaRefs.values);
  writer.writeVarint(sequenceRecords.length);
  writer.writeMappedVarintArray(sequenceRecords.length, (index) =>
    idRefs.ref(sequenceRecords[index]!.id),
  );
  writer.writeMappedVarintArray(sequenceRecords.length, (index) =>
    idRefs.ref(sequenceRecords[index]!.eventId),
  );
  writer.writeMappedVarintArray(sequenceRecords.length, (index) => {
    const originLeft = sequenceRecords[index]!.originLeft;
    return originLeft === null ? 0 : idRefs.ref(originLeft);
  });
  writer.writeMappedVarintArray(sequenceRecords.length, (index) => {
    const originRight = sequenceRecords[index]!.originRight;
    return originRight === null ? 0 : idRefs.ref(originRight);
  });
  writer.writeMappedVarintArray(contentOffsets.length, (index) =>
    Number(contentOffsets[index] ?? 0),
  );
  writer.writeBytes(contentBytes);
  writer.writeBytes(
    Uint8Array.from(sequenceRecords, (record) => (record.everDeleted ? 1 : 0)),
  );
  writer.writeMappedVarintArray(
    sequenceRecords.length,
    (index) => sequenceRecords[index]!.prepareState,
  );
  writer.writeMappedVarintArray(sequenceRecords.length, (index) => {
    const run = sequenceRecords[index]!.run;
    return run === null ? 0 : replicaRefs.ref(run.replicaId);
  });
  writer.writeMappedVarintArray(
    sequenceRecords.length,
    (index) => sequenceRecords[index]!.run?.startSequence ?? 0,
  );
  writer.writeVarint(deleteTargets.length);
  writer.writeMappedVarintArray(deleteTargets.length, (index) =>
    idRefs.ref(deleteTargets[index]!.deleteEventId),
  );
  writer.writeMappedVarintArray(targetOffsets.length, (index) =>
    Number(targetOffsets[index] ?? 0),
  );
  writer.writeMappedVarintArray(targetCount, (index) =>
    idRefs.ref(targetRefAt(index)),
  );

  return writer.toUint8Array();
};

const decodeRuntimeState = (bytes: Uint8Array): NativeSnapshotRuntimeState => {
  const reader = new BinaryReader(bytes);
  const version = reader.readVarint();
  if (version !== RUNTIME_STATE_FORMAT_VERSION) {
    throw new Error(`Unsupported native runtime state version: ${version}`);
  }
  const idTable = reader.readStringArray();
  const replicaTable = reader.readStringArray();
  const sequenceCount = reader.readVarint();
  const sequenceRecords = {
    count: sequenceCount,
    idTable,
    replicaTable,
    idRefs: expectColumnLength(
      reader.readVarintUint32Array(),
      sequenceCount,
      "compact sequence idRefs",
    ),
    eventIdRefs: expectColumnLength(
      reader.readVarintUint32Array(),
      sequenceCount,
      "compact sequence eventIdRefs",
    ),
    originLeftRefs: expectColumnLength(
      reader.readVarintUint32Array(),
      sequenceCount,
      "compact sequence originLeftRefs",
    ),
    originRightRefs: expectColumnLength(
      reader.readVarintUint32Array(),
      sequenceCount,
      "compact sequence originRightRefs",
    ),
    contentOffsets: expectColumnLength(
      reader.readVarintUint32Array(),
      sequenceCount + 1,
      "compact sequence contentOffsets",
    ),
    contentBytes: reader.readBytes(reader.readVarint()),
    everDeleted: expectByteColumnLength(
      reader.readBytes(reader.readVarint()),
      sequenceCount,
      "compact sequence everDeleted",
    ),
    prepareStates: expectColumnLength(
      reader.readVarintUint32Array(),
      sequenceCount,
      "compact sequence prepareStates",
    ),
    runReplicaRefs: expectColumnLength(
      reader.readVarintUint32Array(),
      sequenceCount,
      "compact sequence runReplicaRefs",
    ),
    runStartSequences: expectColumnLength(
      reader.readVarintUint32Array(),
      sequenceCount,
      "compact sequence runStartSequences",
    ),
  };
  const deleteCount = reader.readVarint();
  const deleteEventRefs = expectColumnLength(
    reader.readVarintUint32Array(),
    deleteCount,
    "compact delete target deleteEventRefs",
  );
  const targetOffsets = expectColumnLength(
    reader.readVarintUint32Array(),
    deleteCount + 1,
    "compact delete target targetOffsets",
  );
  const targetCount = targetOffsets[targetOffsets.length - 1] ?? 0;
  const targetRefs = expectColumnLength(
    reader.readVarintUint32Array(),
    targetCount,
    "compact delete target targetRefs",
  );

  return {
    sequenceRecords,
    deleteTargets: {
      idTable,
      deleteEventRefs,
      targetOffsets,
      targetRefs,
    },
  };
};

const createStringTableRefBuilder = <T extends string>(): {
  readonly values: T[];
  readonly ref: (value: T) => number;
} => {
  const values: T[] = [];
  const indexes = new Map<T, number>();
  return {
    values,
    ref: (value: T): number => {
      const existing = indexes.get(value);
      if (existing !== undefined) {
        return existing + 1;
      }
      const index = values.length;
      indexes.set(value, index);
      values.push(value);
      return index + 1;
    },
  };
};

const encodeContentBlob = (
  records: ReadonlyArray<EngineSequenceRecord>,
): { readonly bytes: Uint8Array; readonly offsets: Uint32Array } => {
  const parts = records.map((record) => encoder.encode(record.content));
  const offsets = new Uint32Array(records.length + 1);
  let byteLength = 0;
  for (let index = 0; index < parts.length; index++) {
    offsets[index] = byteLength;
    byteLength += parts[index]!.byteLength;
  }
  offsets[parts.length] = byteLength;
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { bytes, offsets };
};

const createTargetOffsets = (
  records: ReadonlyArray<DeleteTargetRecord>,
): Uint32Array => {
  const offsets = new Uint32Array(records.length + 1);
  let targetCount = 0;
  for (let index = 0; index < records.length; index++) {
    offsets[index] = targetCount;
    targetCount += records[index]!.targetIds.length;
  }
  offsets[records.length] = targetCount;
  return offsets;
};

const createTargetRefReader = (
  records: ReadonlyArray<DeleteTargetRecord>,
  offsets: Uint32Array,
): ((targetIndex: number) => EventId) => {
  let recordIndex = 0;
  return (targetIndex: number): EventId => {
    while (
      recordIndex + 1 < offsets.length &&
      (offsets[recordIndex + 1] ?? 0) <= targetIndex
    ) {
      recordIndex++;
    }
    const localIndex = targetIndex - (offsets[recordIndex] ?? 0);
    const value = records[recordIndex]?.targetIds[localIndex];
    if (value === undefined) {
      throw new Error(`Invalid delete target index ${targetIndex}`);
    }
    return value;
  };
};

const expectColumnLength = (
  values: Uint32Array,
  expected: number,
  label: string,
): Uint32Array => {
  if (values.length !== expected) {
    throw new Error(
      `Invalid ${label}: expected ${expected} values, received ${values.length}`,
    );
  }
  return values;
};

const expectByteColumnLength = (
  values: Uint8Array,
  expected: number,
  label: string,
): Uint8Array => {
  if (values.length !== expected) {
    throw new Error(
      `Invalid ${label}: expected ${expected} values, received ${values.length}`,
    );
  }
  return values;
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
): NativeSnapshotHeader => ({
  formatVersion: snapshot.formatVersion,
  text: snapshot.text,
  initialText: snapshot.initialText,
  currentVersion: snapshot.currentVersion,
  eventCount: snapshot.eventCount,
  nextSequenceNumber: snapshot.nextSequenceNumber,
  metadata: snapshot.metadata,
  checkpoints: snapshot.checkpoints,
});

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
