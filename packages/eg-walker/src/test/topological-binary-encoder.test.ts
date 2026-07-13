import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { encodeTopologicallyOrderedEventsBinary } from "../graph/columnar-codec/topological-binary-encoder";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent } from "../types";

const event = (
  id: string,
  parentVersion: ReadonlyArray<string>,
  operation: GraphEvent["operation"],
  timestamp: number,
): GraphEvent => ({
  id,
  parentVersion: new Set(parentVersion),
  operation,
  timestamp,
});

describe("topological EGW3 binary encoder", () => {
  it("matches the EventGraph codec byte-for-byte for the same wire order", () => {
    const events: GraphEvent[] = [
      event(
        "alpha:0",
        [],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        -2,
      ),
      event(
        "alpha:1",
        ["alpha:0"],
        { type: OPERATION_TYPE.INSERT, index: 1, text: "🙂" },
        4,
      ),
      event(
        "alpha:2",
        ["alpha:1"],
        { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        5,
      ),
      event(
        "beta:0",
        ["alpha:0"],
        { type: OPERATION_TYPE.DELETE, index: 0, length: 0 },
        7,
      ),
      event(
        "merge:0",
        ["alpha:2", "beta:0"],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "z" },
        10,
      ),
      event(
        "legacy-id",
        ["merge:0"],
        { type: OPERATION_TYPE.INSERT, index: 1, text: "!" },
        11,
      ),
    ];
    const metadata = { source: "direct", nested: { stable: true } };
    const graph = EventGraph.fromEvents(events);
    graph.setMetadata(metadata);

    expect(graph.getTopologicalOrder().map(({ id }) => id)).toEqual(
      events.map(({ id }) => id),
    );
    const direct = encodeTopologicallyOrderedEventsBinary(events, metadata);
    const codec = new ColumnarEventGraphCodec();
    expect(direct.binary).toEqual(codec.encodeBinary(graph));
    expect(direct.frontier).toEqual(Array.from(graph.getFrontier()));
    expect(codec.decodeBinary(direct.binary).serialize()).toEqual(
      graph.serialize(),
    );
  });

  it("matches the empty EventGraph payload", () => {
    const direct = encodeTopologicallyOrderedEventsBinary([]);
    const codec = new ColumnarEventGraphCodec();
    expect(direct.binary).toEqual(codec.encodeBinary(new EventGraph()));
    expect(direct.frontier).toEqual([]);
  });

  it("rejects duplicate IDs and parents that have not appeared", () => {
    const root = event(
      "replica:0",
      [],
      { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      0,
    );
    expect(() => encodeTopologicallyOrderedEventsBinary([root, root])).toThrow(
      "Duplicate event ID replica:0",
    );
    expect(() =>
      encodeTopologicallyOrderedEventsBinary([
        event(
          "replica:1",
          ["replica:0"],
          { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
          1,
        ),
      ]),
    ).toThrow("parent replica:0 has not been encoded");
  });

  it.each([
    {
      name: "metadata",
      events: [] as ReadonlyArray<GraphEvent>,
      metadata: null as unknown as Record<string, unknown>,
      error: /metadata must be an object/,
    },
    {
      name: "event object",
      events: [null as unknown as GraphEvent],
      error: /must be an object/,
    },
    {
      name: "event ID",
      events: [
        event("", [], { type: OPERATION_TYPE.INSERT, index: 0, text: "a" }, 0),
      ],
      error: /invalid ID/,
    },
    {
      name: "parent set",
      events: [
        {
          ...event(
            "a:0",
            [],
            { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
            0,
          ),
          parentVersion: [] as unknown as Set<string>,
        },
      ],
      error: /parentVersion must be a Set/,
    },
    {
      name: "parent ID",
      events: [
        {
          ...event(
            "a:0",
            [],
            { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
            0,
          ),
          parentVersion: new Set([1 as unknown as string]),
        },
      ],
      error: /invalid parent ID/,
    },
    {
      name: "timestamp",
      events: [
        event(
          "a:0",
          [],
          { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
          Number.NaN,
        ),
      ],
      error: /invalid timestamp/,
    },
    {
      name: "operation object",
      events: [
        {
          ...event(
            "a:0",
            [],
            { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
            0,
          ),
          operation: null,
        } as unknown as GraphEvent,
      ],
      error: /invalid operation/,
    },
    {
      name: "operation index",
      events: [
        event(
          "a:0",
          [],
          { type: OPERATION_TYPE.INSERT, index: -1, text: "a" },
          0,
        ),
      ],
      error: /invalid operation index/,
    },
    {
      name: "insert text",
      events: [
        event(
          "a:0",
          [],
          {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: 1 as unknown as string,
          },
          0,
        ),
      ],
      error: /invalid insert text/,
    },
    {
      name: "delete length",
      events: [
        event(
          "a:0",
          [],
          { type: OPERATION_TYPE.DELETE, index: 0, length: -1 },
          0,
        ),
      ],
      error: /invalid delete length/,
    },
    {
      name: "operation type",
      events: [
        event(
          "a:0",
          [],
          {
            type: "replace",
            index: 0,
          } as unknown as GraphEvent["operation"],
          0,
        ),
      ],
      error: /unknown operation type/,
    },
  ])("rejects invalid $name input", ({ events, metadata = {}, error }) => {
    expect(() =>
      encodeTopologicallyOrderedEventsBinary(events, metadata),
    ).toThrow(error);
  });
});
