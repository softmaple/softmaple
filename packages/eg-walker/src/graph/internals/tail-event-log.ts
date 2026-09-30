import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation } from "../../types";
import type { AgentTable } from "./agent-table";
import { CUSTOM_AGENT, EventIdRunIndex } from "./event-id-run-index";
import type { PackedTailEvents } from "./packed-event-graph-base";

const INSERT_OPERATION = 1;
const DELETE_OPERATION = 2;
const INITIAL_CAPACITY = 16;
const EMPTY_UINT8 = new Uint8Array(0);
const EMPTY_UINT32 = new Uint32Array(0);
const EMPTY_INT32 = new Int32Array(0);
const INT32_MAX = 0x7fff_ffff;
const INT32_MIN = -0x8000_0000;
const UINT32_MAX = 0xffff_ffff;
/** Inserted text is sealed into flat chunks of about this many code units. */
const TEXT_CHUNK_LENGTH = 4_096;

/** Operation columns of a tail, indexed by tail index. */
export interface TailOperationColumns {
  /** 1 for an insert, 2 for a delete. */
  readonly types: Uint8Array;
  readonly indexes: Uint32Array | Float64Array;
  readonly lengths: Uint32Array | Float64Array;
  readonly timestamps: Int32Array | Float64Array;
  /** Offset of an insert's text in the tail's inserted content. */
  readonly insertStarts: Uint32Array;
}

/** No parent or child. */
export const NO_RANK = -1;

/**
 * Events appended after an event graph's packed prefix, stored as columns.
 *
 * Every field of an event is copied into typed columns when it is appended:
 * its ID into an {@link EventIdRunIndex}, its operation into numeric columns
 * and a chunked text store, and its parents as insertion ranks. No
 * `GraphEvent`, operation object, parent `Set` or ID string is retained, so a
 * local keystroke costs a few dozen bytes instead of several hundred.
 *
 * Tail index `i` is the event at insertion rank `packedCount + i`. Parent and
 * child links are insertion ranks in the whole graph.
 */
export class TailEventLog implements PackedTailEvents {
  readonly ids: EventIdRunIndex;
  private eventCount = 0;
  private capacity = 0;
  // Columns start as shared empty arrays: `ensureCapacity` replaces them
  // before any write, so a graph that never appends allocates none.
  private types = EMPTY_UINT8;
  private indexes: Uint32Array | Float64Array = EMPTY_UINT32;
  private lengths: Uint32Array | Float64Array = EMPTY_UINT32;
  private timestamps: Int32Array | Float64Array = EMPTY_INT32;
  private insertStarts = EMPTY_UINT32;
  /**
   * `-1` for a root, a sole parent's rank, or `-2 - start` for an event whose
   * parents are the block at `start` in {@link multiParentRanks}.
   */
  private parents = EMPTY_INT32;
  /**
   * `-1` for no child, a sole child's rank, or `-2 - list` for the child list
   * at `list` in {@link childLists}.
   */
  private children = EMPTY_INT32;
  /** Blocks of `[parentCount, maximumRank, ...parentRanks]`. */
  private readonly multiParentRanks: number[] = [];
  private readonly childLists: number[][] = [];
  private readonly text = new ChunkedTextStore();
  /**
   * Events whose operation or timestamp does not have the shape the columns
   * store, kept verbatim. `EventGraph.addEvent` does not validate payloads;
   * a replica validates stored events before it replays them, so a malformed
   * event must survive storage unchanged to be rejected there.
   */
  private irregular: Map<
    number,
    { readonly operation: ExternalOperation; readonly timestamp: number }
  > | null = null;

  constructor(agents: AgentTable) {
    this.ids = new EventIdRunIndex(agents);
  }

  /** Whether any event is stored verbatim outside the typed columns. */
  hasIrregularEvents(): boolean {
    return this.irregular !== null && this.irregular.size > 0;
  }

  get count(): number {
    return this.eventCount;
  }

  get agents(): AgentTable {
    return this.ids.agents;
  }

