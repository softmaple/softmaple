import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "./event-graph";
import { parseEventId } from "./event-id";
import lz4 from "lz4js";
import type {
  EventId,
  ExternalOperation,
  GraphEvent,
  SerializedGraphOutput,
} from "../types";

export interface OperationRun {
  readonly type: ExternalOperation["type"];
  readonly startIndex: number;
  readonly startEventOffset: number;
  readonly length: number;
  readonly textLength?: number;
}

export interface IdRun {
  readonly replicaId: string;
  readonly startSequence: number;
  readonly startEventOffset: number;
  readonly length: number;
  readonly custom?: boolean;
}

export interface ParentOverride {
  readonly eventOffset: number;
  readonly parents: ReadonlyArray<EventId>;
}

export interface ColumnarEventGraph {
  readonly version: ReadonlyArray<EventId>;
  readonly operationRuns: ReadonlyArray<OperationRun>;
  readonly operationIndexes: ReadonlyArray<number>;
  readonly operationLengths: ReadonlyArray<number>;
  readonly textLengths: ReadonlyArray<number>;
  readonly insertedContent: string;
  readonly parentOverrides: ReadonlyArray<ParentOverride>;
  readonly idRuns: ReadonlyArray<IdRun>;
  readonly timestamps: ReadonlyArray<number>;
  readonly metadata?: Record<string, unknown>;
}

// EGW3: incompatible with the EGW2 columnar layout. Compared to EGW2 the wire
// format drops every column that is derivable from the others and switches the
// two near-monotonic per-event columns to zigzag-delta varints:
//
//   - operationRuns: `(type, length)` only — `startEventOffset` is the prefix
//     sum of run lengths, `startIndex` is `operationIndexes[startEventOffset]`,
//     and a run's `textLength` is the sum of `operationLengths` over the run
//     (for INSERT runs; undefined for DELETE).
//   - operationIndexes: zigzag-delta varint per event (linear single-author
//     traces collapse to ~1 byte per event regardless of document size).
//   - textLengths: dropped entirely — `textLength[i]` equals
//     `operationLengths[i]` when the covering run is INSERT, else `0`.
//   - parentOverrides: monotonic-delta varint on `eventOffset`.
//   - idRuns: drops `startEventOffset` (also the prefix sum of run lengths).
//   - timestamps: zigzag-delta varint per event.
//
// The in-memory `ColumnarEventGraph` / `OperationRun` / `IdRun` shapes are
// unchanged; only the binary wire format is more compact. EGW2 and EGW1
// payloads are rejected at decode.
const BINARY_MAGIC = new Uint8Array([0x45, 0x47, 0x57, 0x33]); // EGW3
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toUint8Array = (bytes: ReadonlyArray<number> | Uint8Array): Uint8Array =>
  bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

const operationTextLength = (operation: ExternalOperation): number =>
  operation.type === OPERATION_TYPE.INSERT ? operation.text.length : 0;

const operationLength = (operation: ExternalOperation): number =>
  operation.type === OPERATION_TYPE.INSERT
    ? operation.text.length
    : operation.length;

/**
 * Partial operation run as read from the binary wire: only `type`,
 * `startEventOffset` (the prefix sum of run lengths), and `length` are
 * available. `startIndex` and `textLength` are filled in by
 * {@link finalizeOperationRuns} once `operationIndexes` and
 * `operationLengths` have been read.
 */
type PartialOperationRun = Omit<OperationRun, "startIndex" | "textLength">;

/**
 * Reconstruct the per-event `textLengths` column from `operationRuns` (which
 * carry the per-run type) and `operationLengths` (which equal text length for
 * INSERTs and delete length for DELETEs). EGW3 omits `textLengths` from the
 * binary wire because it's fully derivable from those two columns. Internal
 * helper invoked only from {@link ColumnarEventGraphCodec.decodeBinary},
 * where `operationLengths.length` is the total event count and every
 * `startEventOffset + offset` index is guaranteed to be in range.
 */
