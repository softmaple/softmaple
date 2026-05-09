import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "./event-graph";
import lz4 from "lz4js";
import type {
  EventId,
  ExternalOperation,
  GraphEvent,
  SerializedGraph,
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

const BINARY_MAGIC = new Uint8Array([0x45, 0x47, 0x57, 0x31]); // EGW1
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toUint8Array = (bytes: ReadonlyArray<number> | Uint8Array): Uint8Array =>
  bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

const parseEventId = (
  id: EventId,
): { readonly replicaId: string; readonly sequence: number } | null => {
  const separator = id.lastIndexOf(":");
  if (separator === -1) {
    return null;
  }

  const sequence = Number(id.slice(separator + 1));
  if (!Number.isInteger(sequence)) {
    return null;
  }

  return {
    replicaId: id.slice(0, separator),
    sequence,
  };
};

const operationTextLength = (operation: ExternalOperation): number =>
  operation.type === OPERATION_TYPE.INSERT ? operation.text.length : 0;

const operationLength = (operation: ExternalOperation): number =>
  operation.type === OPERATION_TYPE.INSERT
    ? operation.text.length
    : operation.length;

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

  toSerializedGraph(encoded: ColumnarEventGraph): SerializedGraph {
    return this.decode(encoded).serialize();
  }

  encodeBinary(graph: EventGraph): Uint8Array {
    const encoded = this.encode(graph);
    const writer = new BinaryWriter();

    writer.writeBytes(BINARY_MAGIC);
    writer.writeStringArray(encoded.version);
    this.writeOperationRuns(writer, encoded.operationRuns);
    writer.writeVarintArray(encoded.operationIndexes);
    writer.writeVarintArray(encoded.operationLengths);
    writer.writeVarintArray(encoded.textLengths);
    writer.writeBytes(
      lz4.compress(textEncoder.encode(encoded.insertedContent)),
    );
    this.writeParentOverrides(writer, encoded.parentOverrides);
    this.writeIdRuns(writer, encoded.idRuns);
    writer.writeVarintArray(encoded.timestamps);
    writer.writeString(JSON.stringify(encoded.metadata ?? {}));

    return writer.toUint8Array();
  }

  decodeBinary(bytes: Uint8Array): EventGraph {
    const reader = new BinaryReader(bytes);
    const magic = reader.readBytes(reader.readVarint());
    if (!BINARY_MAGIC.every((byte, index) => magic[index] === byte)) {
      throw new Error("Invalid eg-walker columnar graph header");
    }

    const version = reader.readStringArray();
    const operationRuns = this.readOperationRuns(reader);
    const operationIndexes = reader.readVarintArray();
    const operationLengths = reader.readVarintArray();
    const textLengths = reader.readVarintArray();
    const insertedContent = textDecoder.decode(
      toUint8Array(lz4.decompress(reader.readBytes(reader.readVarint()))),
    );
    const parentOverrides = this.readParentOverrides(reader);
    const idRuns = this.readIdRuns(reader);
    const timestamps = reader.readVarintArray();
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

  private writeOperationRuns(
    writer: BinaryWriter,
    runs: ReadonlyArray<OperationRun>,
  ): void {
    writer.writeVarint(runs.length);
    for (const run of runs) {
      writer.writeVarint(run.type === OPERATION_TYPE.INSERT ? 1 : 2);
      writer.writeVarint(run.startIndex);
      writer.writeVarint(run.startEventOffset);
      writer.writeVarint(run.length);
      writer.writeVarint(run.textLength ?? 0);
    }
  }

  private readOperationRuns(reader: BinaryReader): OperationRun[] {
    const length = reader.readVarint();
    const runs: OperationRun[] = [];

    for (let i = 0; i < length; i++) {
      const type =
        reader.readVarint() === 1
          ? OPERATION_TYPE.INSERT
          : OPERATION_TYPE.DELETE;
      const startIndex = reader.readVarint();
      const startEventOffset = reader.readVarint();
      const runLength = reader.readVarint();
      const textLength = reader.readVarint();
      runs.push({
        type,
        startIndex,
        startEventOffset,
        length: runLength,
        textLength: type === OPERATION_TYPE.INSERT ? textLength : undefined,
      });
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

  private writeParentOverrides(
    writer: BinaryWriter,
    overrides: ReadonlyArray<ParentOverride>,
  ): void {
    writer.writeVarint(overrides.length);
    for (const override of overrides) {
      writer.writeVarint(override.eventOffset);
      writer.writeStringArray(override.parents);
    }
  }

  private readParentOverrides(reader: BinaryReader): ParentOverride[] {
    const length = reader.readVarint();
    const overrides: ParentOverride[] = [];
    for (let i = 0; i < length; i++) {
      overrides.push({
        eventOffset: reader.readVarint(),
        parents: reader.readStringArray(),
      });
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
        });
      }
    }

    return runs;
  }

  private writeIdRuns(writer: BinaryWriter, runs: ReadonlyArray<IdRun>): void {
    writer.writeVarint(runs.length);
    for (const run of runs) {
      writer.writeString(run.replicaId);
      writer.writeVarint(run.startSequence);
      writer.writeVarint(run.startEventOffset);
      writer.writeVarint(run.length);
    }
  }

  private readIdRuns(reader: BinaryReader): IdRun[] {
    const length = reader.readVarint();
    const runs: IdRun[] = [];
    for (let i = 0; i < length; i++) {
      runs.push({
        replicaId: reader.readString(),
        startSequence: reader.readVarint(),
        startEventOffset: reader.readVarint(),
        length: reader.readVarint(),
      });
    }
    return runs;
  }

  private decodeIds(runs: ReadonlyArray<IdRun>): EventId[] {
    const ids: EventId[] = [];

    for (const run of runs) {
      for (let offset = 0; offset < run.length; offset++) {
        ids[run.startEventOffset + offset] =
          run.startSequence === 0 &&
          run.length === 1 &&
          !run.replicaId.includes(":")
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
  private readonly bytes: number[] = [];

  writeVarint(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Cannot encode invalid varint value ${value}`);
    }

    let remaining = value;
    while (remaining >= 0x80) {
      this.bytes.push((remaining % 0x80) + 0x80);
      remaining = Math.floor(remaining / 0x80);
    }
    this.bytes.push(remaining);
  }

  writeVarintArray(values: ReadonlyArray<number>): void {
    this.writeVarint(values.length);
    for (const value of values) {
      this.writeVarint(value);
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
    this.bytes.push(...bytes);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
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
