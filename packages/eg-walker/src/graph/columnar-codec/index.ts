// Columnar event graph codec.
//
// `encode` / `decode` convert between an `EventGraph` and the in-memory
// `ColumnarEventGraph` columns. `encodeBinary` writes the EGW4 wire format
// (see `egw4-format.ts`); `decodeBinary` reads EGW4 and, for snapshots
// written before EGW4, EGW3. EGW1 and EGW2 payloads are rejected.

import { OPERATION_TYPE } from "../../constants/operation-types";
import { EventGraph } from "../event-graph";
import { BinaryReader, EGW3_MAGIC, EGW4_MAGIC } from "../internals/binary-io";
import type { GraphEvent, SerializedGraphOutput } from "../../types";
import {
  operationLength,
  operationTextLength,
  type ColumnarEventGraph,
  type IdRun,
  type OperationRun,
  type ParentOverride,
} from "./types";
import { decodeOperations, encodeOperationRuns } from "./operations";
import { decodeParents, encodeParentOverrides } from "./parents";
import { decodeIds, encodeIdRuns } from "./ids";
import { decodeEgw3Graph } from "./egw3-decoder";
import { decodeEgw4Graph } from "./egw4-decoder";
import {
  sameEventIds,
  strictEventIdSet,
  strictMetadata,
} from "./graph-validation";
import { encodeTopologicallyOrderedEventsBinary } from "./topological-binary-encoder";

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
    const expectedFrontier = strictEventIdSet(
      encoded.version,
      "columnar graph version",
    );
    const metadata = strictMetadata(encoded.metadata);
    const ids = decodeIds(encoded.idRuns);
    const operations = decodeOperations(
      encoded,
      encoded.insertedContent,
      ids.length,
    );
    const parents = decodeParents(encoded.parentOverrides, ids);
    const graph = new EventGraph();
    graph.setMetadata(metadata);

    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      if (id === undefined) {
        throw new Error(`Missing ID at index ${index}`);
      }
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
    }

    if (!sameEventIds(graph.getFrontier(), expectedFrontier)) {
      throw new Error("Columnar graph version does not match its frontier");
    }

    return graph;
  }

  toSerializedGraph(encoded: ColumnarEventGraph): SerializedGraphOutput {
    return this.decode(encoded).serialize();
  }

  /** Encode the graph as EGW4, in {@link EventGraph.getTopologicalOrder} order. */
  encodeBinary(graph: EventGraph): Uint8Array {
    return encodeTopologicallyOrderedEventsBinary(
      graph.getTopologicalOrder(),
      graph.getMetadata(),
    ).binary;
  }

  /** Decode an EGW4 payload, or an EGW3 payload written before EGW4. */
  decodeBinary(bytes: Uint8Array): EventGraph {
    const reader = new BinaryReader(bytes);
    const magic = reader.readByteView(reader.readVarint());
    if (hasMagic(magic, EGW4_MAGIC)) {
      return decodeEgw4Graph(bytes);
    }
    if (hasMagic(magic, EGW3_MAGIC)) {
      return decodeEgw3Graph(reader);
    }
    throw new Error("Invalid eg-walker columnar graph header");
  }
}

const hasMagic = (magic: Uint8Array, expected: Uint8Array): boolean =>
  magic.length === expected.length &&
  expected.every((byte, index) => magic[index] === byte);
