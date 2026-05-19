import { describe, it, expect, vi } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { EventId } from "../types";
import { EventGraph } from "../graph/event-graph";
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

    // Spy on getParents so we can observe how many distinct events the
    // diff walks. Only the 10 branch events plus the shared tip need to
    // be visited; the 499 pre-tip events MUST remain untouched.
    const getParents = graph.getParents.bind(graph);
    const spy = vi.spyOn(graph, "getParents").mockImplementation((id) => {
      return getParents(id);
    });

    const diff = graph.diffVersions(
      new Set([left[left.length - 1]!]),
      new Set([right[right.length - 1]!]),
    );

    expect(diff.onlyInLeft).toEqual(new Set(left));
    expect(diff.onlyInRight).toEqual(new Set(right));

    const visited = new Set<EventId>();
    for (const call of spy.mock.calls) {
      visited.add(call[0] as EventId);
    }
    // Only the 10 branch events should have their parents looked up; the
    // shared tip and earlier prefix events are never popped because the
    // traversal terminates as soon as both branches converge. This is
    // dramatically smaller than the total graph size of 510.
    expect(visited.size).toBeLessThanOrEqual(10);
    for (let i = 0; i < 100; i++) {
      // None of the deep ancestors should have been touched.
      expect(visited.has(ids[i]!)).toBe(false);
    }

    spy.mockRestore();
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

    const getParents = graph.getParents.bind(graph);
    const spy = vi.spyOn(graph, "getParents").mockImplementation((id) => {
      return getParents(id);
    });

    const diff = graph.diffVersions(new Set(["L-tip"]), new Set(["R-tip"]));
    expect(diff).toEqual({
      onlyInLeft: new Set(["L-tip"]),
      onlyInRight: new Set(["R-tip"]),
    });

    const visited = new Set<EventId>();
    for (const call of spy.mock.calls) {
      visited.add(call[0] as EventId);
    }
    // Only the two tips and the shared prefix tip are popped from the
    // heap; the merge-base bookkeeping prevents walking into the deeper
    // prefix once both branches converge on `tip`.
    expect(visited.has("L-tip")).toBe(true);
    expect(visited.has("R-tip")).toBe(true);
    expect(visited.size).toBeLessThanOrEqual(3);
    expect(visited.has(ids[0]!)).toBe(false);

    spy.mockRestore();
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
});
