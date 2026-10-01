import { canonicalSequenceAfter } from "../../graph/event-id";
import { AgentTable } from "../../graph/internals/agent-table";
import type { EventId } from "../../types";
import { IndexedSequence } from "../indexed-sequence";
import {
  CUSTOM_EVENT_AGENT,
  formatPlaceholderId,
  ItemTable,
  PLACEHOLDER_AGENT,
  PLACEHOLDER_EVENT_ID,
  placeholderSerialOf,
  type AugmentedCRDTItem,
  type ExternalItemIds,
  type ItemKey,
} from "./engine-types";
import { materializeRecordContent } from "./record-content";

const decoder = new TextDecoder();

/** Typed-run metadata of a persisted sequence record. */
export interface TypedRun {
  readonly replicaId: string;
  readonly startSequence: number;
}

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
  readonly everDeleted: Uint32Array;
  readonly prepareStates: Uint32Array;
  readonly runReplicaRefs: Uint32Array;
  readonly runStartSequences: Uint32Array;
  readonly contentOffsets: Uint32Array;
  readonly contentBytes: Uint8Array;
}

/** String IDs of the events an engine replays. */
export interface EventIdSource {
  agentTable(): AgentTable;
  /** Local version of an event, or `-1` when the source does not hold it. */
  localVersionOf(id: EventId): number;
  idAtLocalVersion(localVersion: number): EventId;
}

/**
 * Converts between numeric CRDT items and their persisted string form.
 *
 * An item's string ID is `${eventId}:${offset}` for the event that inserted
 * its first code unit, or `__placeholder__:${serial}`. Items carry the event
 * numerically, so these strings exist only in sequence records, delete
 * target records and recovery state.
 */
export class ItemIdCodec {
  constructor(private readonly events: EventIdSource) {}

  eventIdOf(item: AugmentedCRDTItem): EventId {
    if (item.external !== undefined) {
      return item.external.eventId;
    }
    if (item.agent === PLACEHOLDER_AGENT) {
      return PLACEHOLDER_EVENT_ID;
    }
    if (item.agent === CUSTOM_EVENT_AGENT) {
      return this.events.idAtLocalVersion(item.sequence);
    }
    return `${this.events.agentTable().nameOf(item.agent)}:${item.sequence}`;
  }

  itemIdOf(item: AugmentedCRDTItem): EventId {
    if (item.external !== undefined) {
      return item.external.id;
    }
    if (item.agent === PLACEHOLDER_AGENT) {
      return formatPlaceholderId(item.sequence);
    }
    return `${this.eventIdOf(item)}:${item.offset}`;
  }

  recordFromItem(
    item: AugmentedCRDTItem,
    itemAt: (itemId: ItemKey) => AugmentedCRDTItem | undefined,
  ): EngineSequenceRecord {
    return {
      id: this.itemIdOf(item),
      eventId: this.eventIdOf(item),
      content: materializeRecordContent(item.content),
      originLeft: this.optionalItemId(item.originLeft, itemAt),
      originRight: this.optionalItemId(item.originRight, itemAt),
      everDeleted: item.everDeleted,
      prepareState: item.prepareState,
      run: item.run
        ? {
            replicaId: this.events.agentTable().nameOf(item.agent),
            startSequence: item.sequence,
          }
        : null,
    };
  }

  /**
   * Build items for `records`, keyed from `items.nextKey()` in record order.
   * Origins must name records of the same batch.
   */
  itemsFromRecords(
    records: ReadonlyArray<EngineSequenceRecord>,
    items: ItemTable,
  ): AugmentedCRDTItem[] {
    const keyById = new Map<EventId, ItemKey>();
    const firstKey = items.nextKey();
    records.forEach((record, index) => {
      keyById.set(record.id, firstKey + index);
    });
    const resolveOrigin = (
      origin: EventId | null,
      record: EngineSequenceRecord,
    ): ItemKey | null => {
      if (origin === null) {
        return null;
      }
      const key = keyById.get(origin);
      if (key === undefined) {
        throw new Error(
          `Sequence record ${record.id} references unknown item ${origin}`,
        );
      }
      return key;
    };
    return records.map((record, index) => {
      const identity = this.identityOf(record);
      return {
        id: firstKey + index,
        agent: identity.agent,
        sequence: identity.sequence,
        offset: identity.offset,
        content: record.content,
        originLeft: resolveOrigin(record.originLeft, record),
        originRight: resolveOrigin(record.originRight, record),
        everDeleted: record.everDeleted,
        prepareState: record.prepareState,
        run: identity.run,
        ...(identity.external === undefined
          ? {}
          : { external: identity.external }),
      };
    });
  }