  /** Total UTF-16 length of the inserted text. */
  get contentLength(): number {
    return this.text.length;
  }

  /**
   * Append one event and return its tail index.
   *
   * `agent` and `sequence` are the parsed parts of a canonical `id`, or
   * {@link CUSTOM_AGENT} for an ID that does not parse. `parentRanks` lists
   * the parents' insertion ranks in the order of the event's parent version;
   * the caller has resolved and deduplicated them.
   *
   * @throws EventAlreadyExistsError when `id` is already in the log. The log
   * is left unchanged.
   */
  append(
    id: EventId,
    agent: number,
    sequence: number,
    operation: ExternalOperation,
    timestamp: number,
    parentRanks: ReadonlyArray<number>,
  ): number {
    const tailIndex = this.eventCount;
    const indexed =
      agent === CUSTOM_AGENT
        ? this.ids.append(id)
        : this.ids.appendCanonical(agent, sequence);
    if (indexed !== tailIndex) {
      throw new Error("Tail event log IDs are out of step with its columns");
    }
    this.ensureCapacity(tailIndex + 1);
    try {
      this.writeOperation(tailIndex, operation, timestamp);
    } catch (error) {
      this.irregular?.delete(tailIndex);
      this.ids.truncate(tailIndex);
      throw error;
    }

    const parentCount = parentRanks.length;
    if (parentCount === 0) {
      this.parents[tailIndex] = NO_RANK;
    } else if (parentCount === 1) {
      this.parents[tailIndex] = checkedRank(parentRanks[0]!);
    } else {
      const start = this.multiParentRanks.length;
      let maximum = NO_RANK;
      this.multiParentRanks.push(parentCount, NO_RANK);
      for (const rank of parentRanks) {
        maximum = Math.max(maximum, checkedRank(rank));
        this.multiParentRanks.push(rank);
      }
      this.multiParentRanks[start + 1] = maximum;
      this.parents[tailIndex] = encodeList(start);
    }
    this.children[tailIndex] = NO_RANK;
    this.eventCount = tailIndex + 1;
    return tailIndex;
  }

