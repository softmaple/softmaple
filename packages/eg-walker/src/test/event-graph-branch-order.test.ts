import { describe, it, expect } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { EventId, GraphEvent } from "../types";
import { EventGraph } from "../graph/event-graph";

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

  it("walks a deeper branch before continuing to a sibling subtree", () => {
    // The DFS heuristic walks the lex-smallest ready event next, but
    // does so depth-first: once we start a-0 we should descend into
    // a-0 → a-1 → a-2 before popping the deferred b-0.
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
    expect(ids).toEqual(["root", "a-0", "a-1", "a-2", "b-0"]);
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
});
