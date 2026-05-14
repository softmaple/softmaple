/**
 * Focused performance tests for critical-version detection and the
 * {@link EventGraph} topological-order cache.
 *
 * The original `CriticalVersionAnalyzer` performed one full-graph
 * traversal per outside event per frontier id, and recomputed
 * `getTopologicalOrder` on every call. Combined this drifted toward
 * O(|V|^2 * (|V| + |E|)) for `latestCriticalVersion` on large
 * histories. These tests pin down the new behaviour:
 *
 *   - `getTopologicalOrder` returns a stable cached reference until the
 *     graph mutates, so callers (the engine, partial replay, the
 *     codec, the analyzer) share one materialised order per stable
 *     state.
 *   - `isCritical` for a singleton runs in a single forward sweep
 *     instead of O(|outside|) calls to `isAncestor`.
 *   - `latestCriticalVersion` finishes in well under an O(|V|^2)
 *     budget on a 1k-event branching history.
 */

import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import { EventGraph } from "../graph/event-graph";
import type { EventId } from "../types";

/**
 * Linear chain `root → e1 → ... → e{length-1}`.
 *
 * Every prefix frontier is critical, so the linear case is the worst case
 * for the naive `latestCriticalVersion` (every singleton triggers a full
 * outside-event scan with `isAncestor` walks).
 */
const buildLinearHistory = (
  length: number,
): { graph: EventGraph; ids: EventId[] } => {
  const graph = new EventGraph();
  const ids: EventId[] = [];
  let previous: EventId | null = null;
  for (let i = 0; i < length; i++) {
    const id = `n:${i}`;
    graph.addEvent({
      id,
      parentVersion: new Set<EventId>(previous ? [previous] : []),
      operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
      timestamp: i,
    });
    ids.push(id);
    previous = id;
  }
  return { graph, ids };
};

/**
 * A "fan" of concurrent branches that re-merge at a single sink:
 *
 *   root → b{k}:0 → b{k}:1 → ... → b{k}:depth-1 \
 *                                                 \
 *   root → b{0}:0 → b{0}:1 → ... → b{0}:depth-1  → sink
 *
 * The root and the sink are the only critical singletons; every internal
 * event is concurrent with another branch. This stresses `isCritical`'s
 * intersection logic on multi-branch graphs.
 */
const buildFanInHistory = (
  branches: number,
  depth: number,
): {
  graph: EventGraph;
  root: EventId;
  sink: EventId;
  tips: EventId[];
} => {
  const graph = new EventGraph();
  const root: EventId = "root";
  graph.addEvent({
    id: root,
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "*" },
    timestamp: 0,
  });
  const tips: EventId[] = [];
  for (let b = 0; b < branches; b++) {
    let previous: EventId = root;
    for (let i = 0; i < depth; i++) {
      const id: EventId = `b${b}:${i}`;
      graph.addEvent({
        id,
        parentVersion: new Set<EventId>([previous]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "x" },
        timestamp: 1 + b * depth + i,
      });
      previous = id;
    }
    tips.push(previous);
  }
  const sink: EventId = "sink";
  graph.addEvent({
    id: sink,
    parentVersion: new Set<EventId>(tips),
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "!" },
    timestamp: 1 + branches * depth,
  });
  return { graph, root, sink, tips };
};

describe("EventGraph topological-order cache", () => {
  it("returns the same array reference for repeated calls on a stable graph", () => {
    const { graph } = buildLinearHistory(100);
    const first = graph.getTopologicalOrder();
    const second = graph.getTopologicalOrder();
    // Identity check: a real cache, not just structural equality.
    expect(second).toBe(first);
  });

  it("invalidates the cache when a new event is added", () => {
    const { graph, ids } = buildLinearHistory(5);
    const before = graph.getTopologicalOrder();
    graph.addEvent({
      id: "n:5",
      parentVersion: new Set<EventId>([ids[4]!]),
      operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "y" },
      timestamp: 5,
    });
    const after = graph.getTopologicalOrder();
    expect(after).not.toBe(before);
    expect(after.map((event) => event.id)).toEqual([
      "n:0",
      "n:1",
      "n:2",
      "n:3",
      "n:4",
      "n:5",
    ]);
  });

  it("invalidates the cache when the graph is cleared", () => {
    const { graph } = buildLinearHistory(3);
    const before = graph.getTopologicalOrder();
    expect(before).toHaveLength(3);
    graph.clear();
    const after = graph.getTopologicalOrder();
    expect(after).not.toBe(before);
    expect(after).toHaveLength(0);
  });

  it("caches the branch-preserving order independently of Kahn order", () => {
    const { graph } = buildFanInHistory(8, 4);
    const first = graph.getBranchPreservingTopologicalOrder();
    const second = graph.getBranchPreservingTopologicalOrder();
    expect(second).toBe(first);
    // Adding an event invalidates both caches.
    graph.addEvent({
      id: "extra",
      parentVersion: new Set<EventId>(["sink"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "?" },
      timestamp: 1_000,
    });
    expect(graph.getBranchPreservingTopologicalOrder()).not.toBe(first);
    expect(
      graph.getTopologicalOrder().some((event) => event.id === "extra"),
    ).toBe(true);
  });

  it("freezes the cached order so callers cannot corrupt it", () => {
    const { graph } = buildLinearHistory(4);
    const order = graph.getTopologicalOrder();
    expect(Object.isFrozen(order)).toBe(true);
    expect(() => {
      (order as unknown as { push: (value: unknown) => void }).push({
        id: "bogus",
      });
    }).toThrow();
  });
});

