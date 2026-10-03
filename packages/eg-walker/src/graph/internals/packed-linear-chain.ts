import { OPERATION_TYPE } from "../../constants/operation-types";
import type {
  EventId,
  ExternalOperation,
  GraphEvent,
  Version,
} from "../../types";
import type { CausalBatchColumns } from "./causal-batch-columns";
import { CUSTOM_AGENT } from "./event-id-run-index";
import { AgentTable } from "./agent-table";
import { EventIdRunIndex } from "./event-id-run-index";
import { GraphRuns } from "./graph-runs";
import {
  PACKED_OPERATION_TYPE,
  PackedEventGraphBase,
  type PackedOperationColumns,
} from "./packed-event-graph-base";
import type {
  PackedIntegerColumn,
  PackedUnsignedIntegerColumn,
} from "./packed-numeric-columns";
import type { SealedOperationColumns } from "./sealed-operation-columns";

const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;
const UINT32_MAX = 0xffff_ffff;

/**
 * Events of one exact causal chain, read once from their source objects and
 * stored as columns.
 *
 * The first event's parents are {@link firstParents}. Every later event's
 * only parent is the event before it, so no parent set is stored per event.
 * Callers validate each field before appending it. {@link finish} joins the
 * inserted text once, so a replay splices a run of typed characters with one
 * string slice instead of one string per event.
 *
 * A batch lives for one apply call, so its columns are plain arrays: typed
 * arrays would allocate off-heap buffers, and V8 answers enough of those with
 * a full garbage collection.
 */
export class LinearEventBatch {
  /** @internal */ readonly types: number[] = [];
  /** @internal */ readonly indexes: number[] = [];
  /** @internal */ readonly lengths: number[] = [];
  /** @internal */ readonly timestamps: number[] = [];
  /** @internal Offset of each insert's text in the joined content. */
  readonly insertStarts: number[] = [];
  private readonly ids: EventId[] = [];
  private readonly texts: string[] = [];
  private content: string | null = null;
  private insertedLength = 0;
  /** @internal */ maximumIndex = 0;
  /** @internal */ maximumLength = 0;
  /** @internal */ minimumTimestamp = 0;
  /** @internal */ maximumTimestamp = 0;
  private safeIntegerTimestamps = true;

  constructor(readonly firstParents: Version) {}

  get count(): number {
    return this.ids.length;
  }

  /** ID of the chain's last event, which becomes the graph frontier. */
  get lastId(): EventId {
    const id = this.ids[this.ids.length - 1];
    if (id === undefined) {
      throw new Error("An empty linear batch has no last event");
    }
    return id;
  }

  /** Total UTF-16 length of the inserted text. */
  get contentLength(): number {
    return this.insertedLength;
  }

  /** Whether every timestamp fits a packed integer column. */
  get hasSafeIntegerTimestamps(): boolean {
    return this.safeIntegerTimestamps;
  }

  appendInsert(
    id: EventId,
    index: number,
    text: string,
    timestamp: number,
  ): void {
    this.appendEvent(id, index, text.length, timestamp);
    this.types.push(PACKED_OPERATION_TYPE.INSERT);
    this.insertStarts.push(this.insertedLength);
    this.insertedLength += text.length;
    this.texts.push(text);
  }

  appendDelete(
    id: EventId,
    index: number,
    length: number,
    timestamp: number,
  ): void {
    this.appendEvent(id, index, length, timestamp);
    this.types.push(PACKED_OPERATION_TYPE.DELETE);
    this.insertStarts.push(0);
    this.texts.push("");
  }

  /** Join the inserted text. No event can be appended afterwards. */
  finish(): this {
    this.content = this.texts.join("");
    return this;
  }

  idAt(offset: number): EventId | undefined {
    return this.ids[offset];
  }

  isInsertAt(offset: number): boolean {
    return this.types[offset] === PACKED_OPERATION_TYPE.INSERT;
  }

  operationIndexAt(offset: number): number {
    return this.indexes[offset]!;
  }

  operationLengthAt(offset: number): number {
    return this.lengths[offset]!;
  }

  insertStartAt(offset: number): number {
    return this.insertStarts[offset]!;
  }

  timestampAt(offset: number): number {
    return this.timestamps[offset]!;
  }