const reconstructTextLengths = (
  operationRuns: ReadonlyArray<OperationRun>,
  operationLengths: ReadonlyArray<number>,
): number[] => {
  const textLengths: number[] = new Array<number>(operationLengths.length).fill(
    0,
  );
  for (const run of operationRuns) {
    if (run.type !== OPERATION_TYPE.INSERT) {
      continue;
    }
    for (let offset = 0; offset < run.length; offset++) {
      textLengths[run.startEventOffset + offset] =
        operationLengths[run.startEventOffset + offset]!;
    }
  }
  return textLengths;
};

/**
 * Promote the partial runs from {@link ColumnarEventGraphCodec.readOperationRuns}
 * into full {@link OperationRun} values. `startIndex` is taken from
 * `operationIndexes` at the run's first event offset; `textLength` is the
 * sum of `operationLengths` over the run's events (for INSERT runs only).
 */
const finalizeOperationRuns = (
  runs: ReadonlyArray<PartialOperationRun>,
  operationIndexes: ReadonlyArray<number>,
  operationLengths: ReadonlyArray<number>,
): OperationRun[] =>
  runs.map((run) => {
    const startIndex = operationIndexes[run.startEventOffset]!;
    if (run.type !== OPERATION_TYPE.INSERT) {
      return { ...run, startIndex, textLength: undefined };
    }
    let textLength = 0;
    for (let offset = 0; offset < run.length; offset++) {
      textLength += operationLengths[run.startEventOffset + offset]!;
    }
    return { ...run, startIndex, textLength };
  });

/**
 * Zigzag encoding maps signed integers to non-negative integers:
 * `0 → 0, -1 → 1, 1 → 2, -2 → 3, 2 → 4, ...`. Uses safe-integer arithmetic
 * rather than bitwise ops so values beyond ±2^31 (timestamps in ms since epoch
 * are ~1.7×10^12) round-trip correctly.
 */
const zigzagEncode = (value: number): number =>
  value >= 0 ? value * 2 : value * -2 - 1;

const zigzagDecode = (value: number): number =>
  value % 2 === 0 ? value / 2 : -((value + 1) / 2);

export class ColumnarEventGraphCodec {
  encode(graph: EventGraph): ColumnarEventGraph {
    const events = graph.getTopologicalOrder();
    return {
      version: Array.from(graph.getFrontier()),
      operationRuns: this.encodeOperationRuns(events),
      operationIndexes: events.map((event) => event.operation.index),
      operationLengths: events.map((event) => operationLength(event.operation)),
      textLengths: events.map((event) => operationTextLength(event.operation)),
      insertedContent: events
        .map((event) =>
          event.operation.type === OPERATION_TYPE.INSERT
            ? event.operation.text
            : "",
        )
        .join(""),
      parentOverrides: this.encodeParentOverrides(events),
      idRuns: this.encodeIdRuns(events),
      timestamps: events.map((event) => event.timestamp),
      metadata: graph.getMetadata(),
    };
  }

  decode(encoded: ColumnarEventGraph): EventGraph {
    const ids = this.decodeIds(encoded.idRuns);
    const operations = this.decodeOperations(
      encoded,
      encoded.insertedContent,
      ids.length,
    );
    const parents = this.decodeParents(encoded.parentOverrides, ids);
    const graph = new EventGraph();
    graph.setMetadata(encoded.metadata ?? {});

    ids.forEach((id, index) => {
      const operation = operations[index];
      if (!operation) {
        throw new Error(`Missing operation for event ${id}`);
      }

      const event: GraphEvent = {
        id,
        operation,
        parentVersion: new Set(parents[index] ?? []),
        timestamp: encoded.timestamps[index] ?? 0,
      };
      graph.addEvent(event);
    });

    return graph;
  }

  toSerializedGraph(encoded: ColumnarEventGraph): SerializedGraphOutput {
    return this.decode(encoded).serialize();
  }

