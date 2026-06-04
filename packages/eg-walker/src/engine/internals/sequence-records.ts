import type { EventId } from "../../types";
import { IndexedSequence } from "../indexed-sequence";
import type { AugmentedCRDTItem, TypedRun } from "./engine-types";

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

const cloneRun = (run: TypedRun | null): TypedRun | null =>
  run === null
    ? null
    : { replicaId: run.replicaId, startSequence: run.startSequence };
