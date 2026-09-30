import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { encodeTopologicallyOrderedEventsBinary } from "../graph/columnar-codec/topological-binary-encoder";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

const insert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  text: string,
  index = 0,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  timestamp: 1,
});

const snapshotOf = (graph: EventGraph) => ({
  events: graph.getTopologicalOrder().map((event) => ({
    id: event.id,
    parents: [...event.parentVersion],
    operation: { ...event.operation },
    timestamp: event.timestamp,
  })),
  frontier: [...graph.getFrontier()],
});

describe("event graph columnar tail", () => {
  it("rolls back merges, child lists and malformed events to the prior state", () => {
    // Arrange: a packed prefix whose root gains several tail children.
    const codec = new ColumnarEventGraphCodec();
    const graph = codec.decodeBinary(
      codec.encodeBinary(EventGraph.fromEvents([insert("root:0", [], "r")])),
    );
    graph.addEvent(insert("a:0", ["root:0"], "a"));
    const before = snapshotOf(graph);

    // Act
    const transaction = graph.beginAppendTransaction();
    graph.addEvent(insert("b:0", ["root:0"], "b"));
    graph.addEvent(insert("c:0", ["root:0"], "c"));
    graph.addEvent(insert("m:0", ["a:0", "b:0", "c:0"], "x".repeat(5000)));
    graph.addEvent(insert("n:0", ["m:0"], "y"));
    graph.addEvent(insert("o:0", ["m:0"], "z"));
    graph.addEvent({
      id: "bad:0",
      parentVersion: new Set(["n:0", "o:0"]),
      operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
      timestamp: Number.NaN,
    });
    expect(graph.getEventCount()).toBe(8);
    transaction.rollback();

    // Assert
    expect(snapshotOf(graph)).toEqual(before);
    graph.addEvent(insert("b:0", ["a:0"], "again"));
    expect([...graph.getFrontier()]).toEqual(["b:0"]);
  });

  it("slices inserted content across text chunk boundaries", () => {
    // Arrange: enough text to seal several 4096-code-unit chunks.
    const graph = new EventGraph();
    const texts = ["a".repeat(3000), "b".repeat(3000), "c".repeat(3000)];
    texts.forEach((text, index) => {
      graph.addEvent(
        insert(`w:${index}`, index === 0 ? [] : [`w:${index - 1}`], text),
      );
    });

    // Act
    const stored = texts.map(
      (_, index) =>
        (graph.getEvent(`w:${index}`)?.operation as { text: string }).text,
    );

    // Assert
    expect(stored).toEqual(texts);
  });

  it("rejects malformed columns with the event encoder's errors", () => {
    // Arrange: negative indexes and lengths fit the widened typed columns,
    // so the column encoder has to validate them itself.
    const cases: GraphEvent[] = [
      {
        id: "bad:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: -1, text: "x" },
        timestamp: 0,
      },
      {
        id: "bad:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: -2 },
        timestamp: 0,
      },
      {
        id: "bad:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "\ud800" },
        timestamp: 0,
      },
    ];

    for (const event of cases) {
      const graph = new EventGraph();
      graph.addEvent(event);
      const expected = (): unknown =>
        encodeTopologicallyOrderedEventsBinary(
          graph.getTopologicalOrder(),
          graph.getMetadata(),
          [...graph.getFrontier()],
        );

      // Act + Assert
      expect(expected).toThrow();
      expect(() => graph.encodeTopologicalBinary()).toThrow(
        captureMessage(expected),
      );
    }
  });

  it("falls back to the event encoder for events stored verbatim", () => {
    // Arrange: a NaN timestamp cannot live in the typed columns.
    const graph = new EventGraph();
    graph.addEvent({
      id: "bad:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
      timestamp: Number.NaN,
    });

    // Act + Assert
    expect(() => graph.encodeTopologicalBinary()).toThrow(
      "Event bad:0 has an invalid timestamp",
    );
  });
});

const captureMessage = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the encoder to throw");
};
