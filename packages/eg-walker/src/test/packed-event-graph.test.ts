import { describe, expect, it, vi } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";

const buildBranchingGraph = (): EventGraph => {
  const graph = new EventGraph();
  graph.addEvent({
    id: "root",
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
    parentVersion: new Set(),
    timestamp: 0,
  });
  graph.addEvent({
    id: "left",
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    parentVersion: new Set(["root"]),
    timestamp: 1,
  });
  graph.addEvent({
    id: "right",
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    parentVersion: new Set(["root"]),
    timestamp: 2,
  });
  return graph;
};

describe("packed event graph", () => {
  it("decodes without per-event addEvent calls and preserves detached views", () => {
    const codec = new ColumnarEventGraphCodec();
    const source = buildBranchingGraph();
    const bytes = codec.encodeBinary(source);
    const addEvent = vi.spyOn(EventGraph.prototype, "addEvent");

    try {
      const graph = codec.decodeBinary(bytes);
      expect(addEvent).not.toHaveBeenCalled();
      expect(graph.getTopologicalOrder()).toEqual(source.getTopologicalOrder());
      expect(graph.getBranchPreservingTopologicalOrder()).toEqual(
        source.getBranchPreservingTopologicalOrder(),
      );
      expect(graph.getFrontier()).toEqual(new Set(["left", "right"]));
      expect(graph.getChildren("root")).toEqual(new Set(["left", "right"]));
      expect(graph.isAncestor("root", "right")).toBe(true);
      expect(graph.areConcurrent("left", "right")).toBe(true);

      const detached = graph.getEvent("right")!;
      (detached.parentVersion as Set<string>).clear();
      (detached.operation as { index: number }).index = 99;
      expect(graph.getParents("right")).toEqual(new Set(["root"]));
      expect(graph.getEvent("right")?.operation.index).toBe(1);

      const [root] = graph.getBranchPreservingTopologicalOrder();
      expect(() => (root!.parentVersion as Set<string>).add("forged")).toThrow(
        TypeError,
      );
      expect(() => (root!.parentVersion as Set<string>).delete("root")).toThrow(
        TypeError,
      );
      expect(() => (root!.parentVersion as Set<string>).clear()).toThrow(
        TypeError,
      );
      expect(() => {
        (root!.operation as { index: number }).index = 99;
      }).toThrow(TypeError);
    } finally {
      addEvent.mockRestore();
    }
  });

  it("merges a mutable tail into packed edges and rolls it back atomically", () => {
    const codec = new ColumnarEventGraphCodec();
    const graph = codec.decodeBinary(codec.encodeBinary(buildBranchingGraph()));
    const transaction = graph.beginAppendTransaction();

    graph.addEvent({
      id: "merge",
      operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
      parentVersion: new Set(["left", "right"]),
      timestamp: 3,
    });
    expect(graph.getFrontier()).toEqual(new Set(["merge"]));
    expect(graph.getChildren("left")).toEqual(new Set(["merge"]));
    expect(
      graph.diffVersions(new Set(["merge"]), new Set(["left"])).onlyInLeft,
    ).toEqual(new Set(["right", "merge"]));

    transaction.rollback();
    expect(graph.getEventCount()).toBe(3);
    expect(graph.getFrontier()).toEqual(new Set(["left", "right"]));
    expect(graph.getChildren("left")).toEqual(new Set());
    expect(graph.serialize()).toEqual(buildBranchingGraph().serialize());
  });

  it("streams exact linear histories and skips redundant packed validation", () => {
    const source = new EventGraph();
    for (let index = 0; index < 2_000; index++) {
      source.addEvent({
        id: `linear:${index}`,
        operation: { type: OPERATION_TYPE.INSERT, index, text: "x" },
        parentVersion:
          index === 0 ? new Set() : new Set([`linear:${index - 1}`]),
        timestamp: index,
      });
    }
    const codec = new ColumnarEventGraphCodec();
    const graph = codec.decodeBinary(codec.encodeBinary(source));
    let validationCalls = 0;

    expect(graph.isExactLinearHistory()).toBe(true);
    expect(Array.from(graph.iterateEventIdsInInsertionOrder())).toHaveLength(
      2_000,
    );
    graph.validateStoredEvents(() => validationCalls++);
    expect(validationCalls).toBe(0);

    graph.addEvent({
      id: "linear:2000",
      operation: { type: OPERATION_TYPE.INSERT, index: 2_000, text: "x" },
      parentVersion: new Set(["linear:1999"]),
      timestamp: 2_000,
    });
    graph.validateStoredEvents(() => validationCalls++);
    expect(validationCalls).toBe(1);
    expect(graph.isExactLinearHistory()).toBe(true);
  });
});