  sliceInsertedContent(start: number, end: number): string {
    if (this.content === null) {
      throw new Error("Linear batch content is read before finish()");
    }
    return this.content.slice(start, end);
  }

  /** The joined inserted text; available after {@link finish}. */
  get insertedContent(): string {
    if (this.content === null) {
      throw new Error("Linear batch content is read before finish()");
    }
    return this.content;
  }

  operationAt(offset: number): ExternalOperation {
    const index = this.indexes[offset]!;
    return this.types[offset] === PACKED_OPERATION_TYPE.INSERT
      ? { type: OPERATION_TYPE.INSERT, index, text: this.texts[offset]! }
      : { type: OPERATION_TYPE.DELETE, index, length: this.lengths[offset]! };
  }

  private appendEvent(
    id: EventId,
    index: number,
    length: number,
    timestamp: number,
  ): void {
    if (this.content !== null) {
      throw new Error("Cannot append to a finished linear batch");
    }
    if (this.ids.length === 0) {
      this.minimumTimestamp = timestamp;
      this.maximumTimestamp = timestamp;
    } else {
      this.minimumTimestamp = Math.min(this.minimumTimestamp, timestamp);
      this.maximumTimestamp = Math.max(this.maximumTimestamp, timestamp);
    }
    this.ids.push(id);
    this.indexes.push(index);
    this.lengths.push(length);
    this.timestamps.push(timestamp);
    this.maximumIndex = Math.max(this.maximumIndex, index);
    this.maximumLength = Math.max(this.maximumLength, length);
    this.safeIntegerTimestamps &&= Number.isSafeInteger(timestamp);
  }
}

/** Largest value each column must hold. */
interface ColumnBounds {
  readonly maximumIndex: number;
  readonly maximumLength: number;
  readonly minimumTimestamp: number;
  readonly maximumTimestamp: number;
}

/**
 * Typed operation columns with spare capacity. A column widens, copying its
 * stored values, only when an incoming value does not fit it.
 */
class OperationColumnStore {
  operationTypes: Uint8Array = new Uint8Array(0);
  operationIndexes: PackedUnsignedIntegerColumn = new Uint32Array(0);
  operationLengths: PackedUnsignedIntegerColumn = new Uint32Array(0);
  timestamps: PackedIntegerColumn = new Int32Array(0);
  insertStarts: Uint32Array = new Uint32Array(0);
  count = 0;
  maximumIndex = 0;
  maximumLength = 0;
  minimumTimestamp = 0;
  maximumTimestamp = 0;

  /** @param start Chain offset of the first stored event. */
  constructor(
    readonly start: number,
    capacity: number,
  ) {
    this.reserve(capacity, EMPTY_BOUNDS);
  }

  /** Adopt sealed column views; later growth allocates new storage. */
  static adopt(columns: PackedOperationColumns): OperationColumnStore {
    const store = new OperationColumnStore(0, 0);
    store.operationTypes = columns.operationTypes;
    store.operationIndexes = columns.operationIndexes;
    store.operationLengths = columns.operationLengths;
    store.timestamps = columns.timestamps;
    store.insertStarts = columns.insertStarts;
    store.count = columns.operationTypes.length;
    // Conservative bounds avoid scanning the adopted columns. Their existing
    // representations already preserve every value, including fractions.
    store.maximumIndex =
      columns.operationIndexes instanceof Uint32Array
        ? UINT32_MAX
        : Number.MAX_SAFE_INTEGER;
    store.maximumLength =
      columns.operationLengths instanceof Uint32Array
        ? UINT32_MAX
        : Number.MAX_SAFE_INTEGER;
    store.minimumTimestamp =
      columns.timestamps instanceof Int32Array ? INT32_MIN : -Number.MAX_VALUE;
    store.maximumTimestamp =
      columns.timestamps instanceof Int32Array ? INT32_MAX : Number.MAX_VALUE;
    return store;
  }

  get capacity(): number {
    return this.operationTypes.length;
  }

  get bounds(): ColumnBounds {
    return this;
  }