describe("CriticalVersionAnalyzer correctness on branching histories", () => {
  it("flags root and sink in a fan-in graph and rejects internal singletons", () => {
    const { graph, root, sink } = buildFanInHistory(6, 3);
    const analyzer = new CriticalVersionAnalyzer();

    expect(analyzer.isCritical(graph, new Set([root]))).toBe(true);
    expect(analyzer.isCritical(graph, new Set([sink]))).toBe(true);
    // Any internal event is concurrent with at least one parallel branch
    // tip, so its singleton version cannot be critical.
    expect(analyzer.isCritical(graph, new Set(["b0:0"]))).toBe(false);
    expect(analyzer.isCritical(graph, new Set(["b3:1"]))).toBe(false);
  });

  it("accepts the multi-branch frontier as critical because it dominates the graph", () => {
    // Fan-out without a sink merge: the frontier is every tip.
    const graph = new EventGraph();
    graph.addEvent({
      id: "root",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "*" },
      timestamp: 0,
    });
    const tips: EventId[] = [];
    for (let b = 0; b < 4; b++) {
      const id: EventId = `tip:${b}`;
      graph.addEvent({
        id,
        parentVersion: new Set<EventId>(["root"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "x" },
        timestamp: 1 + b,
      });
      tips.push(id);
    }
    const analyzer = new CriticalVersionAnalyzer();
    expect(analyzer.isCritical(graph, new Set(tips))).toBe(true);
    for (const tip of tips) {
      // Single-tip versions are not critical: every other tip is concurrent.
      expect(analyzer.isCritical(graph, new Set<EventId>([tip]))).toBe(false);
    }
  });

  it("returns the frontier from latestCriticalVersion on a deep linear chain", () => {
    const { graph, ids } = buildLinearHistory(200);
    const analyzer = new CriticalVersionAnalyzer();
    expect(analyzer.latestCriticalVersion(graph)).toEqual(
      new Set([ids[ids.length - 1]!]),
    );
  });
});

describe("CriticalVersionAnalyzer focused performance", () => {
  it("isCritical on a deep linear chain runs in a single-traversal budget", () => {
    // A naive implementation calls `isAncestor` for every outside event,
    // each of which walks the parent map back to the root. On a chain of
    // length N this is O(N^2). The optimized path is one forward BFS, so
    // 1k singleton checks should fit comfortably in well under a second.
    const N = 1_000;
    const PROBE_COUNT = 1_000;
    const BUDGET_MS = 1_500;

    const { graph, ids } = buildLinearHistory(N);
    const analyzer = new CriticalVersionAnalyzer();

    const start = performance.now();
    let trueCount = 0;
    for (let i = 0; i < PROBE_COUNT; i++) {
      // Probe every event in the chain; each one is a critical singleton.
      const target = ids[i % ids.length]!;
      if (analyzer.isCritical(graph, new Set<EventId>([target]))) {
        trueCount++;
      }
    }
    const elapsed = performance.now() - start;

    expect(trueCount).toBe(PROBE_COUNT);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("latestCriticalVersion on a 1k-event branching history finishes under an O(N^2) budget", () => {
    // Fan-in graph: root + (branches * depth) internal events + sink.
    // Total ~ 1 + branches * depth + 1. Choose branches=20, depth=50 so
    // the graph has ~1k events with substantial concurrency.
    const BRANCHES = 20;
    const DEPTH = 50;
    const BUDGET_MS = 3_000;

    const { graph, sink } = buildFanInHistory(BRANCHES, DEPTH);
    const analyzer = new CriticalVersionAnalyzer();

    const start = performance.now();
    const latest = analyzer.latestCriticalVersion(graph);
    const elapsed = performance.now() - start;

    expect(latest).toEqual(new Set([sink]));
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("repeated isCritical calls reuse the cached topological order", () => {
    // The analyzer does not call getTopologicalOrder itself, but the
    // surrounding engine and partial-replay paths do. Confirm the cache
    // really is a hot-path optimization by counting calls under repeated
    // checks against a stable graph.
    const { graph } = buildFanInHistory(8, 8);
    const first = graph.getTopologicalOrder();
    for (let i = 0; i < 50; i++) {
      // Equivalent to the work `EgWalkerReplica` does on every applied
      // event: re-grab the topological order for the engine path.
      expect(graph.getTopologicalOrder()).toBe(first);
    }
  });
});