  encodeBinary(graph: EventGraph): Uint8Array {
    const encoded = this.encode(graph);
    const writer = new BinaryWriter();

    writer.writeBytes(BINARY_MAGIC);
    writer.writeStringArray(encoded.version);
    this.writeOperationRuns(writer, encoded.operationRuns);
    writer.writeZigZagDeltaArray(encoded.operationIndexes);
    writer.writeVarintArray(encoded.operationLengths);
    // textLengths intentionally omitted: derivable from operationRuns + operationLengths.
    writer.writeBytes(
      lz4.compress(textEncoder.encode(encoded.insertedContent)),
    );
    this.writeParentOverrides(writer, encoded.parentOverrides);
    this.writeIdRuns(writer, encoded.idRuns);
    writer.writeZigZagDeltaArray(encoded.timestamps);
    writer.writeString(JSON.stringify(encoded.metadata ?? {}));

    return writer.toUint8Array();
  }

  decodeBinary(bytes: Uint8Array): EventGraph {
    const reader = new BinaryReader(bytes);
    const magic = reader.readBytes(reader.readVarint());
    if (
      magic.length !== BINARY_MAGIC.length ||
      !BINARY_MAGIC.every((byte, index) => magic[index] === byte)
    ) {
      throw new Error("Invalid eg-walker columnar graph header");
    }

    const version = reader.readStringArray();
    const partialOperationRuns = this.readOperationRuns(reader);
    const operationIndexes = reader.readZigZagDeltaArray();
    const operationLengths = reader.readVarintArray();
    const operationRuns = finalizeOperationRuns(
      partialOperationRuns,
      operationIndexes,
      operationLengths,
    );
    const textLengths = reconstructTextLengths(operationRuns, operationLengths);
    const expectedInsertedSize = textLengths.reduce(
      (total, length) => total + length,
      0,
    );
    // Memory cap: LZ4 frames declare a per-block ceiling that's typically
    // 4-8 MB regardless of actual payload, so the frame's decompressBound is
    // not a useful bomb signal. Instead, bound the destination allocation
    // (lz4js writes silently past a too-small dst, then truncates), and then
    // verify the decoded string length matches the declared textLengths sum.
    // textLengths are UTF-16 code units; allow up to 4 UTF-8 bytes per unit
    // plus a small constant overhead for the destination buffer.
    const maxInsertedBytes = expectedInsertedSize * 4 + 64;
    const compressed = reader.readBytes(reader.readVarint());
    const decompressed = toUint8Array(
      lz4.decompress(compressed, maxInsertedBytes),
    );
    const insertedContent = textDecoder.decode(decompressed);
    if (insertedContent.length !== expectedInsertedSize) {
      throw new Error(
        `Decompressed inserted-content size mismatch (expected ${expectedInsertedSize} UTF-16 code units, got ${insertedContent.length})`,
      );
    }
    const parentOverrides = this.readParentOverrides(reader);
    const idRuns = this.readIdRuns(reader);
    const timestamps = reader.readZigZagDeltaArray();
    const metadata = JSON.parse(reader.readString()) as Record<string, unknown>;

    return this.decode({
      version,
      operationRuns,
      operationIndexes,
      operationLengths,
      textLengths,
      insertedContent,
      parentOverrides,
      idRuns,
      timestamps,
      metadata,
    });
  }

  private encodeOperationRuns(
    events: ReadonlyArray<GraphEvent>,
  ): OperationRun[] {
    const runs: OperationRun[] = [];

    for (const [eventOffset, event] of events.entries()) {
      const previous = runs[runs.length - 1];
      const textLength = operationTextLength(event.operation);
      const canExtend =
        previous &&
        previous.type === event.operation.type &&
        previous.startEventOffset + previous.length === eventOffset;

      if (canExtend) {
        runs[runs.length - 1] = {
          ...previous,
          length: previous.length + 1,
          textLength:
            previous.textLength !== undefined
              ? previous.textLength + textLength
              : undefined,
        };
      } else {
        runs.push({
          type: event.operation.type,
          startIndex: event.operation.index,
          startEventOffset: eventOffset,
          length: 1,
          textLength:
            event.operation.type === OPERATION_TYPE.INSERT
              ? textLength
              : undefined,
        });
      }
    }

    return runs;
  }

