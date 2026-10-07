// Columnar event graph codec.
//
// `encode` / `decode` convert between an `EventGraph` and the in-memory
// `ColumnarEventGraph` columns. `encodeBinary` writes the EGW4 wire format
// (see `egw4-format.ts`); `decodeBinary` reads EGW4 and, for snapshots
// written before EGW4, EGW3. EGW1 and EGW2 payloads are rejected.

import { OPERATION_TYPE } from "../../constants/operation-types";
import { EventGraph } from "../event-graph";
import { BinaryReader, EGW3_MAGIC, EGW4_MAGIC } from "../internals/binary-io";
import { eventLimitOf } from "../internals/event-limit";
import { runSteps, type Steps } from "../internals/steps";
import type { GraphEvent, SerializedGraphOutput } from "../../types";
import {
  operationLength,
  operationTextLength,
  type ColumnarDecodeOptions,
  type ColumnarEventGraph,
  type IdRun,
  type OperationRun,
  type ParentOverride,
} from "./types";
import { decodeOperations, encodeOperationRuns } from "./operations";
import { decodeParents, encodeParentOverrides } from "./parents";
import { decodeIds, encodeIdRuns } from "./ids";
import { decodeEgw3Graph } from "./egw3-decoder";
import { decodeEgw4GraphSteps } from "./egw4-decoder";
import {
  sameEventIds,
  strictEventIdSet,
  strictMetadata,
} from "./graph-validation";

export type {
  ColumnarDecodeOptions,
  ColumnarEventGraph,
  IdRun,
  OperationRun,
  ParentOverride,
};

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

  /**
   * Encode the graph as EGW4, in {@link EventGraph.getEncodingOrder} order.
   * Graphs holding the same events and metadata encode to the same bytes,
   * whatever order the events were added in.
   */
  encodeBinary(graph: EventGraph): Uint8Array {
    return graph.encodeTopologicalBinary().binary;
  }

  /**
   * Decode an EGW4 payload, or an EGW3 payload written before EGW4.
   *
   * A few bytes of EGW4 can declare millions of events, each of which the
   * decoded graph keeps in its columns, so pass `maxEvents` when the bytes
   * may be untrusted.
   */
  decodeBinary(
    bytes: Uint8Array,
    options: ColumnarDecodeOptions = {},
  ): EventGraph {
    return runSteps(this.decodeBinarySteps(bytes, options));
  }

  /**
   * {@link decodeBinary} in steps, for a caller that must pause between
   * them: one or two columns of an EGW4 payload per step, an EGW3 payload in
   * one. `bytes` must not change until the generator returns.
   */
  *decodeBinarySteps(
    bytes: Uint8Array,
    options: ColumnarDecodeOptions = {},
  ): Steps<EventGraph> {
    const maxEvents = eventLimitOf(options.maxEvents);
    const reader = new BinaryReader(bytes);
    const magic = reader.readByteView(reader.readVarint());
    if (hasMagic(magic, EGW4_MAGIC)) {
      return yield* decodeEgw4GraphSteps(bytes, maxEvents);
    }
    if (hasMagic(magic, EGW3_MAGIC)) {
      return decodeEgw3Graph(reader, maxEvents);
    }
    throw new Error("Invalid eg-walker columnar graph header");
  }
}

const hasMagic = (magic: Uint8Array, expected: Uint8Array): boolean =>
  magic.length === expected.length &&
  expected.every((byte, index) => magic[index] === byte);
