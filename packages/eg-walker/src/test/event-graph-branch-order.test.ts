import { describe, it, expect } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { EventId, GraphEvent } from "../types";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";

const branchOrderIds = (graph: EventGraph): EventId[] =>
  graph.getBranchPreservingTopologicalOrder().map((event) => event.id);

const buildWideVsDeepGraph = (wideLeafCount: number): EventGraph => {
  const graph = new EventGraph();
  const add = (id: EventId, parents: EventId[]): void => {
    graph.addEvent({
      id,
      timestamp: graph.getEventCount(),
      parentVersion: new Set(parents),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
    });
  };
  add("root", []);
  add("a-wide", ["root"]);
  add("z-deep-0", ["root"]);
  for (let index = 0; index < wideLeafCount; index++) {
    add(`wide-leaf:${index}`, ["a-wide"]);
  }
  add("z-deep-1", ["z-deep-0"]);
  add("z-deep-2", ["z-deep-1"]);
  return graph;
};

describe("EventGraph getBranchPreservingTopologicalOrder", () => {
  it("keeps sibling branches consecutive instead of interleaving by id", () => {
    // Two parallel chains forking off a shared root. A Kahn traversal
    // with a sorted ready queue would interleave the two branches
    // (root, a-0, b-0, a-1, b-1, ...). The branch-preserving DFS keeps
    // each chain consecutive so the engine's prepare-state walks one
    // branch end-to-end before retreating to the other.
    const graph = new EventGraph();
    graph.addEvent({
      id: "root",
      timestamp: 0,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
    });
    const chainLength = 4;
    for (let i = 0; i < chainLength; i++) {
      graph.addEvent({
        id: `a-${i}`,
        timestamp: 10 + i,
        parentVersion: new Set<EventId>([i === 0 ? "root" : `a-${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "a" },
      });
      graph.addEvent({
        id: `b-${i}`,
        timestamp: 20 + i,
        parentVersion: new Set<EventId>([i === 0 ? "root" : `b-${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
      });
    }

    const ids = graph
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);
    const aStart = ids.indexOf("a-0");
    const bStart = ids.indexOf("b-0");
    // Whichever branch starts first must run to completion before the
    // other branch begins.
    const aRange = ids.slice(aStart, aStart + chainLength);
    const bRange = ids.slice(bStart, bStart + chainLength);
    expect(aRange).toEqual(["a-0", "a-1", "a-2", "a-3"]);
    expect(bRange).toEqual(["b-0", "b-1", "b-2", "b-3"]);
  });

  it("walks the shorter branch before a lexically earlier long branch", () => {
    // Visiting the short branch first means the long branch can remain
    // applied at the merge point instead of being retreated and re-advanced.
    const graph = new EventGraph();
    graph.addEvent({
      id: "root",
      timestamp: 0,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
    });
    graph.addEvent({
      id: "a-0",
      timestamp: 1,
      parentVersion: new Set<EventId>(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "a" },
    });
    graph.addEvent({
      id: "a-1",
      timestamp: 2,
      parentVersion: new Set<EventId>(["a-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "a" },
    });
    graph.addEvent({
      id: "a-2",
      timestamp: 3,
      parentVersion: new Set<EventId>(["a-1"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "a" },
    });
    graph.addEvent({
      id: "b-0",
      timestamp: 4,
      parentVersion: new Set<EventId>(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
    });

    const ids = graph
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);
    expect(ids).toEqual(["root", "b-0", "a-0", "a-1", "a-2"]);
  });

  it("does not double-count a shared merge suffix through a fork", () => {
    const graph = new EventGraph();
    const add = (id: EventId, parents: EventId[]): void => {
      graph.addEvent({
        id,
        timestamp: graph.getEventCount(),
        parentVersion: new Set(parents),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: id },
      });
    };

    add("root", []);
    add("a-fork", ["root"]);
    add("z-linear-0", ["root"]);
    add("a-tip-0", ["a-fork"]);
    add("a-tip-1", ["a-fork"]);
    add("z-linear-1", ["z-linear-0"]);
    add("z-linear-2", ["z-linear-1"]);
    add("z-linear-3", ["z-linear-2"]);
    add("merge", ["a-tip-0", "a-tip-1", "z-linear-3"]);
    let previous = "merge";
    for (let index = 0; index < 8; index++) {
      const id = `shared:${index}`;
      add(id, [previous]);
      previous = id;
    }

    expect(branchOrderIds(graph)).toEqual([
      "root",
      "a-fork",
      "a-tip-0",
      "a-tip-1",
      "z-linear-0",
      "z-linear-1",
      "z-linear-2",
      "z-linear-3",
      "merge",
      ...Array.from({ length: 8 }, (_, index) => `shared:${index}`),
    ]);
  });

  it("uses exclusive span through the 1,024-event boundary", () => {
    const ids = branchOrderIds(buildWideVsDeepGraph(1_023));
    expect(ids.slice(0, 4)).toEqual([
      "root",
      "z-deep-0",
      "z-deep-1",
      "z-deep-2",
    ]);
  });

  it("uses longest causal path beyond the exclusive-span boundary", () => {
    const graph = buildWideVsDeepGraph(1_024);
    const ids = branchOrderIds(graph);
    expect(ids.slice(0, 2)).toEqual(["root", "a-wide"]);
    expect(ids.indexOf("z-deep-0")).toBeGreaterThan(
      ids.indexOf("wide-leaf:1023"),
    );
    const codec = new ColumnarEventGraphCodec();
    expect(
      branchOrderIds(codec.decodeBinary(codec.encodeBinary(graph))),
    ).toEqual(ids);
  });

  it("processes merge nodes only once both parents have been visited", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "root",
      timestamp: 0,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
    });
    graph.addEvent({
      id: "L",
      timestamp: 1,
      parentVersion: new Set<EventId>(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    });
    graph.addEvent({
      id: "R",
      timestamp: 2,
      parentVersion: new Set<EventId>(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    });
    graph.addEvent({
      id: "merge",
      timestamp: 3,
      parentVersion: new Set<EventId>(["L", "R"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "M" },
    });

    const ids = graph
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);
    expect(ids).toEqual(["root", "L", "R", "merge"]);
  });

  it("produces a deterministic order regardless of event insertion order", () => {
    const buildGraph = (insertOrder: EventId[]): EventGraph => {
      const definitions: Record<EventId, GraphEvent> = {
        root: {
          id: "root",
          timestamp: 0,
          parentVersion: new Set<EventId>(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
        },
        "a-0": {
          id: "a-0",
          timestamp: 1,
          parentVersion: new Set<EventId>(["root"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "a" },
        },
        "a-1": {
          id: "a-1",
          timestamp: 2,
          parentVersion: new Set<EventId>(["a-0"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "a" },
        },
        "b-0": {
          id: "b-0",
          timestamp: 3,
          parentVersion: new Set<EventId>(["root"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
        },
        "b-1": {
          id: "b-1",
          timestamp: 4,
          parentVersion: new Set<EventId>(["b-0"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "b" },
        },
      };
      const graph = new EventGraph();
      for (const id of insertOrder) {
        graph.addEvent(definitions[id]!);
      }
      return graph;
    };

    // Two valid insertion orders that satisfy the parent-before-child
    // invariant should yield the same topological output. The
    // branch-preserving DFS is a pure function of the underlying DAG,
    // not of how the events were appended.
    const orderA = buildGraph(["root", "a-0", "a-1", "b-0", "b-1"])
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);
    const orderB = buildGraph(["root", "b-0", "b-1", "a-0", "a-1"])
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);
    const orderC = buildGraph(["root", "a-0", "b-0", "a-1", "b-1"])
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);

    expect(orderA).toEqual(["root", "a-0", "a-1", "b-0", "b-1"]);
    expect(orderB).toEqual(orderA);
    expect(orderC).toEqual(orderA);
  });

  it("orders disconnected roots lexicographically", () => {
    const graph = new EventGraph();
    // Two completely independent single-event histories.
    graph.addEvent({
      id: "zeta",
      timestamp: 0,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Z" },
    });
    graph.addEvent({
      id: "alpha",
      timestamp: 1,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
    });

    const ids = graph
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);
    expect(ids).toEqual(["alpha", "zeta"]);
  });

  it("matches Kahn-lex on linear chains and respects causal order", () => {
    // For a single linear chain there is only one valid topological
    // order, so DFS and Kahn must agree byte-for-byte. This guards
    // against accidental divergence on the most common shape.
    const graph = new EventGraph();
    const length = 10;
    for (let i = 0; i < length; i++) {
      graph.addEvent({
        id: `n-${i}`,
        timestamp: i,
        parentVersion:
          i === 0 ? new Set<EventId>() : new Set<EventId>([`n-${i - 1}`]),
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
      });
    }

    const dfs = graph
      .getBranchPreservingTopologicalOrder()
      .map((event) => event.id);
    const kahn = graph.getTopologicalOrder().map((event) => event.id);
    expect(dfs).toEqual(kahn);
  });

  it("keeps object, packed, and packed-plus-tail traversal identical", () => {
    const definitions: GraphEvent[] = [
      {
        id: "root",
        timestamp: 0,
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "r" },
      },
      {
        id: "a-0",
        timestamp: 1,
        parentVersion: new Set(["root"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      },
      {
        id: "a-1",
        timestamp: 2,
        parentVersion: new Set(["a-0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      },
      {
        id: "z-0",
        timestamp: 3,
        parentVersion: new Set(["root"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "z" },
      },
      {
        id: "a-2",
        timestamp: 4,
        parentVersion: new Set(["a-1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      },
      {
        id: "z-1",
        timestamp: 5,
        parentVersion: new Set(["z-0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "z" },
      },
      {
        id: "merge",
        timestamp: 6,
        parentVersion: new Set(["a-2", "z-1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "m" },
      },
    ];
    const objectGraph = new EventGraph();
    for (const event of definitions) objectGraph.addEvent(event);

    const base = new EventGraph();
    for (const event of definitions.slice(0, 4)) base.addEvent(event);
    const codec = new ColumnarEventGraphCodec();
    const mixedGraph = codec.decodeBinary(codec.encodeBinary(base));
    for (const event of definitions.slice(4)) mixedGraph.addEvent(event);
    const packedGraph = codec.decodeBinary(codec.encodeBinary(objectGraph));

    const expected = ["root", "z-0", "z-1", "a-0", "a-1", "a-2", "merge"];
    expect(branchOrderIds(objectGraph)).toEqual(expected);
    expect(branchOrderIds(mixedGraph)).toEqual(expected);
    expect(branchOrderIds(packedGraph)).toEqual(expected);
  });

  it("matches packed traversal and remains topological on deterministic DAGs", () => {
    const codec = new ColumnarEventGraphCodec();

    for (let seed = 1; seed <= 20; seed++) {
      let state = seed;
      const next = (): number => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state;
      };
      const graph = new EventGraph();
      const eventCount = 96;
      for (let index = 0; index < eventCount; index++) {
        const parents = new Set<EventId>();
        if (index > 0) {
          const parentCount = 1 + (next() % Math.min(3, index));
          while (parents.size < parentCount) {
            parents.add(`node:${next() % index}`);
          }
        }
        graph.addEvent({
          id: `node:${index}`,
          timestamp: index,
          parentVersion: parents,
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
        });
      }

      const objectOrder = branchOrderIds(graph);
      const packedOrder = branchOrderIds(
        codec.decodeBinary(codec.encodeBinary(graph)),
      );
      expect(packedOrder).toEqual(objectOrder);

      const rank = new Map(objectOrder.map((id, index) => [id, index]));
      for (const event of graph.iterateEventsInInsertionOrder()) {
        for (const parent of event.parentVersion) {
          expect(rank.get(parent)).toBeLessThan(rank.get(event.id)!);
        }
      }
    }
  });
});