  /** Room for `capacity` events whose values stay within `bounds`. */
  reserve(capacity: number, bounds: ColumnBounds): void {
    const empty = this.count === 0;
    const minimumTimestamp = empty
      ? bounds.minimumTimestamp
      : Math.min(this.minimumTimestamp, bounds.minimumTimestamp);
    const maximumTimestamp = empty
      ? bounds.maximumTimestamp
      : Math.max(this.maximumTimestamp, bounds.maximumTimestamp);
    const indexes = unsignedColumnFor(
      this.operationIndexes,
      bounds.maximumIndex,
    );
    const lengths = unsignedColumnFor(
      this.operationLengths,
      bounds.maximumLength,
    );
    const timestamps = integerColumnFor(
      this.timestamps,
      minimumTimestamp,
      maximumTimestamp,
    );
    if (
      capacity <= this.capacity &&
      indexes === null &&
      lengths === null &&
      timestamps === null
    ) {
      return;
    }
    const nextCapacity = Math.max(capacity, this.capacity);
    const count = this.count;
    this.operationTypes = copyColumn(
      this.operationTypes,
      new Uint8Array(nextCapacity),
      count,
    );
    this.operationIndexes = copyColumn(
      this.operationIndexes,
      new (indexes ?? unsignedConstructorOf(this.operationIndexes))(
        nextCapacity,
      ),
      count,
    );
    this.operationLengths = copyColumn(
      this.operationLengths,
      new (lengths ?? unsignedConstructorOf(this.operationLengths))(
        nextCapacity,
      ),
      count,
    );
    this.timestamps = copyColumn(
      this.timestamps,
      new (timestamps ?? constructorOf(this.timestamps))(nextCapacity),
      count,
    );
    this.insertStarts = copyColumn(
      this.insertStarts,
      new Uint32Array(nextCapacity),
      count,
    );
  }

  /** Append events `[from, from + length)` of a batch. */
  appendBatch(
    batch: LinearEventBatch,
    from: number,
    length: number,
    contentStart: number,
  ): void {
    this.reserve(this.count + length, batch);
    const at = this.count;
    for (let offset = 0; offset < length; offset++) {
      const source = from + offset;
      const target = at + offset;
      const insert = batch.isInsertAt(source);
      this.operationTypes[target] = batch.types[source]!;
      this.operationIndexes[target] = batch.indexes[source]!;
      this.operationLengths[target] = batch.lengths[source]!;
      this.timestamps[target] = batch.timestamps[source]!;
      this.insertStarts[target] = insert
        ? contentStart + batch.insertStarts[source]!
        : 0;
    }
    this.count = at + length;
    this.include(batch);
  }

  /**
   * Append one event. The store must have room. A column widens, copying its
   * stored values, only when the value does not fit it.
   */
  push(
    type: number,
    index: number,
    length: number,
    timestamp: number,
    insertStart: number,
  ): void {
    if (index > this.maximumIndex) this.maximumIndex = index;
    if (length > this.maximumLength) this.maximumLength = length;
    if (timestamp < this.minimumTimestamp) {
      this.minimumTimestamp = timestamp;
    } else if (timestamp > this.maximumTimestamp) {
      this.maximumTimestamp = timestamp;
    }
    const at = this.count;
    this.operationIndexes[at] = index;
    this.operationLengths[at] = length;
    this.timestamps[at] = timestamp;
    // A typed array wraps a value it cannot hold, so reading it back finds
    // an overflow without checking each column's type.
    if (
      this.operationIndexes[at] !== index ||
      this.operationLengths[at] !== length ||
      this.timestamps[at] !== timestamp
    ) {
      if (this.timestamps[at] !== timestamp && !Number.isInteger(timestamp)) {
        this.timestamps = new Float64Array(this.timestamps);
      }
      this.reserve(this.capacity, this);
      this.operationIndexes[at] = index;
      this.operationLengths[at] = length;
      this.timestamps[at] = timestamp;
    }
    this.operationTypes[at] = type;
    this.insertStarts[at] = insertStart;
    this.count = at + 1;
  }

  /** Append every event another store holds. */
  appendStore(other: OperationColumnStore): void {
    if (
      other.timestamps instanceof Float64Array &&
      !(this.timestamps instanceof Float64Array)
    ) {
      this.timestamps = new Float64Array(this.timestamps);
    }
    this.reserve(this.count + other.count, other);
    const at = this.count;
    const count = other.count;
    this.operationTypes.set(other.operationTypes.subarray(0, count), at);
    this.operationIndexes.set(other.operationIndexes.subarray(0, count), at);
    this.operationLengths.set(other.operationLengths.subarray(0, count), at);
    this.timestamps.set(other.timestamps.subarray(0, count), at);
    this.insertStarts.set(other.insertStarts.subarray(0, count), at);
    this.count = at + count;
    this.include(other);
  }

