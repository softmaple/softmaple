import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation, Version } from "../../types";
import { GrowableIdRunIndex } from "./growable-id-run-index";
import {
  PACKED_OPERATION_TYPE,
  PackedEventGraphBase,
  type PackedOperationColumns,
} from "./packed-event-graph-base";
import type {
  PackedIntegerColumn,
  PackedUnsignedIntegerColumn,
} from "./packed-numeric-columns";

const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;
const UINT32_MAX = 0xffff_ffff;
const NO_EDGES = new Uint32Array(0);

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
  operationTypes = new Uint8Array(0);
  operationIndexes: PackedUnsignedIntegerColumn = new Uint32Array(0);
  operationLengths: PackedUnsignedIntegerColumn = new Uint32Array(0);
  timestamps: PackedIntegerColumn = new Int32Array(0);
  insertStarts = new Uint32Array(0);
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

  /** Append every event another store holds. */
  appendStore(other: OperationColumnStore): void {
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
 * {@link PackedEventGraphBase} over the longer chain. Appending copies each
 * event's operation into a chunk once and never moves stored events, so
 * ingesting a long history allocates off-heap memory once per event. V8
 * starts a full garbage collection for every 64 MB of new off-heap memory,
 * which growing one contiguous column by doubling would allocate twice over.
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
  /** Events after the contiguous prefix, in order. */
  private chunks: OperationColumnStore[] = [];
  private insertedContent = "";
  private readonly ids = new GrowableIdRunIndex();
  private eventCount = 0;
  private base: PackedEventGraphBase | null = null;

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
    this.eventCount = end;
    this.base = PackedEventGraphBase.create({
      idIndex: this.ids.view(),
      insertedContent: this.insertedContent,
      loadOperationColumns: () => this.operationColumns(end),
      parentStarts: NO_EDGES,
      parentOffsets: NO_EDGES,
      childStarts: NO_EDGES,
      childOffsets: NO_EDGES,
      implicitLinearEdges: true,
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
      let chunk = this.chunks[this.chunks.length - 1];
      if (chunk === undefined || chunk.count === chunk.capacity) {
        chunk = new OperationColumnStore(
          this.eventCount + written,
          Math.min(
            MAX_CHUNK_CAPACITY,
            Math.max(MIN_CHUNK_CAPACITY, (chunk?.capacity ?? 0) * 2),
          ),
        );
        this.chunks.push(chunk);
      }
      const length = Math.min(
        batch.count - written,
        chunk.capacity - chunk.count,
      );
      chunk.appendBatch(batch, written, length, contentStart);
      written += length;
    }
  }

  /** Operation columns of the first `count` events, made contiguous. */
  private operationColumns(count: number): PackedOperationColumns {
    if (count > this.eventCount) {
      throw new Error("Packed linear chain was rolled back below this base");
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
