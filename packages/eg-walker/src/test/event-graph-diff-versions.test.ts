import { describe, it, expect, vi } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { EventId } from "../types";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { PackedEventGraphBase } from "../graph/internals/packed-event-graph-base";
import { buildLinearHistory } from "./test-helpers";

/**
 * Deterministic pseudo-random generator (mulberry32). Used to drive the
 * randomised diff property test above without depending on global RNG state.
 */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % 0x7fffffff;
  };
};

const packGraph = (graph: EventGraph): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(graph));
};

describe("diffVersions topological diff", () => {
  it("returns empty sets when both versions are identical", () => {
    const { graph, ids } = buildLinearHistory(5);
    const tip = new Set([ids[ids.length - 1]!]);
    expect(graph.diffVersions(tip, tip)).toEqual({
      onlyInLeft: new Set(),
      onlyInRight: new Set(),
    });
  });

  it("classifies a one-sided advance against a shared prefix", () => {
    const { graph, ids } = buildLinearHistory(4);
    // left = ids[1], right = ids[3] (descendant of left)
    const left = new Set([ids[1]!]);
    const right = new Set([ids[3]!]);
    expect(graph.diffVersions(left, right)).toEqual({
      onlyInLeft: new Set(),
      onlyInRight: new Set([ids[2]!, ids[3]!]),
    });
  });

  it("classifies symmetric divergent branches sharing a root", () => {
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
      parentVersion: new Set(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    });
    graph.addEvent({
      id: "R",
      timestamp: 2,
      parentVersion: new Set(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    });

    expect(graph.diffVersions(new Set(["L"]), new Set(["R"]))).toEqual({
      onlyInLeft: new Set(["L"]),
      onlyInRight: new Set(["R"]),
    });
  });

  it("handles diamond merges by classifying the merge floor as common", () => {
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
      parentVersion: new Set(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    });
    graph.addEvent({
      id: "R",
      timestamp: 2,
      parentVersion: new Set(["root"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    });
    graph.addEvent({
      id: "merge",
      timestamp: 3,
      parentVersion: new Set(["L", "R"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "M" },
    });

    // The merge sees both branches as common ancestors; comparing it
    // against either tip leaves only the merge node on its side.
    expect(graph.diffVersions(new Set(["merge"]), new Set(["L"]))).toEqual({
      onlyInLeft: new Set(["merge", "R"]),
      onlyInRight: new Set(),
    });
  });

  it("treats unknown event IDs as a no-op (defensive parity with expandVersion)", () => {
    const graph = new EventGraph();
    graph.addEvent({
      id: "only",
      timestamp: 0,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "X" },
    });

    expect(graph.diffVersions(new Set(["only"]), new Set(["missing"]))).toEqual(
      {
        onlyInLeft: new Set(["only"]),
        onlyInRight: new Set(),
      },
    );
    expect(
      graph.diffVersions(new Set(["missing-1"]), new Set(["missing-2"])),
    ).toEqual({
      onlyInLeft: new Set(),
      onlyInRight: new Set(),
    });
  });

  it("bounds work to the divergent region for deep histories with small branches", () => {
    // Build a 500-event shared prefix...
    const { graph, ids } = buildLinearHistory(500);
    const tip = ids[ids.length - 1]!;

    // ...then fork two 5-event branches off the tip.
    const branch = (prefix: string): EventId[] => {
      const branchIds: EventId[] = [];
      let previous = tip;
      for (let i = 0; i < 5; i++) {
        const id = `${prefix}-${i}`;
        graph.addEvent({
          id,
          timestamp: 1000 + i,
          parentVersion: new Set([previous]),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 500 + i,
            text: prefix.charAt(0),
          },
        });
        branchIds.push(id);
        previous = id;
      }
      return branchIds;
    };

    const left = branch("L");
    const right = branch("R");

    const diff = graph.diffVersions(
      new Set([left[left.length - 1]!]),
      new Set([right[right.length - 1]!]),
    );

    expect(diff.onlyInLeft).toEqual(new Set(left));
    expect(diff.onlyInRight).toEqual(new Set(right));

    // Only the 10 branch events should have their parents looked up; the
    // shared tip and earlier prefix events are never popped because the
    // traversal terminates as soon as both branches converge. This is
    // dramatically smaller than the total graph size of 510.
    expect(graph.getLastObjectDiffTraversalCount()).toBeLessThanOrEqual(10);
  });

  it("does not traverse beyond the merge base when comparing concurrent tips", () => {
    // Shared prefix of 50 events...
    const { graph, ids } = buildLinearHistory(50, "p");
    const tip = ids[ids.length - 1]!;

    // ...with two concurrent single-event tips off the prefix.
    graph.addEvent({
      id: "L-tip",
      timestamp: 100,
      parentVersion: new Set([tip]),
      operation: { type: OPERATION_TYPE.INSERT, index: 50, text: "L" },
    });
    graph.addEvent({
      id: "R-tip",
      timestamp: 101,
      parentVersion: new Set([tip]),
      operation: { type: OPERATION_TYPE.INSERT, index: 50, text: "R" },
    });

    const diff = graph.diffVersions(new Set(["L-tip"]), new Set(["R-tip"]));
    expect(diff).toEqual({
      onlyInLeft: new Set(["L-tip"]),
      onlyInRight: new Set(["R-tip"]),
    });

    // Only the two tips and the shared prefix tip are popped from the
    // heap; the merge-base bookkeeping prevents walking into the deeper
    // prefix once both branches converge on `tip`.
    expect(graph.getLastObjectDiffTraversalCount()).toBe(2);
  });

  it("matches expandVersion-based diff results on randomised graphs", () => {
    const rng = mulberry32(0xc0ffee);
    const graph = new EventGraph();
    const ids: EventId[] = [];

    // Seed root.
    graph.addEvent({
      id: "n-0",
      timestamp: 0,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "0" },
    });
    ids.push("n-0");

    for (let i = 1; i < 120; i++) {
      const parentCount = (rng() % 3) + 1;
      const parents = new Set<EventId>();
      for (let p = 0; p < parentCount; p++) {
        parents.add(ids[rng() % ids.length]!);
      }
      const id = `n-${i}`;
      graph.addEvent({
        id,
        timestamp: i,
        parentVersion: parents,
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
      });
      ids.push(id);
    }

    const referenceDiff = (
      left: ReadonlySet<EventId>,
      right: ReadonlySet<EventId>,
    ): { onlyInLeft: Set<EventId>; onlyInRight: Set<EventId> } => {
      const expanded = (frontier: ReadonlySet<EventId>): Set<EventId> => {
        const out = new Set<EventId>();
        const stack: EventId[] = [...frontier];
        while (stack.length > 0) {
          const id = stack.pop()!;
          if (out.has(id) || !graph.hasEvent(id)) continue;
          out.add(id);
          for (const parent of graph.getParents(id)) {
            stack.push(parent);
          }
        }
        return out;
      };
      const leftExpanded = expanded(left);
      const rightExpanded = expanded(right);
      const onlyInLeft = new Set<EventId>();
      const onlyInRight = new Set<EventId>();
      for (const id of leftExpanded) {
        if (!rightExpanded.has(id)) onlyInLeft.add(id);
      }
      for (const id of rightExpanded) {
        if (!leftExpanded.has(id)) onlyInRight.add(id);
      }
      return { onlyInLeft, onlyInRight };
    };

    for (let trial = 0; trial < 30; trial++) {
      const left = new Set<EventId>([ids[rng() % ids.length]!]);
      const right = new Set<EventId>([ids[rng() % ids.length]!]);
      const expected = referenceDiff(left, right);
      const actual = graph.diffVersions(left, right);
      expect(actual.onlyInLeft).toEqual(expected.onlyInLeft);
      expect(actual.onlyInRight).toEqual(expected.onlyInRight);
    }
  });

  it("matches the object oracle for immutable packed DAG frontiers", () => {
    const rng = mulberry32(0x51a7e);
    const graph = new EventGraph();
    const ids: EventId[] = [];

    for (let index = 0; index < 180; index++) {
      const id = index % 3 === 0 ? `replica:${index}` : `custom#${index}`;
      const parents = new Set<EventId>();
      if (index > 0) {
        const parentCount = (rng() % 3) + 1;
        for (let parent = 0; parent < parentCount; parent++) {
          parents.add(ids[rng() % ids.length]!);
        }
      }
      graph.addEvent({
        id,
        timestamp: index,
        parentVersion: parents,
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "x",
        },
      });
      ids.push(id);
    }

    const packed = packGraph(graph);
    const packedParentIterator = vi.spyOn(packed, "iterateParents");
    for (let trial = 0; trial < 80; trial++) {
      const version = (side: string): Set<EventId> => {
        const result = new Set<EventId>();
        const width = rng() % 4;
        for (let index = 0; index < width; index++) {
          result.add(ids[rng() % ids.length]!);
        }
        if (trial % 5 === 0) result.add(`unknown-${side}-${trial}`);
        return result;
      };
      const left = version("left");
      const right = version("right");

      expect(packed.diffVersions(left, right)).toEqual(
        graph.diffVersions(left, right),
      );
    }

    // The immutable packed path must not fall through to string-ID parent
    // iterators; mixed/object graphs continue to exercise that oracle.
    expect(packedParentIterator).not.toHaveBeenCalled();
  });

  it("uses packed linear offsets until a mutable tail requires the object path", () => {
    const source = buildLinearHistory(4, "mixed").graph;
    const packed = packGraph(source);
    const packedParentIterator = vi.spyOn(packed, "iterateParents");

    expect(
      packed.diffVersions(new Set(["mixed-3"]), new Set(["mixed-1"])),
    ).toEqual(source.diffVersions(new Set(["mixed-3"]), new Set(["mixed-1"])));
    expect(packedParentIterator).not.toHaveBeenCalled();

    const tail = {
      id: "tail",
      timestamp: 4,
      parentVersion: new Set<EventId>(["mixed-3"]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 4,
        text: "t",
      } as const,
    };
    source.addEvent(tail);
    packed.addEvent(tail);
    packedParentIterator.mockClear();

    expect(
      packed.diffVersions(new Set(["tail"]), new Set(["mixed-1"])),
    ).toEqual(source.diffVersions(new Set(["tail"]), new Set(["mixed-1"])));
    expect(packedParentIterator).toHaveBeenCalled();
  });

  it("isolates re-entrant packed queries and resets scratch state after errors", () => {
    const { graph } = buildLinearHistory(1, "shared");
    graph.addEvent({
      id: "left",
      timestamp: 1,
      parentVersion: new Set(["shared-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    });
    graph.addEvent({
      id: "right",
      timestamp: 2,
      parentVersion: new Set(["shared-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    });
    const packed = packGraph(graph);

    let nestedDiff: ReturnType<EventGraph["diffVersions"]> | undefined;
    class ReentrantVersion extends Set<EventId> {
      private entered = false;

      override *[Symbol.iterator](): SetIterator<EventId> {
        if (!this.entered) {
          this.entered = true;
          nestedDiff = packed.diffVersions(
            new Set(["right"]),
            new Set(["left"]),
          );
        }
        yield* super[Symbol.iterator]();
      }
    }

    expect(
      packed.diffVersions(new ReentrantVersion(["left"]), new Set(["right"])),
    ).toEqual({
      onlyInLeft: new Set(["left"]),
      onlyInRight: new Set(["right"]),
    });
    expect(nestedDiff).toEqual({
      onlyInLeft: new Set(["right"]),
      onlyInRight: new Set(["left"]),
    });

    class ThrowOnceVersion extends Set<EventId> {
      private failed = false;

      override *[Symbol.iterator](): SetIterator<EventId> {
        for (const id of super[Symbol.iterator]()) {
          yield id;
          if (!this.failed) {
            this.failed = true;
            throw new Error("iterator failed");
          }
        }
      }
    }

    expect(() =>
      packed.diffVersions(new ThrowOnceVersion(["left"]), new Set(["right"])),
    ).toThrow("iterator failed");
    expect(packed.diffVersions(new Set(["left"]), new Set(["right"]))).toEqual({
      onlyInLeft: new Set(["left"]),
      onlyInRight: new Set(["right"]),
    });
  });

  it("isolates re-entrant object queries and resets numeric scratch state", () => {
    const { graph } = buildLinearHistory(1, "shared-object");
    graph.addEvent({
      id: "object-left",
      timestamp: 1,
      parentVersion: new Set(["shared-object-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    });
    graph.addEvent({
      id: "object-right",
      timestamp: 2,
      parentVersion: new Set(["shared-object-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    });

    let nestedDiff: ReturnType<EventGraph["diffVersions"]> | undefined;
    class ReentrantVersion extends Set<EventId> {
      private entered = false;

      override *[Symbol.iterator](): SetIterator<EventId> {
        if (!this.entered) {
          this.entered = true;
          nestedDiff = graph.diffVersions(
            new Set(["object-right"]),
            new Set(["object-left"]),
          );
        }
        yield* super[Symbol.iterator]();
      }
    }

    expect(
      graph.diffVersions(
        new ReentrantVersion(["object-left"]),
        new Set(["object-right"]),
      ),
    ).toEqual({
      onlyInLeft: new Set(["object-left"]),
      onlyInRight: new Set(["object-right"]),
    });
    expect(nestedDiff).toEqual({
      onlyInLeft: new Set(["object-right"]),
      onlyInRight: new Set(["object-left"]),
    });

    class ThrowOnceVersion extends Set<EventId> {
      private failed = false;

      override *[Symbol.iterator](): SetIterator<EventId> {
        for (const id of super[Symbol.iterator]()) {
          yield id;
          if (!this.failed) {
            this.failed = true;
            throw new Error("object iterator failed");
          }
        }
      }
    }

    expect(() =>
      graph.diffVersions(
        new ThrowOnceVersion(["object-left"]),
        new Set(["object-right"]),
      ),
    ).toThrow("object iterator failed");
    expect(
      graph.diffVersions(new Set(["object-left"]), new Set(["object-right"])),
    ).toEqual({
      onlyInLeft: new Set(["object-left"]),
      onlyInRight: new Set(["object-right"]),
    });
  });

  it("restores multi-parent rank storage after failed and rolled-back appends", () => {
    const { graph } = buildLinearHistory(1, "rank-root");
    graph.addEvent({
      id: "rank-left",
      timestamp: 1,
      parentVersion: new Set(["rank-root-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    });
    graph.addEvent({
      id: "rank-right",
      timestamp: 2,
      parentVersion: new Set(["rank-root-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    });

    expect(() =>
      graph.addEvent({
        id: "failed-merge",
        timestamp: 3,
        parentVersion: new Set(["rank-left", "missing-parent"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "F" },
      }),
    ).toThrow("missing-parent");

    const transaction = graph.beginAppendTransaction();
    graph.addEvent({
      id: "rolled-back-merge",
      timestamp: 4,
      parentVersion: new Set(["rank-left", "rank-right"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "M" },
    });
    graph.addEvent({
      id: "rolled-back-tail",
      timestamp: 5,
      parentVersion: new Set(["rolled-back-merge"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "T" },
    });
    transaction.rollback();

    expect(graph.hasEvent("failed-merge")).toBe(false);
    expect(graph.hasEvent("rolled-back-merge")).toBe(false);
    expect(graph.hasEvent("rolled-back-tail")).toBe(false);

    graph.addEvent({
      id: "stable-merge",
      timestamp: 6,
      parentVersion: new Set(["rank-right", "rank-left"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "S" },
    });
    expect(
      graph.diffVersions(new Set(["stable-merge"]), new Set(["rank-left"])),
    ).toEqual({
      onlyInLeft: new Set(["stable-merge", "rank-right"]),
      onlyInRight: new Set(),
    });
  });

  it("derives parent-rank sidecars from the stored defensive copy", () => {
    const { graph } = buildLinearHistory(1, "copy-root");
    graph.addEvent({
      id: "copy-left",
      timestamp: 1,
      parentVersion: new Set(["copy-root-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    });
    graph.addEvent({
      id: "copy-right",
      timestamp: 2,
      parentVersion: new Set(["copy-root-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    });

    class ChangingParents extends Set<EventId> {
      iterations = 0;

      override *[Symbol.iterator](): SetIterator<EventId> {
        this.iterations++;
        yield "copy-left";
        if (this.iterations > 1) {
          yield "copy-right";
        }
      }
    }

    const parents = new ChangingParents(["copy-left", "copy-right"]);
    graph.addEvent({
      id: "copied-child",
      timestamp: 3,
      parentVersion: parents,
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
    });

    expect(parents.iterations).toBe(1);
    expect(graph.getParents("copied-child")).toEqual(new Set(["copy-left"]));
    expect(
      graph.diffVersions(new Set(["copied-child"]), new Set(["copy-left"])),
    ).toEqual({
      onlyInLeft: new Set(["copied-child"]),
      onlyInRight: new Set(),
    });
  });

  it("isolates re-entrant ranked replay orders and resets after errors", () => {
    const { graph } = buildLinearHistory(1, "order-root");
    graph.addEvent({
      id: "order-left",
      timestamp: 1,
      parentVersion: new Set(["order-root-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
    });
    graph.addEvent({
      id: "order-right",
      timestamp: 2,
      parentVersion: new Set(["order-root-0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
    });
    graph.addEvent({
      id: "order-merge",
      timestamp: 3,
      parentVersion: new Set(["order-left", "order-right"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "M" },
    });

    let nestedOrder: ReadonlyArray<EventId> | null | undefined;
    class ReentrantReplaySet extends Set<EventId> {
      private entered = false;

      override *[Symbol.iterator](): SetIterator<EventId> {
        if (!this.entered) {
          this.entered = true;
          nestedOrder = graph.getRankedReplayOrder(
            new Set(["order-right", "order-left"]),
          );
        }
        yield* super[Symbol.iterator]();
      }
    }

    expect(
      graph.getRankedReplayOrder(
        new ReentrantReplaySet(["order-left", "order-right", "order-merge"]),
      ),
    ).toEqual(["order-left", "order-right", "order-merge"]);
    expect(nestedOrder).toEqual(["order-left", "order-right"]);

    class ThrowOnceReplaySet extends Set<EventId> {
      private failed = false;

      override *[Symbol.iterator](): SetIterator<EventId> {
        for (const id of super[Symbol.iterator]()) {
          yield id;
          if (!this.failed) {
            this.failed = true;
            throw new Error("replay iterator failed");
          }
        }
      }
    }

    expect(() =>
      graph.getRankedReplayOrder(
        new ThrowOnceReplaySet(["order-left", "order-right"]),
      ),
    ).toThrow("replay iterator failed");
    expect(
      graph.getRankedReplayOrder(
        new Set(["order-left", "order-right", "order-merge"]),
      ),
    ).toEqual(["order-left", "order-right", "order-merge"]);
  });

  it("stops packed CSR traversal at a deep shared-history boundary", () => {
    const { graph, ids } = buildLinearHistory(20_000, "deep");
    const sharedTip = ids[ids.length - 1]!;
    graph.addEvent({
      id: "deep-left",
      timestamp: 20_000,
      parentVersion: new Set([sharedTip]),
      operation: { type: OPERATION_TYPE.INSERT, index: 20_000, text: "L" },
    });
    graph.addEvent({
      id: "deep-right",
      timestamp: 20_001,
      parentVersion: new Set([sharedTip]),
      operation: { type: OPERATION_TYPE.INSERT, index: 20_000, text: "R" },
    });
    const packed = packGraph(graph);
    const parentOffsetAt = vi.spyOn(
      PackedEventGraphBase.prototype,
      "parentOffsetAt",
    );

    try {
      expect(
        packed.diffVersions(
          new Set(["deep-left", "unknown-left"]),
          new Set(["deep-right", "unknown-right"]),
        ),
      ).toEqual({
        onlyInLeft: new Set(["deep-left"]),
        onlyInRight: new Set(["deep-right"]),
      });

      // Each branch tip contributes one parent edge. The common offset is
      // painted from both sides but never popped, so none of the 20k shared
      // ancestors are traversed.
      expect(parentOffsetAt).toHaveBeenCalledTimes(2);

      parentOffsetAt.mockClear();
      expect(
        packed.diffVersions(new Set(["deep-left"]), new Set(["deep-left"])),
      ).toEqual({ onlyInLeft: new Set(), onlyInRight: new Set() });
      expect(parentOffsetAt).not.toHaveBeenCalled();

      // A second divergent query proves the reused colour workspace was
      // cleared rather than leaking COMMON markings from the first call.
      expect(
        packed.diffVersions(new Set(["deep-right"]), new Set(["deep-left"])),
      ).toEqual({
        onlyInLeft: new Set(["deep-right"]),
        onlyInRight: new Set(["deep-left"]),
      });
      expect(parentOffsetAt).toHaveBeenCalledTimes(2);

      // Cold replay drops scratch memory together with its traversal caches;
      // the next packed query lazily creates a clean workspace again.
      packed.releaseTraversalCaches();
      parentOffsetAt.mockClear();
      expect(
        packed.diffVersions(new Set(["deep-left"]), new Set(["deep-right"])),
      ).toEqual({
        onlyInLeft: new Set(["deep-left"]),
        onlyInRight: new Set(["deep-right"]),
      });
      expect(parentOffsetAt).toHaveBeenCalledTimes(2);
    } finally {
      parentOffsetAt.mockRestore();
    }
  });
});