  /**
   * Binary form of an operation run is just `(type, length)`. The other
   * fields on the in-memory `OperationRun` (`startIndex`, `startEventOffset`,
   * `textLength`) are all derivable from the other columns and are
   * reconstructed by {@link readOperationRuns} using `operationIndexes` and
   * `operationLengths`.
   */
  private writeOperationRuns(
    writer: BinaryWriter,
    runs: ReadonlyArray<OperationRun>,
  ): void {
    writer.writeVarint(runs.length);
    for (const run of runs) {
      writer.writeVarint(run.type === OPERATION_TYPE.INSERT ? 1 : 2);
      writer.writeVarint(run.length);
    }
  }

  private readOperationRuns(reader: BinaryReader): PartialOperationRun[] {
    const length = reader.readVarint();
    const runs: PartialOperationRun[] = [];
    let cursor = 0;

    for (let i = 0; i < length; i++) {
      const type =
        reader.readVarint() === 1
          ? OPERATION_TYPE.INSERT
          : OPERATION_TYPE.DELETE;
      const runLength = reader.readVarint();
      runs.push({
        type,
        startEventOffset: cursor,
        length: runLength,
      });
      cursor += runLength;
    }

    return runs;
  }

  private encodeParentOverrides(
    events: ReadonlyArray<GraphEvent>,
  ): ParentOverride[] {
    return events.flatMap((event, eventOffset) => {
      const defaultParents =
        eventOffset === 0 ? [] : [events[eventOffset - 1]?.id];
      const parents = Array.from(event.parentVersion);
      const usesDefault =
        parents.length === defaultParents.length &&
        parents.every((parent, index) => parent === defaultParents[index]);

      return usesDefault ? [] : [{ eventOffset, parents }];
    });
  }

  /**
   * Parent overrides are emitted in topological order, so `eventOffset` is
   * strictly increasing. We write the delta from the previous offset (the
   * first delta is from `-1`, so it's always non-negative) as an unsigned
   * varint, which is one byte for offsets that are tightly clustered.
   */
  private writeParentOverrides(
    writer: BinaryWriter,
    overrides: ReadonlyArray<ParentOverride>,
  ): void {
    writer.writeVarint(overrides.length);
    let previous = -1;
    for (const override of overrides) {
      const delta = override.eventOffset - previous - 1;
      writer.writeVarint(delta);
      writer.writeStringArray(override.parents);
      previous = override.eventOffset;
    }
  }

  private readParentOverrides(reader: BinaryReader): ParentOverride[] {
    const length = reader.readVarint();
    const overrides: ParentOverride[] = [];
    let previous = -1;
    for (let i = 0; i < length; i++) {
      const delta = reader.readVarint();
      const eventOffset = previous + 1 + delta;
      overrides.push({
        eventOffset,
        parents: reader.readStringArray(),
      });
      previous = eventOffset;
    }
    return overrides;
  }

  private encodeIdRuns(events: ReadonlyArray<GraphEvent>): IdRun[] {
    const runs: IdRun[] = [];

    for (const [eventOffset, event] of events.entries()) {
      const parsed = parseEventId(event.id);
      if (!parsed) {
        runs.push({
          replicaId: event.id,
          startSequence: 0,
          startEventOffset: eventOffset,
          length: 1,
          custom: true,
        });
        continue;
      }

      const previous = runs[runs.length - 1];
      const canExtend =
        previous &&
        previous.replicaId === parsed.replicaId &&
        previous.startSequence + previous.length === parsed.sequence &&
        previous.startEventOffset + previous.length === eventOffset;

      if (canExtend) {
        runs[runs.length - 1] = { ...previous, length: previous.length + 1 };
      } else {
        runs.push({
          replicaId: parsed.replicaId,
          startSequence: parsed.sequence,
          startEventOffset: eventOffset,
          length: 1,
          custom: false,
        });
      }
    }

    return runs;
  }