  private optionalItemId(
    itemId: ItemKey | null,
    itemAt: (itemId: ItemKey) => AugmentedCRDTItem | undefined,
  ): EventId | null {
    if (itemId === null) {
      return null;
    }
    const item = itemAt(itemId);
    if (item === undefined) {
      throw new Error(`CRDT item ${itemId} not found`);
    }
    return this.itemIdOf(item);
  }

  private identityOf(record: EngineSequenceRecord): {
    readonly agent: number;
    readonly sequence: number;
    readonly offset: number;
    readonly run: boolean;
    readonly external?: ExternalItemIds;
  } {
    const external = { id: record.id, eventId: record.eventId };
    const agents = this.events.agentTable();
    if (record.run !== null) {
      const { replicaId, startSequence } = record.run;
      const agent = agents.intern(replicaId);
      const canonical =
        record.eventId === `${replicaId}:${startSequence}` &&
        record.id === `${record.eventId}:0`;
      return canonical
        ? { agent, sequence: startSequence, offset: 0, run: true }
        : { agent, sequence: startSequence, offset: 0, run: true, external };
    }
    if (record.eventId === PLACEHOLDER_EVENT_ID) {
      const serial = placeholderSerialOf(record.id);
      return serial >= 0
        ? { agent: PLACEHOLDER_AGENT, sequence: serial, offset: 0, run: false }
        : {
            agent: PLACEHOLDER_AGENT,
            sequence: -1,
            offset: 0,
            run: false,
            external,
          };
    }
    const offset = offsetSuffix(record.id, record.eventId);
    const colonIndex = record.eventId.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(record.eventId, colonIndex);
    if (offset >= 0 && sequence >= 0) {
      const agent = agents.internPrefix(record.eventId, colonIndex);
      return { agent, sequence, offset, run: false };
    }
    const localVersion =
      sequence < 0 ? this.events.localVersionOf(record.eventId) : -1;
    if (offset >= 0 && localVersion >= 0) {
      return {
        agent: CUSTOM_EVENT_AGENT,
        sequence: localVersion,
        offset,
        run: false,
      };
    }
    return {
      agent: CUSTOM_EVENT_AGENT,
      sequence: -1,
      offset: 0,
      run: false,
      external,
    };
  }
}

/**
 * Verbatim IDs of the code unit `delta` places after the one `external`
 * names. Only an ID of the form `${eventId}:${offset}` names a code unit, so
 * a record restored under any other ID cannot be split.
 */
export const shiftExternalItemIds = (
  external: ExternalItemIds,
  delta: number,
): ExternalItemIds => {
  const offset = offsetSuffix(external.id, external.eventId);
  if (offset < 0) {
    throw new Error(
      `Record ${external.id} does not name a code unit of event ${external.eventId}`,
    );
  }
  return {
    id: `${external.eventId}:${offset + delta}`,
    eventId: external.eventId,
  };
};

/** The `k` of an item ID `${eventId}:${k}`, or `-1`. */
const offsetSuffix = (itemId: EventId, eventId: EventId): number => {
  if (
    itemId.length <= eventId.length + 1 ||
    itemId.charCodeAt(eventId.length) !== 58 ||
    !itemId.startsWith(eventId)
  ) {
    return -1;
  }
  return canonicalSequenceAfter(itemId, eventId.length);
};

/** Codec for records that no event graph backs; every event is external. */
const detachedCodec = (): ItemIdCodec => {
  const agents = new AgentTable();
  return new ItemIdCodec({
    agentTable: () => agents,
    localVersionOf: () => -1,
    idAtLocalVersion: (localVersion) => {
      throw new Error(`No event graph holds local version ${localVersion}`);
    },
  });
};

/** Items for records outside an engine, keyed from 1. */
export const itemsFromRecords = (
  records: ReadonlyArray<EngineSequenceRecord>,
): AugmentedCRDTItem[] =>
  detachedCodec().itemsFromRecords(records, new ItemTable());

export const recordsFromCompactRecords = (
  records: CompactEngineSequenceRecords,
): EngineSequenceRecord[] =>
  Array.from({ length: records.count }, (_, index) =>
    recordFromCompactRecord(records, index),
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
  zeroBasedRef: number,
): EventId => {
  const value = table[zeroBasedRef];
  if (value === undefined) {
    throw new Error(`Invalid compact sequence id ref ${zeroBasedRef}`);
  }
  return value;
};

const readOptionalIdRef = (
  table: ReadonlyArray<EventId>,
  oneBasedRef: number,
): EventId | null =>
  oneBasedRef === 0 ? null : readIdRef(table, oneBasedRef - 1);

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