  /**
   * Drop the events at tail index `count` and after. The caller unlinks
   * their child links first, in reverse insertion order.
   */
  truncate(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.eventCount) {
      throw new Error(`Cannot truncate ${this.eventCount} events to ${count}`);
    }
    if (count === this.eventCount) {
      return;
    }
    let multiParentLength: number | null = null;
    let textLength: number | null = null;
    for (let tailIndex = count; tailIndex < this.eventCount; tailIndex++) {
      const parent = this.parents[tailIndex]!;
      if (multiParentLength === null && parent < NO_RANK) {
        multiParentLength = decodeList(parent);
      }
      if (textLength === null && this.types[tailIndex] === INSERT_OPERATION) {
        textLength = this.insertStarts[tailIndex]!;
      }
      const child = this.children[tailIndex]!;
      if (child < NO_RANK) {
        this.childLists[decodeList(child)] = [];
      }
    }
    if (multiParentLength !== null) {
      this.multiParentRanks.length = multiParentLength;
    }
    if (textLength !== null) {
      this.text.truncate(textLength);
    }
    if (this.irregular !== null) {
      for (const tailIndex of this.irregular.keys()) {
        if (tailIndex >= count) {
          this.irregular.delete(tailIndex);
        }
      }
    }
    this.ids.truncate(count);
    this.eventCount = count;
  }

  idAt(tailIndex: number): EventId {
    const id = this.ids.idAt(tailIndex, this.eventCount);
    if (id === undefined) {
      throw new Error(`Tail event log is missing event ${tailIndex}`);
    }
    return id;
  }

  /** Tail index of `id`, or `-1`. */
  indexOf(id: EventId): number {
    return this.ids.localVersionOf(id, this.eventCount);
  }

  agentAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    return this.ids.agentAt(tailIndex);
  }

  sequenceAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    return this.ids.sequenceAt(tailIndex);
  }

  maximumSequenceForReplica(replicaId: string): number | undefined {
    return this.ids.maximumSequenceBefore(replicaId, this.eventCount);
  }

  iterateIds(): IterableIterator<EventId> {
    return this.ids.idsBefore(this.eventCount);
  }

  isInsertAt(tailIndex: number): boolean {
    this.assertIndex(tailIndex);
    return this.types[tailIndex] === INSERT_OPERATION;
  }

  operationIndexAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    return this.indexes[tailIndex]!;
  }

  operationLengthAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    return this.lengths[tailIndex]!;
  }

  /** Offset of an insert's text in the log's inserted content. */
  insertStartAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    return this.insertStarts[tailIndex]!;
  }

  timestampAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    return (
      this.irregular?.get(tailIndex)?.timestamp ?? this.timestamps[tailIndex]!
    );
  }

  sliceInsertedContent(start: number, end: number): string {
    return this.text.slice(start, end);
  }

  /** Every inserted text, joined in insertion order. */
  insertedContent(): string {
    return this.text.toString();
  }

  operationAt(tailIndex: number): ExternalOperation {
    this.assertIndex(tailIndex);
    const irregular = this.irregular?.get(tailIndex);
    if (irregular !== undefined) {
      return { ...irregular.operation };
    }
    const index = this.indexes[tailIndex]!;
    const length = this.lengths[tailIndex]!;
    if (this.types[tailIndex] === INSERT_OPERATION) {
      const start = this.insertStarts[tailIndex]!;
      return {
        type: OPERATION_TYPE.INSERT,
        index,
        text: this.text.slice(start, start + length),
      };
    }
    return { type: OPERATION_TYPE.DELETE, index, length };
  }

  /**
   * The typed operation columns of every event, as views that the next
   * append may invalidate, or `null` while an irregular event is stored.
   */
  operationColumns(): TailOperationColumns | null {
    if (this.hasIrregularEvents()) {
      return null;
    }
    const count = this.eventCount;
    return {
      types: this.types.subarray(0, count),
      indexes: this.indexes.subarray(0, count),
      lengths: this.lengths.subarray(0, count),
      timestamps: this.timestamps.subarray(0, count),
      insertStarts: this.insertStarts.subarray(0, count),
    };
  }

  /**
   * Append the events whose parents are not just their predecessor, in
   * tail order, as `GraphRuns.fromExplicitParents` reads them. `baseCount`
   * is the insertion rank of the first tail event.
   */
  appendExplicitParents(
    baseCount: number,
    explicit: number[],
    parentStarts: number[],
    parents: number[],
  ): void {
    for (let tailIndex = 0; tailIndex < this.eventCount; tailIndex++) {
      const rank = baseCount + tailIndex;
      const parent = this.parents[tailIndex]!;
      if (parent === rank - 1) {
        continue;
      }
      explicit.push(rank);
      if (parent >= 0) {
        parents.push(parent);
      } else if (parent < NO_RANK) {
        const start = decodeList(parent);
        const end = start + 2 + this.multiParentRanks[start]!;
        for (let index = start + 2; index < end; index++) {
          parents.push(this.multiParentRanks[index]!);
        }
      }
      parentStarts.push(parents.length);
    }
  }

  parentCountAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    const parent = this.parents[tailIndex]!;
    if (parent === NO_RANK) {
      return 0;
    }
    return parent >= 0 ? 1 : this.multiParentRanks[decodeList(parent)]!;
  }

  /** Insertion rank of a parent, in the order the event listed them. */
  parentRankAt(tailIndex: number, parentIndex: number): number {
    this.assertIndex(tailIndex);
    const parent = this.parents[tailIndex]!;
    if (parent >= 0 && parentIndex === 0) {
      return parent;
    }
    if (parent < NO_RANK) {
      const start = decodeList(parent);
      if (parentIndex >= 0 && parentIndex < this.multiParentRanks[start]!) {
        return this.multiParentRanks[start + 2 + parentIndex]!;
      }
    }
    throw new RangeError(
      `Tail event ${tailIndex} has no parent ${parentIndex}`,
    );
  }

  /** Greatest parent insertion rank, or `-1` for a root. */
  maximumParentRankAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    const parent = this.parents[tailIndex]!;
    return parent >= NO_RANK
      ? parent
      : this.multiParentRanks[decodeList(parent) + 1]!;
  }

  forEachParentOffset(
    tailIndex: number,
    visit: (parentOffset: number) => void,
  ): void {
    this.forEachParentRank(tailIndex, visit);
  }

  forEachParentRank(tailIndex: number, visit: (rank: number) => void): void {
    this.assertIndex(tailIndex);
    const parent = this.parents[tailIndex]!;
    if (parent === NO_RANK) {
      return;
    }
    if (parent >= 0) {
      visit(parent);
      return;
    }
    const start = decodeList(parent);
    const end = start + 2 + this.multiParentRanks[start]!;
    for (let index = start + 2; index < end; index++) {
      visit(this.multiParentRanks[index]!);
    }
  }

  childCountAt(tailIndex: number): number {
    this.assertIndex(tailIndex);
    const child = this.children[tailIndex]!;
    if (child === NO_RANK) {
      return 0;
    }
    return child >= 0 ? 1 : this.childLists[decodeList(child)]!.length;
  }

  forEachChildRank(tailIndex: number, visit: (rank: number) => void): void {
    this.assertIndex(tailIndex);
    const child = this.children[tailIndex]!;
    if (child === NO_RANK) {
      return;
    }
    if (child >= 0) {
      visit(child);
      return;
    }
    for (const rank of this.childLists[decodeList(child)]!) {
      visit(rank);
    }
  }

  /** Link a child, keeping each event's children in insertion order. */
  appendChild(tailIndex: number, childRank: number): void {
    this.assertIndex(tailIndex);
    const existing = this.children[tailIndex]!;
    if (existing === NO_RANK) {
      this.children[tailIndex] = checkedRank(childRank);
    } else if (existing >= 0) {
      const list = this.childLists.length;
      this.childLists.push([existing, childRank]);
      this.children[tailIndex] = encodeList(list);
    } else {
      this.childLists[decodeList(existing)]!.push(childRank);
    }
  }

  /**
   * Unlink the newest child and return whether the event has no child left.
   * Rollback unwinds children in reverse insertion order.
   */
  removeLastChild(tailIndex: number, childRank: number): boolean {
    this.assertIndex(tailIndex);
    const existing = this.children[tailIndex]!;
    if (existing === NO_RANK) {
      throw new Error(`Event graph is missing child rank ${childRank}`);
    }
    if (existing >= 0) {
      if (existing !== childRank) {
        throw new Error(
          `Event graph child rollback order mismatch for tail event ${tailIndex}`,
        );
      }
      this.children[tailIndex] = NO_RANK;
      return true;
    }
    const list = this.childLists[decodeList(existing)]!;
    if (list[list.length - 1] !== childRank) {
      throw new Error(
        `Event graph child rollback order mismatch for tail event ${tailIndex}`,
      );
    }
    list.pop();
    if (list.length === 1) {
      this.children[tailIndex] = list[0]!;
      list.length = 0;
    }
    return false;
  }

  /** Adjacency counters for structural tests. */
  childStructureStats(): {
    readonly parentEntries: number;
    readonly branchArrays: number;
    readonly childEdges: number;
  } {
    let parentEntries = 0;
    let branchArrays = 0;
    let childEdges = 0;
    for (let tailIndex = 0; tailIndex < this.eventCount; tailIndex++) {
      const child = this.children[tailIndex]!;
      if (child === NO_RANK) {
        continue;
      }
      parentEntries++;
      if (child >= 0) {
        childEdges++;
      } else {
        branchArrays++;
        childEdges += this.childLists[decodeList(child)]!.length;
      }
    }
    return { parentEntries, branchArrays, childEdges };
  }

  private assertIndex(tailIndex: number): void {
    if (
      !Number.isSafeInteger(tailIndex) ||
      tailIndex < 0 ||
      tailIndex >= this.eventCount
    ) {
      throw new Error(`Event graph is missing tail event ${tailIndex}`);
    }
  }

  private ensureCapacity(required: number): void {
    if (required <= this.capacity) {
      return;
    }
    const capacity = Math.max(INITIAL_CAPACITY, this.capacity * 2, required);
    this.types = grow(this.types, new Uint8Array(capacity));
    this.indexes = growUnsigned(this.indexes, capacity);
    this.lengths = growUnsigned(this.lengths, capacity);
    this.timestamps =
      this.timestamps instanceof Int32Array
        ? grow(this.timestamps, new Int32Array(capacity))
        : grow(this.timestamps, new Float64Array(capacity));
    this.insertStarts = grow(this.insertStarts, new Uint32Array(capacity));
    this.parents = grow(this.parents, new Int32Array(capacity));
    this.children = grow(this.children, new Int32Array(capacity));
    this.capacity = capacity;
  }

  private writeOperation(
    tailIndex: number,
    operation: ExternalOperation,
    timestamp: number,
  ): void {
    const candidate = operation as {
      readonly type?: unknown;
      readonly index?: unknown;
      readonly text?: unknown;
      readonly length?: unknown;
    };
    const type = candidate.type;
    const index = candidate.index;
    if (
      typeof timestamp === "number" &&
      typeof index === "number" &&
      type === OPERATION_TYPE.INSERT &&
      typeof candidate.text === "string"
    ) {
      const text = candidate.text;
      const start = this.text.length;
      if (start + text.length > UINT32_MAX) {
        throw new Error("Inserted content exceeds packed UTF-16 offset range");
      }
      this.types[tailIndex] = INSERT_OPERATION;
      this.writeUnsigned("indexes", tailIndex, index);
      this.writeUnsigned("lengths", tailIndex, text.length);
      this.insertStarts[tailIndex] = start;
      this.writeTimestamp(tailIndex, timestamp);
      this.text.append(text);
      return;
    }
    if (
      typeof timestamp === "number" &&
      typeof index === "number" &&
      type === OPERATION_TYPE.DELETE &&
      typeof candidate.length === "number"
    ) {
      this.types[tailIndex] = DELETE_OPERATION;
      this.writeUnsigned("indexes", tailIndex, index);
      this.writeUnsigned("lengths", tailIndex, candidate.length);
      this.insertStarts[tailIndex] = 0;
      this.writeTimestamp(tailIndex, timestamp);
      return;
    }
    // Keep a malformed event verbatim. Its columns read as an empty delete
    // that no validated replay can reach.
    (this.irregular ??= new Map()).set(tailIndex, {
      operation: { ...operation },
      timestamp,
    });
    this.types[tailIndex] =
      type === OPERATION_TYPE.INSERT ? INSERT_OPERATION : DELETE_OPERATION;
    this.writeUnsigned("indexes", tailIndex, Number.NaN);
    this.writeUnsigned("lengths", tailIndex, Number.NaN);
    this.insertStarts[tailIndex] = this.text.length;
    this.writeTimestamp(tailIndex, Number.NaN);
  }

  private writeUnsigned(
    column: "indexes" | "lengths",
    tailIndex: number,
    value: number,
  ): void {
    let target = this[column];
    if (target instanceof Uint32Array && !fitsUint32(value)) {
      target = grow(target, new Float64Array(this.capacity));
      this[column] = target;
    }
    target[tailIndex] = value;
  }

  private writeTimestamp(tailIndex: number, timestamp: number): void {
    let target = this.timestamps;
    if (target instanceof Int32Array && !fitsInt32(timestamp)) {
      target = grow(target, new Float64Array(this.capacity));
      this.timestamps = target;
    }
    target[tailIndex] = timestamp;
  }
}