  views(count: number): PackedOperationColumns {
    return {
      operationTypes: this.operationTypes.subarray(0, count),
      operationIndexes: this.operationIndexes.subarray(0, count),
      operationLengths: this.operationLengths.subarray(0, count),
      timestamps: this.timestamps.subarray(0, count),
      insertStarts: this.insertStarts.subarray(0, count),
    };
  }

  private include(bounds: ColumnBounds): void {
    const first = this.count === 0;
    this.maximumIndex = Math.max(this.maximumIndex, bounds.maximumIndex);
    this.maximumLength = Math.max(this.maximumLength, bounds.maximumLength);
    this.minimumTimestamp = first
      ? bounds.minimumTimestamp
      : Math.min(this.minimumTimestamp, bounds.minimumTimestamp);
    this.maximumTimestamp = first
      ? bounds.maximumTimestamp
      : Math.max(this.maximumTimestamp, bounds.maximumTimestamp);
  }
}

const EMPTY_BOUNDS: ColumnBounds = {
  maximumIndex: 0,
  maximumLength: 0,
  minimumTimestamp: 0,
  maximumTimestamp: 0,
};

/** State to restore when an append transaction rolls back. */
export interface PackedLinearChainMark {
  readonly count: number;
  readonly insertedContent: string;
  readonly base: PackedEventGraphBase | null;
}

/**
 * Growable packed storage for a graph that is one exact causal chain.
 *
 * {@link append} adds a batch after the chain and returns a new
 * {@link PackedEventGraphBase} over the longer chain; {@link appendEvents}
 * does the same for event objects. Appending copies each event's operation
 * into a chunk once and never moves stored events, so ingesting a long
 * history allocates off-heap memory once per event. V8 starts a full garbage
 * collection for every 64 MB of new off-heap memory, which growing one
 * contiguous column by doubling would allocate twice over.
 *
 * Bases read operation columns only when a replay or export needs them. The
 * first such read copies the chunks into contiguous columns, which grow by
 * doubling and take later appends directly while they have room. Every base
 * shares these buffers but never reads past its own count, so an earlier base
 * stays valid until {@link rollbackTo} cuts the chain below it.
 */
export class PackedLinearChain {
  /** Contiguous columns for the chain's first `contiguous.count` events. */
  private contiguous = new OperationColumnStore(0, 0);
  private sealedBase: PackedEventGraphBase | null = null;
  /** Events after the contiguous prefix, in order. */
  private chunks: OperationColumnStore[] = [];
  private insertedContent = "";
  private ids: EventIdRunIndex;
  private eventCount = 0;
  private base: PackedEventGraphBase | null = null;

  /** @param agents Replica numbering shared with the graph the chain backs. */
  constructor(agents: AgentTable = new AgentTable()) {
    this.ids = new EventIdRunIndex(agents);
  }

  /** Start a growable chain by adopting a sealed causal batch without copies. */
  static adopt(
    batch: CausalBatchColumns,
    base: PackedEventGraphBase,
  ): PackedLinearChain {
    const chain = new PackedLinearChain(batch.ids.agents);
    chain.ids = batch.ids;
    chain.contiguous = OperationColumnStore.adopt(batch.operationColumns());
    chain.insertedContent = batch.insertedContent;
    chain.eventCount = batch.count;
    chain.base = base;
    return chain;
  }

