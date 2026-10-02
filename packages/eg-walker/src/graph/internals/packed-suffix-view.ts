import type { EventId } from "../../types";
import type { AgentTable } from "./agent-table";
import { GraphRuns } from "./graph-runs";
import {
  PACKED_OPERATION_TYPE,
  PackedEventGraphBase,
  type PackedEventIdIndex,
} from "./packed-event-graph-base";
import type {
  PackedIntegerColumn,
  PackedUnsignedIntegerColumn,
} from "./packed-numeric-columns";
import type { TailEventLog } from "./tail-event-log";

/** The event graph a suffix view is cut from. */
export interface PackedSuffixSource {
  readonly agents: AgentTable;
  readonly eventCount: number;
  /** The immutable packed prefix, if any: insertion ranks `[0, count)`. */
  readonly packedPrefix: PackedEventGraphBase | null;
  /** Events after the packed prefix. */
  readonly tail: TailEventLog;
  /** Insertion rank of an event, or `-1`. */
  localVersionOf(id: EventId): number;
  idAtLocalVersion(localVersion: number): EventId;
  agentAt(localVersion: number): number;
  sequenceAt(localVersion: number): number;
}

/**
 * Pack the events after a critical cut, for planning and replaying them
 * without packing the rest of the graph.
 *
 * View offset `k` is insertion rank `prefixEventCount - 1 + k`. Offset 0 is
 * the last event before the cut and stands for every event before it: each
 * parent before the cut becomes offset 0, and offset 0 has no parent. A
 * critical cut is in every version of the events after it, so a version
 * diff between two of them never reaches the prefix, and the view walks the
 * same divergent events the whole graph would. IDs resolve through the graph.
 *
 * Costs the suffix, not the graph. Returns `null` when the tail holds an
 * event its typed columns cannot describe, or when an event after the cut
 * has no parent and so cannot descend from the cut.
 */
