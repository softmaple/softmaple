import type { EventId } from "../../types";
import { IndexedSequence } from "../indexed-sequence";
import type { AugmentedCRDTItem, TypedRun } from "./engine-types";

const decoder = new TextDecoder();

export interface EngineSequenceRecord {
  readonly id: EventId;
  readonly eventId: EventId;
  readonly content: string;
  readonly originLeft: EventId | null;
  readonly originRight: EventId | null;
  readonly everDeleted: boolean;
  readonly prepareState: number;
  readonly run: TypedRun | null;
}

export interface CompactEngineSequenceRecords {
  readonly count: number;
  readonly idTable: ReadonlyArray<EventId>;
  readonly replicaTable: ReadonlyArray<string>;
  readonly idRefs: Uint32Array;
  readonly eventIdRefs: Uint32Array;
  readonly originLeftRefs: Uint32Array;
  readonly originRightRefs: Uint32Array;
  readonly contentOffsets: Uint32Array;
  readonly contentBytes: Uint8Array;
  readonly everDeleted: Uint8Array;
  readonly prepareStates: Uint32Array;
  readonly runReplicaRefs: Uint32Array;
  readonly runStartSequences: Uint32Array;
}

export const recordFromItem = (
  item: AugmentedCRDTItem,
): EngineSequenceRecord => ({
  id: item.id,
  eventId: item.eventId,
  content: item.content,
  originLeft: item.originLeft,
  originRight: item.originRight,
  everDeleted: item.everDeleted,
  prepareState: item.prepareState,
  run: cloneRun(item.run),
});

export const itemFromRecord = (
  record: EngineSequenceRecord,
): AugmentedCRDTItem => ({
  id: record.id,
  eventId: record.eventId,
  content: record.content,
  originLeft: record.originLeft,
  originRight: record.originRight,
  everDeleted: record.everDeleted,
  prepareState: record.prepareState,
  run: cloneRun(record.run),
});

export const recordsFromItems = (
  items: ReadonlyArray<AugmentedCRDTItem>,
): EngineSequenceRecord[] => items.map(recordFromItem);

export const itemsFromRecords = (
  records: ReadonlyArray<EngineSequenceRecord>,
): AugmentedCRDTItem[] => records.map(itemFromRecord);

export const recordsFromCompactRecords = (
  records: CompactEngineSequenceRecords,
): EngineSequenceRecord[] =>
  Array.from({ length: records.count }, (_, index) =>
    recordFromCompactRecord(records, index),
  );

export const itemsFromCompactRecords = (
  records: CompactEngineSequenceRecords,
): AugmentedCRDTItem[] =>
  Array.from({ length: records.count }, (_, index) =>
    itemFromCompactRecord(records, index),
  );

export const sequenceFromRecords = (
  records: ReadonlyArray<EngineSequenceRecord>,
): IndexedSequence<AugmentedCRDTItem> =>
  IndexedSequence.fromRecords(
    itemsFromRecords(records),
    prepareWeight,
    effectWeight,
  );

const prepareWeight = (item: AugmentedCRDTItem): number =>
  item.prepareState === 1 ? item.content.length : 0;

const effectWeight = (item: AugmentedCRDTItem): number =>
  item.everDeleted ? 0 : item.content.length;

const recordFromCompactRecord = (
  records: CompactEngineSequenceRecords,
  index: number,
): EngineSequenceRecord => ({
  id: readIdRef(records.idTable, records.idRefs[index] ?? 0),
  eventId: readIdRef(records.idTable, records.eventIdRefs[index] ?? 0),
  content: decodeContent(records, index),
  originLeft: readOptionalIdRef(
    records.idTable,
    records.originLeftRefs[index] ?? 0,
  ),
  originRight: readOptionalIdRef(
    records.idTable,
    records.originRightRefs[index] ?? 0,
  ),
  everDeleted: (records.everDeleted[index] ?? 0) === 1,
  prepareState: records.prepareStates[index] ?? 0,
  run: readRun(records, index),
});

const itemFromCompactRecord = (
  records: CompactEngineSequenceRecords,
  index: number,
): AugmentedCRDTItem => ({
  id: readIdRef(records.idTable, records.idRefs[index] ?? 0),
  eventId: readIdRef(records.idTable, records.eventIdRefs[index] ?? 0),
  content: decodeContent(records, index),
  originLeft: readOptionalIdRef(
    records.idTable,
    records.originLeftRefs[index] ?? 0,
  ),
  originRight: readOptionalIdRef(
    records.idTable,
    records.originRightRefs[index] ?? 0,
  ),
  everDeleted: (records.everDeleted[index] ?? 0) === 1,
  prepareState: records.prepareStates[index] ?? 0,
  run: readRun(records, index),
});

const decodeContent = (
  records: CompactEngineSequenceRecords,
  index: number,
): string => {
  const start = records.contentOffsets[index] ?? 0;
  const end = records.contentOffsets[index + 1] ?? start;
  return decoder.decode(records.contentBytes.subarray(start, end));
};

const readIdRef = (
  table: ReadonlyArray<EventId>,
  oneBasedRef: number,
): EventId => {
  const value = table[oneBasedRef - 1];
  if (value === undefined) {
    throw new Error(`Invalid compact sequence id ref ${oneBasedRef}`);
  }
  return value;
};

const readOptionalIdRef = (
  table: ReadonlyArray<EventId>,
  oneBasedRef: number,
): EventId | null => (oneBasedRef === 0 ? null : readIdRef(table, oneBasedRef));

const readRun = (
  records: CompactEngineSequenceRecords,
  index: number,
): TypedRun | null => {
  const replicaRef = records.runReplicaRefs[index] ?? 0;
  if (replicaRef === 0) {
    return null;
  }
  const replicaId = records.replicaTable[replicaRef - 1];
  if (replicaId === undefined) {
    throw new Error(`Invalid compact sequence replica ref ${replicaRef}`);
  }
  return {
    replicaId,
    startSequence: records.runStartSequences[index] ?? 0,
  };
};

const cloneRun = (run: TypedRun | null): TypedRun | null =>
  run === null
    ? null
    : { replicaId: run.replicaId, startSequence: run.startSequence };