  /** Append parsed causal columns to this chain, with transactional rollback. */
  appendCausalColumns(batch: CausalBatchColumns): PackedEventGraphBase {
    const mark = this.mark();
    const start = this.eventCount;
    const contentStart = this.insertedContent.length;
    if (contentStart + batch.insertedContent.length > UINT32_MAX) {
      throw new Error("Inserted content exceeds packed UTF-16 offset range");
    }
    const agents = Array.from({ length: batch.ids.agents.size }, (_, agent) =>
      this.ids.agents.intern(batch.ids.agents.nameOf(agent)),
    );
    try {
      for (let offset = 0; offset < batch.count; offset++) {
        const sourceAgent = batch.ids.agentAt(offset);
        if (sourceAgent === CUSTOM_AGENT) this.ids.append(batch.idAt(offset)!);
        else
          this.ids.appendCanonical(
            agents[sourceAgent]!,
            batch.ids.sequenceAt(offset),
          );
        const store = this.writableChunk(start + offset);
        const insert = batch.isInsertAt(offset);
        store.push(
          insert ? PACKED_OPERATION_TYPE.INSERT : PACKED_OPERATION_TYPE.DELETE,
          batch.operationIndexAt(offset),
          batch.operationLengthAt(offset),
          batch.timestampAt(offset),
          insert ? contentStart + batch.insertStartAt(offset) : 0,
        );
      }
      this.insertedContent += batch.insertedContent;
      return this.publish(start + batch.count);
    } catch (error) {
      this.rollbackTo(mark);
      throw error;
    }
  }

  /** Release the dense owner along with the latest base's dense views. */
  compactOperations(sealed?: SealedOperationColumns): void {
    if (this.base === null) return;
    this.base.compactOperations(sealed);
    this.sealedBase = this.base;
    this.contiguous = new OperationColumnStore(0, 0);
    this.chunks = [];
  }

  get count(): number {
    return this.eventCount;
  }

  /** The base returned by the latest append, or `null` before the first. */
  get latest(): PackedEventGraphBase | null {
    return this.base;
  }

  mark(): PackedLinearChainMark {
    return {
      count: this.eventCount,
      insertedContent: this.insertedContent,
      base: this.base,
    };
  }

  rollbackTo(mark: PackedLinearChainMark): void {
    const count = mark.count;
    this.ids.truncate(count);
    while (this.chunks.length > 0) {
      const chunk = this.chunks[this.chunks.length - 1]!;
      if (chunk.start < count) {
        chunk.count = Math.min(chunk.count, count - chunk.start);
        break;
      }
      this.chunks.pop();
    }
    this.contiguous.count = Math.min(this.contiguous.count, count);
    this.eventCount = count;
    this.insertedContent = mark.insertedContent;
    this.base = mark.base;
  }

  /**
   * Append a finished batch whose first event extends the chain's last one.
   *
   * @throws EventAlreadyExistsError when an ID is already in the chain; the
   * chain is left unchanged.
   */
  append(batch: LinearEventBatch): PackedEventGraphBase {
    if (!batch.hasSafeIntegerTimestamps) {
      throw new Error("Packed linear chains require safe-integer timestamps");
    }
    const start = this.eventCount;
    const count = batch.count;
    const end = start + count;
    const contentStart = this.insertedContent.length;
    if (contentStart + batch.contentLength > UINT32_MAX) {
      throw new Error("Inserted content exceeds packed UTF-16 offset range");
    }
    try {
      for (let offset = 0; offset < count; offset++) {
        this.ids.append(batch.idAt(offset)!);
      }
    } catch (error) {
      this.ids.truncate(start);
      throw error;
    }

    this.appendOperations(batch, contentStart);
    if (batch.contentLength > 0) {
      this.insertedContent += batch.insertedContent;
    }
    return this.publish(end);
  }

