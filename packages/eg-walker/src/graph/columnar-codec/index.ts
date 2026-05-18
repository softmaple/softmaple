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

import { OPERATION_TYPE } from "../../constants/operation-types";
import { EventGraph } from "../event-graph";
import lz4 from "lz4js";
import {
  BINARY_MAGIC,
  BinaryReader,
  BinaryWriter,
  decodeText,
  encodeText,
  toUint8Array,
} from "../internals/binary-io";
import type { GraphEvent, SerializedGraphOutput } from "../../types";
import {
  finalizeOperationRuns,
  operationLength,
  operationTextLength,
  reconstructTextLengths,
  type ColumnarEventGraph,
  type IdRun,
  type OperationRun,
  type ParentOverride,
} from "./types";
import {
  decodeOperations,
  encodeOperationRuns,
  readOperationRuns,
  writeOperationRuns,
} from "./operations";
import {
  decodeParents,
  encodeParentOverrides,
  readParentOverrides,
  writeParentOverrides,
} from "./parents";
import { decodeIds, encodeIdRuns, readIdRuns, writeIdRuns } from "./ids";

export type { ColumnarEventGraph, IdRun, OperationRun, ParentOverride };

export class ColumnarEventGraphCodec {
  encode(graph: EventGraph): ColumnarEventGraph {
    const events = graph.getTopologicalOrder();
    return {
      version: Array.from(graph.getFrontier()),
      operationRuns: encodeOperationRuns(events),
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
      parentOverrides: encodeParentOverrides(events),
      idRuns: encodeIdRuns(events),
      timestamps: events.map((event) => event.timestamp),
      metadata: graph.getMetadata(),
    };
  }

  decode(encoded: ColumnarEventGraph): EventGraph {
    const ids = decodeIds(encoded.idRuns);
    const operations = decodeOperations(
      encoded,
      encoded.insertedContent,
      ids.length,
    );
    const parents = decodeParents(encoded.parentOverrides, ids);
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
    writeOperationRuns(writer, encoded.operationRuns);
    writer.writeZigZagDeltaArray(encoded.operationIndexes);
    writer.writeVarintArray(encoded.operationLengths);
    // textLengths intentionally omitted: derivable from operationRuns + operationLengths.
    writer.writeBytes(lz4.compress(encodeText(encoded.insertedContent)));
    writeParentOverrides(writer, encoded.parentOverrides);
    writeIdRuns(writer, encoded.idRuns);
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
    const partialOperationRuns = readOperationRuns(reader);
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
    const insertedContent = decodeText(decompressed);
    if (insertedContent.length !== expectedInsertedSize) {
      throw new Error(
        `Decompressed inserted-content size mismatch (expected ${expectedInsertedSize} UTF-16 code units, got ${insertedContent.length})`,
      );
    }
    const parentOverrides = readParentOverrides(reader);
    const idRuns = readIdRuns(reader);
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
}