  /**
   * Id runs are written in topological order, so `startEventOffset` is the
   * prefix sum of run lengths and never needs to be on the wire. The
   * `custom` flag is packed into the low bit of the length-prefix to save a
   * byte per run on the common (non-custom) case. Uses safe-integer
   * arithmetic rather than 32-bit bitwise ops so the encoding stays correct
   * for run lengths up to 2^52.
   */
  private writeIdRuns(writer: BinaryWriter, runs: ReadonlyArray<IdRun>): void {
    writer.writeVarint(runs.length);
    for (const run of runs) {
      writer.writeString(run.replicaId);
      writer.writeVarint(run.startSequence);
      writer.writeVarint(run.length * 2 + (run.custom ? 1 : 0));
    }
  }

  private readIdRuns(reader: BinaryReader): IdRun[] {
    const length = reader.readVarint();
    const runs: IdRun[] = [];
    let cursor = 0;
    for (let i = 0; i < length; i++) {
      const replicaId = reader.readString();
      const startSequence = reader.readVarint();
      const packed = reader.readVarint();
      const custom = packed % 2 === 1;
      const runLength = Math.floor(packed / 2);
      // {@link encodeIdRuns} only emits custom runs with `length: 1`
      // (verbatim string IDs are never coalesced). Encoder bugs that
      // violate this invariant would shift every subsequent event ID
      // silently, so guard it at the decode boundary.
      if (custom && runLength !== 1) {
        throw new Error(`Custom id run must have length 1, got ${runLength}`);
      }
      runs.push({
        replicaId,
        startSequence,
        startEventOffset: cursor,
        length: runLength,
        custom,
      });
      cursor += runLength;
    }
    return runs;
  }

  private decodeIds(runs: ReadonlyArray<IdRun>): EventId[] {
    const ids: EventId[] = [];

    for (const run of runs) {
      for (let offset = 0; offset < run.length; offset++) {
        ids[run.startEventOffset + offset] = run.custom
          ? run.replicaId
          : `${run.replicaId}:${run.startSequence + offset}`;
      }
    }

    return ids;
  }

  private decodeOperations(
    encoded: ColumnarEventGraph,
    insertedContent: string,
    eventCount: number,
  ): ExternalOperation[] {
    const operations: ExternalOperation[] = [];
    let contentOffset = 0;
    let runOffset = 0;

    for (let eventOffset = 0; eventOffset < eventCount; eventOffset++) {
      while (
        runOffset < encoded.operationRuns.length &&
        eventOffset >=
          (encoded.operationRuns[runOffset]?.startEventOffset ?? 0) +
            (encoded.operationRuns[runOffset]?.length ?? 0)
      ) {
        runOffset++;
      }

      const run = encoded.operationRuns[runOffset];
      if (!run) {
        throw new Error(
          `Missing operation run for event offset ${eventOffset}`,
        );
      }
      if (
        eventOffset < run.startEventOffset ||
        eventOffset >= run.startEventOffset + run.length
      ) {
        throw new Error(
          `Operation run ${runOffset} does not cover event offset ${eventOffset}`,
        );
      }

      const index = encoded.operationIndexes[eventOffset] ?? run.startIndex;
      const length = encoded.operationLengths[eventOffset] ?? 0;
      const textLength = encoded.textLengths[eventOffset] ?? 0;

      if (run.type === OPERATION_TYPE.INSERT) {
        const text = insertedContent.slice(
          contentOffset,
          contentOffset + textLength,
        );
        operations[eventOffset] = {
          type: OPERATION_TYPE.INSERT,
          index,
          text,
        };
        contentOffset += textLength;
      } else {
        operations[eventOffset] = {
          type: OPERATION_TYPE.DELETE,
          index,
          length,
        };
      }
    }

    return operations;
  }