  /**
   * Append event objects of an exact chain whose first event extends the
   * chain's last one.
   *
   * Unlike {@link append}, the events are not first copied into a
   * {@link LinearEventBatch}, whose arrays grow by one entry per event per
   * column. Each event is read once: its ID goes into the run index and its
   * operation into the typed columns. Callers validate each event's fields,
   * as for a batch.
   *
   * @returns the appended events, read back from the chain's columns, or
   * `null` with the chain unchanged when a timestamp is not a safe integer.
   * @throws EventAlreadyExistsError when an ID is already in the chain; the
   * chain is left unchanged.
   */
  appendEvents(
    events: ReadonlyArray<GraphEvent>,
  ): PackedLinearChainRange | null {
    const mark = this.mark();
    const start = this.eventCount;
    const count = events.length;
    const contentStart = this.insertedContent.length;
    const texts: string[] = [];
    let insertStart = contentStart;
    const contiguous = this.contiguous;
    let store =
      this.chunks.length === 0 &&
      contiguous.count + count <= contiguous.capacity
        ? contiguous
        : null;
    const stores = store === null ? [] : [store];
    try {
      for (let offset = 0; offset < count; offset++) {
        const event = events[offset]!;
        const timestamp = event.timestamp;
        if (!Number.isSafeInteger(timestamp)) {
          this.rollbackTo(mark);
          return null;
        }
        this.ids.append(event.id);
        if (store === null || store.count === store.capacity) {
          store = this.writableChunk(start + offset);
          stores.push(store);
        }
        const operation = event.operation;
        if (operation.type === OPERATION_TYPE.INSERT) {
          const text = operation.text;
          if (insertStart + text.length > UINT32_MAX) {
            throw new Error(
              "Inserted content exceeds packed UTF-16 offset range",
            );
          }
          store.push(
            PACKED_OPERATION_TYPE.INSERT,
            operation.index,
            text.length,
            timestamp,
            insertStart,
          );
          texts.push(text);
          insertStart += text.length;
        } else {
          store.push(
            PACKED_OPERATION_TYPE.DELETE,
            operation.index,
            operation.length,
            timestamp,
            0,
          );
        }
      }
    } catch (error) {
      this.rollbackTo(mark);
      throw error;
    }

    const content = texts.join("");
    if (content.length > 0) {
      this.insertedContent += content;
    }
    this.publish(start + count);
    return new PackedLinearChainRange(
      this.ids,
      stores,
      start,
      count,
      contentStart,
      content,
    );
  }

  /** Make the first `end` events the latest base. */
  private publish(end: number): PackedEventGraphBase {
    this.eventCount = end;
    this.base = PackedEventGraphBase.create({
      idIndex: this.ids.view(),
      insertedContent: this.insertedContent,
      loadOperationColumns: () => this.operationColumns(end),
      runs: GraphRuns.linear(end),
    });
    return this.base;
  }

  private appendOperations(
    batch: LinearEventBatch,
    contentStart: number,
  ): void {
    const contiguous = this.contiguous;
    if (
      this.chunks.length === 0 &&
      contiguous.count + batch.count <= contiguous.capacity
    ) {
      contiguous.appendBatch(batch, 0, batch.count, contentStart);
      return;
    }
    let written = 0;
    while (written < batch.count) {
      const chunk = this.writableChunk(this.eventCount + written);
      const length = Math.min(
        batch.count - written,
        chunk.capacity - chunk.count,
      );
      chunk.appendBatch(batch, written, length, contentStart);
      written += length;
    }
  }

  /** The last chunk while it has room, else a new chunk from `start`. */
  private writableChunk(start: number): OperationColumnStore {
    const last = this.chunks[this.chunks.length - 1];
    if (last !== undefined && last.count < last.capacity) {
      return last;
    }
    const chunk = new OperationColumnStore(
      start,
      Math.min(
        MAX_CHUNK_CAPACITY,
        Math.max(MIN_CHUNK_CAPACITY, (last?.capacity ?? 0) * 2),
      ),
    );
    this.chunks.push(chunk);
    return chunk;
  }

  /** Operation columns of the first `count` events, made contiguous. */
  private operationColumns(count: number): PackedOperationColumns {
    if (count > this.eventCount) {
      throw new Error("Packed linear chain was rolled back below this base");
    }
    if (this.sealedBase !== null) {
      this.contiguous = OperationColumnStore.adopt(
        this.sealedBase.materializeOperations(),
      );
      this.sealedBase = null;
    }
    const contiguous = this.contiguous;
    if (contiguous.count < count) {
      contiguous.reserve(
        Math.max(this.eventCount, contiguous.capacity * 2),
        contiguous,
      );
      for (const chunk of this.chunks) {
        contiguous.appendStore(chunk);
      }
      this.chunks = [];
    }
    return contiguous.views(count);
  }
}

/**
 * Events one {@link PackedLinearChain.appendEvents} call appended, read back
 * from the chain's columns at offsets `0..count`.
 *
 * A replay reads the events in order, so the store that held the previous
 * offset is checked first. Valid only until the chain changes again.
 */
export class PackedLinearChainRange {
  private storeIndex = 0;

  /** @internal Built by {@link PackedLinearChain.appendEvents}. */
  constructor(
    private readonly ids: EventIdRunIndex,
    private readonly stores: ReadonlyArray<OperationColumnStore>,
    private readonly start: number,
    readonly count: number,
    private readonly contentStart: number,
    private readonly content: string,
  ) {}