/**
 * Append-only text whose older parts are sealed into flat strings.
 *
 * Appending one character at a time to a single string would build a deep
 * rope that V8 flattens on every read. Parts are joined into a chunk once
 * they reach {@link TEXT_CHUNK_LENGTH} code units or when a read needs them.
 */
class ChunkedTextStore {
  private readonly chunks: string[] = [];
  /** Content offset at which each chunk starts. */
  private readonly chunkStarts: number[] = [];
  private pending: string[] = [];
  private pendingLength = 0;
  private sealedLength = 0;

  get length(): number {
    return this.sealedLength + this.pendingLength;
  }

  append(text: string): void {
    if (text.length === 0) {
      return;
    }
    this.pending.push(text);
    this.pendingLength += text.length;
    if (this.pendingLength >= TEXT_CHUNK_LENGTH) {
      this.seal();
    }
  }

  slice(start: number, end: number): string {
    if (start < 0 || end < start || end > this.length) {
      throw new RangeError(
        `Invalid inserted-content slice [${start}, ${end}) of ${this.length}`,
      );
    }
    if (start === end) {
      return "";
    }
    if (end > this.sealedLength) {
      this.seal();
    }
    let chunkIndex = this.chunkIndexAt(start);
    const first = this.chunks[chunkIndex]!;
    const firstStart = this.chunkStarts[chunkIndex]!;
    if (end <= firstStart + first.length) {
      return first.slice(start - firstStart, end - firstStart);
    }
    const parts = [first.slice(start - firstStart)];
    let cursor = firstStart + first.length;
    while (cursor < end) {
      chunkIndex++;
      const chunk = this.chunks[chunkIndex]!;
      parts.push(chunk.slice(0, Math.min(chunk.length, end - cursor)));
      cursor += chunk.length;
    }
    return parts.join("");
  }