export const buildPackedSuffixView = (
  source: PackedSuffixSource,
  prefixEventCount: number,
): PackedEventGraphBase | null => {
  const eventCount = source.eventCount;
  if (
    !Number.isSafeInteger(prefixEventCount) ||
    prefixEventCount < 1 ||
    prefixEventCount > eventCount
  ) {
    throw new RangeError(`Invalid critical prefix size ${prefixEventCount}`);
  }
  const tail = source.tail;
  const tailColumns = tail.operationColumns();
  if (tailColumns === null) {
    return null;
  }
  const origin = prefixEventCount - 1;
  const count = eventCount - origin;
  const prefix = source.packedPrefix;
  const packedCount = prefix?.count ?? 0;
  // Ranks after the cut that the packed prefix still holds.
  const packedEnd = Math.min(packedCount, eventCount);
  const firstPackedRank = origin + 1;
  const firstTailIndex = Math.max(0, origin + 1 - packedCount);

  const wide =
    tailColumns.indexes instanceof Float64Array ||
    tailColumns.lengths instanceof Float64Array ||
    firstPackedRank < packedEnd;
  const operationTypes = new Uint8Array(count);
  const operationIndexes: PackedUnsignedIntegerColumn = wide
    ? new Float64Array(count)
    : new Uint32Array(count);
  const operationLengths: PackedUnsignedIntegerColumn = wide
    ? new Float64Array(count)
    : new Uint32Array(count);
  const timestamps: PackedIntegerColumn =
    tailColumns.timestamps instanceof Int32Array && firstPackedRank >= packedEnd
      ? new Int32Array(count)
      : new Float64Array(count);
  const insertStarts = new Uint32Array(count);
  // Offset 0 never replays; give it an empty delete.
  operationTypes[0] = PACKED_OPERATION_TYPE.DELETE;

  const explicit: number[] = [];
  const parentStarts: number[] = [0];
  const parents: number[] = [];
  const contentParts: string[] = [];
  let contentLength = 0;

  // Events after the cut inside the packed prefix, one at a time. Only a
  // checkpoint inside a restored packed history needs this.
  for (let rank = firstPackedRank; rank < packedEnd; rank++) {
    const offset = rank - origin;
    const isInsert = prefix!.isInsertAt(rank);
    const length = prefix!.operationLengthAt(rank);
    operationTypes[offset] = isInsert
      ? PACKED_OPERATION_TYPE.INSERT
      : PACKED_OPERATION_TYPE.DELETE;
    operationIndexes[offset] = prefix!.operationIndexAt(rank);
    operationLengths[offset] = length;
    timestamps[offset] = prefix!.timestampAt(rank) ?? 0;
    if (isInsert) {
      const start = prefix!.insertStartAt(rank);
      insertStarts[offset] = contentLength;
      contentParts.push(prefix!.sliceInsertedContent(start, start + length));
      contentLength += length;
    }
    const parentCount = prefix!.parentCountAt(rank);
    if (parentCount === 0) {
      return null;
    }
    const first = parents.length;
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentRank = prefix!.parentOffsetAt(rank, parentIndex)!;
      const parentOffset = parentRank > origin ? parentRank - origin : 0;
      if (!parents.includes(parentOffset, first)) {
        parents.push(parentOffset);
      }
    }
    if (parents.length - first === 1 && parents[first] === offset - 1) {
      parents.length = first;
      continue;
    }
    explicit.push(offset);
    parentStarts.push(parents.length);
  }

  if (firstTailIndex < tail.count) {
    const tailOffset = packedCount + firstTailIndex - origin;
    const tailCount = tail.count - firstTailIndex;
    operationTypes.set(
      tailColumns.types.subarray(firstTailIndex, tail.count),
      tailOffset,
    );
    operationIndexes.set(
      tailColumns.indexes.subarray(firstTailIndex, tail.count),
      tailOffset,
    );
    operationLengths.set(
      tailColumns.lengths.subarray(firstTailIndex, tail.count),
      tailOffset,
    );
    timestamps.set(
      tailColumns.timestamps.subarray(firstTailIndex, tail.count),
      tailOffset,
    );
    // The tail stores inserted text in insertion order, so the text of the
    // events after the cut is one slice from the first of their inserts.
    let firstInsertStart = -1;
    for (let index = 0; index < tailCount; index++) {
      if (
        tailColumns.types[firstTailIndex + index] ===
        PACKED_OPERATION_TYPE.INSERT
      ) {
        const start = tailColumns.insertStarts[firstTailIndex + index]!;
        if (firstInsertStart < 0) {
          firstInsertStart = start;
        }
        insertStarts[tailOffset + index] =
          contentLength + start - firstInsertStart;
      }
    }
    if (firstInsertStart >= 0) {
      contentParts.push(
        tail.sliceInsertedContent(firstInsertStart, tail.contentLength),
      );
    }
    if (
      !tail.appendViewExplicitParents(
        firstTailIndex,
        packedCount,
        origin,
        explicit,
        parentStarts,
        parents,
      )
    ) {
      return null;
    }
  }

  return PackedEventGraphBase.create({
    idIndex: new PackedSuffixIdIndex(source, origin, count),
    operationTypes,
    operationIndexes,
    operationLengths,
    timestamps,
    insertStarts,
    insertedContent:
      contentParts.length === 1 ? contentParts[0]! : contentParts.join(""),
    runs: GraphRuns.fromExplicitParents(count, explicit, parentStarts, parents),
  });
};

/**
 * IDs of a suffix view, read from the graph. Every ID before the cut is at
 * offset 0, which is how a checkpoint's frontier enters a suffix replay.
 */
class PackedSuffixIdIndex implements PackedEventIdIndex {
  constructor(
    private readonly source: PackedSuffixSource,
    private readonly origin: number,
    readonly count: number,
  ) {}

  get agents(): AgentTable {
    return this.source.agents;
  }

  has(id: EventId): boolean {
    return this.offsetOf(id) !== undefined;
  }

  offsetOf(id: EventId): number | undefined {
    const localVersion = this.source.localVersionOf(id);
    if (localVersion < 0 || localVersion - this.origin >= this.count) {
      return undefined;
    }
    return localVersion > this.origin ? localVersion - this.origin : 0;
  }

  idAt(offset: number): EventId | undefined {
    return Number.isSafeInteger(offset) && offset >= 0 && offset < this.count
      ? this.source.idAtLocalVersion(this.origin + offset)
      : undefined;
  }

  agentAt(offset: number): number {
    return this.source.agentAt(this.origin + offset);
  }

  sequenceAt(offset: number): number {
    return this.source.sequenceAt(this.origin + offset);
  }

  *iterateIds(): IterableIterator<EventId> {
    for (let offset = 0; offset < this.count; offset++) {
      yield this.source.idAtLocalVersion(this.origin + offset);
    }
  }

  maximumSequenceForReplica(): number | undefined {
    throw new Error("A suffix replay view does not index replica sequences");
  }
}