  /** ID of the range's last event. */
  get lastId(): EventId {
    const id = this.idAt(this.count - 1);
    if (id === undefined) {
      throw new Error("An empty linear range has no last event");
    }
    return id;
  }

  idAt(offset: number): EventId | undefined {
    return offset < 0
      ? undefined
      : this.ids.idAt(this.start + offset, this.start + this.count);
  }

  isInsertAt(offset: number): boolean {
    const at = this.start + offset;
    const store = this.storeAt(at);
    return (
      store.operationTypes[at - store.start] === PACKED_OPERATION_TYPE.INSERT
    );
  }

  operationIndexAt(offset: number): number {
    const at = this.start + offset;
    const store = this.storeAt(at);
    return store.operationIndexes[at - store.start]!;
  }

  operationLengthAt(offset: number): number {
    const at = this.start + offset;
    const store = this.storeAt(at);
    return store.operationLengths[at - store.start]!;
  }

  /** Offset of an insert's text in {@link sliceInsertedContent}. */
  insertStartAt(offset: number): number {
    const at = this.start + offset;
    const store = this.storeAt(at);
    return store.insertStarts[at - store.start]! - this.contentStart;
  }

  sliceInsertedContent(start: number, end: number): string {
    return this.content.slice(start, end);
  }

  operationAt(offset: number): ExternalOperation {
    const index = this.operationIndexAt(offset);
    const length = this.operationLengthAt(offset);
    if (this.isInsertAt(offset)) {
      const start = this.insertStartAt(offset);
      return {
        type: OPERATION_TYPE.INSERT,
        index,
        text: this.content.slice(start, start + length),
      };
    }
    return { type: OPERATION_TYPE.DELETE, index, length };
  }

  /** The store holding chain offset `at`, which must be in this range. */
  private storeAt(at: number): OperationColumnStore {
    const stores = this.stores;
    const current = stores[this.storeIndex];
    if (
      current !== undefined &&
      at >= current.start &&
      at < current.start + current.count
    ) {
      return current;
    }
    for (let index = 0; index < stores.length; index++) {
      const store = stores[index]!;
      if (at >= store.start && at < store.start + store.count) {
        this.storeIndex = index;
        return store;
      }
    }
    throw new Error(`Linear range has no event at chain offset ${at}`);
  }
}

const MIN_CHUNK_CAPACITY = 1_024;
const MAX_CHUNK_CAPACITY = 65_536;

type NumericColumn = Uint8Array | Int32Array | Uint32Array | Float64Array;

/** A wider constructor for `column` when `maximum` does not fit it. */
const unsignedColumnFor = (
  column: PackedUnsignedIntegerColumn,
  maximum: number,
): Float64ArrayConstructor | null =>
  column instanceof Uint32Array && maximum > UINT32_MAX ? Float64Array : null;

/**
 * A wider constructor for `column` when `[minimum, maximum]`, the range of
 * every value it will hold, does not fit it.
 */
const integerColumnFor = (
  column: PackedIntegerColumn,
  minimum: number,
  maximum: number,
): Uint32ArrayConstructor | Float64ArrayConstructor | null => {
  if (column instanceof Float64Array) {
    return null;
  }
  if (
    column instanceof Int32Array &&
    minimum >= INT32_MIN &&
    maximum <= INT32_MAX
  ) {
    return null;
  }
  if (minimum >= 0 && maximum <= UINT32_MAX) {
    return column instanceof Uint32Array ? null : Uint32Array;
  }
  return Float64Array;
};

const unsignedConstructorOf = (
  column: PackedUnsignedIntegerColumn,
): Uint32ArrayConstructor | Float64ArrayConstructor =>
  column instanceof Uint32Array ? Uint32Array : Float64Array;

const constructorOf = (
  column: Int32Array | Uint32Array | Float64Array,
): Int32ArrayConstructor | Uint32ArrayConstructor | Float64ArrayConstructor =>
  column instanceof Int32Array
    ? Int32Array
    : column instanceof Uint32Array
      ? Uint32Array
      : Float64Array;

const copyColumn = <T extends NumericColumn>(
  source: NumericColumn,
  target: T,
  count: number,
): T => {
  target.set(source.subarray(0, count));
  return target;
};