  truncate(length: number): void {
    if (length < 0 || length > this.length) {
      throw new RangeError(`Cannot truncate inserted content to ${length}`);
    }
    this.seal();
    while (this.chunks.length > 0) {
      const last = this.chunks.length - 1;
      const start = this.chunkStarts[last]!;
      if (start < length) {
        this.chunks[last] = this.chunks[last]!.slice(0, length - start);
        break;
      }
      this.chunks.pop();
      this.chunkStarts.pop();
    }
    this.sealedLength = length;
  }

  toString(): string {
    this.seal();
    return this.chunks.length === 1 ? this.chunks[0]! : this.chunks.join("");
  }

  private seal(): void {
    if (this.pendingLength === 0) {
      return;
    }
    const chunk =
      this.pending.length === 1 ? this.pending[0]! : this.pending.join("");
    this.chunks.push(chunk);
    this.chunkStarts.push(this.sealedLength);
    this.sealedLength += chunk.length;
    this.pending = [];
    this.pendingLength = 0;
  }

  private chunkIndexAt(offset: number): number {
    let low = 0;
    let high = this.chunks.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (this.chunkStarts[middle]! <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  }
}

/** Whether a typed column stores `value` exactly, including `-0`. */
const fitsUint32 = (value: number): boolean =>
  Number.isInteger(value) &&
  value >= 0 &&
  value <= UINT32_MAX &&
  !Object.is(value, -0);

const fitsInt32 = (value: number): boolean =>
  Number.isInteger(value) &&
  value >= INT32_MIN &&
  value <= INT32_MAX &&
  !Object.is(value, -0);

const encodeList = (start: number): number => {
  const encoded = -2 - start;
  if (encoded < INT32_MIN) {
    throw new Error("Tail event log adjacency exceeds its index range");
  }
  return encoded;
};

const decodeList = (descriptor: number): number => -2 - descriptor;

const checkedRank = (rank: number): number => {
  if (!Number.isSafeInteger(rank) || rank < 0 || rank > INT32_MAX) {
    throw new Error(`Event graph insertion rank ${rank} is out of range`);
  }
  return rank;
};

type Column = Uint8Array | Int32Array | Uint32Array | Float64Array;

const grow = <T extends Column>(source: Column, target: T): T => {
  target.set(source.subarray(0, Math.min(source.length, target.length)));
  return target;
};

const growUnsigned = (
  column: Uint32Array | Float64Array,
  capacity: number,
): Uint32Array | Float64Array =>
  column instanceof Uint32Array
    ? grow(column, new Uint32Array(capacity))
    : grow(column, new Float64Array(capacity));