  private decodeParents(
    overrides: ReadonlyArray<ParentOverride>,
    ids: ReadonlyArray<EventId>,
  ): EventId[][] {
    const parents = ids.map((_, index) =>
      index === 0 ? [] : [ids[index - 1] as EventId],
    );

    for (const override of overrides) {
      parents[override.eventOffset] = [...override.parents];
    }

    return parents;
  }
}

class BinaryWriter {
  private buffer = new Uint8Array(256);
  private size = 0;

  writeVarint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Cannot encode invalid varint value ${value}`);
    }

    let remaining = value;
    while (remaining >= 0x80) {
      this.writeByte((remaining % 0x80) + 0x80);
      remaining = Math.floor(remaining / 0x80);
    }
    this.writeByte(remaining);
  }

  writeVarintArray(values: ReadonlyArray<number>): void {
    this.writeVarint(values.length);
    for (const value of values) {
      this.writeVarint(value);
    }
  }

  /**
   * Write a signed integer using zigzag varint encoding. Allows negative
   * deltas (e.g. document positions that move backwards on delete) while
   * keeping the common small-delta case at one byte.
   */
  writeZigZagVarint(value: number): void {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Cannot encode invalid zigzag varint value ${value}`);
    }
    this.writeVarint(zigzagEncode(value));
  }

  /**
   * Write a numeric array as a zigzag-delta varint array: a count followed by
   * `zigzag(values[i] - values[i-1])` for each entry (the first entry is
   * relative to `0`). For monotonically increasing or near-stationary columns
   * (timestamps, document positions in a linear trace) this compresses to
   * ~1 byte per value.
   */
  writeZigZagDeltaArray(values: ReadonlyArray<number>): void {
    this.writeVarint(values.length);
    let previous = 0;
    for (const value of values) {
      this.writeZigZagVarint(value - previous);
      previous = value;
    }
  }

  writeString(value: string): void {
    this.writeBytes(textEncoder.encode(value));
  }

  writeStringArray(values: ReadonlyArray<string>): void {
    this.writeVarint(values.length);
    for (const value of values) {
      this.writeString(value);
    }
  }

  writeBytes(bytes: Uint8Array): void {
    this.writeVarint(bytes.length);
    this.ensureCapacity(this.size + bytes.length);
    this.buffer.set(bytes, this.size);
    this.size += bytes.length;
  }

  toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.size);
  }

  private writeByte(byte: number): void {
    this.ensureCapacity(this.size + 1);
    this.buffer[this.size++] = byte;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) {
      return;
    }
    let nextCapacity = this.buffer.length * 2;
    while (nextCapacity < required) {
      nextCapacity *= 2;
    }
    const next = new Uint8Array(nextCapacity);
    next.set(this.buffer);
    this.buffer = next;
  }
}

class BinaryReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readVarint(): number {
    let value = 0;
    let multiplier = 1;

    while (true) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined) {
        throw new Error("Unexpected end of varint");
      }

      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        return value;
      }
      multiplier *= 0x80;
    }
  }

  readVarintArray(): number[] {
    const length = this.readVarint();
    return Array.from({ length }, () => this.readVarint());
  }

  readZigZagVarint(): number {
    return zigzagDecode(this.readVarint());
  }

  readZigZagDeltaArray(): number[] {
    const length = this.readVarint();
    const values: number[] = new Array<number>(length);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const value = previous + this.readZigZagVarint();
      values[i] = value;
      previous = value;
    }
    return values;
  }

  readString(): string {
    return textDecoder.decode(this.readBytes(this.readVarint()));
  }

  readStringArray(): string[] {
    const length = this.readVarint();
    return Array.from({ length }, () => this.readString());
  }

  readBytes(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Unexpected end of binary eg-walker graph");
    }
    const result = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
}
