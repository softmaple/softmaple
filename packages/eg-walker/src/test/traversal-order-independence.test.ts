/**
 * Property tests for sub-issue 5: insertion ordering is now
 * traversal-order independent, concurrent multi-character inserts do
 * not interleave, and {@link compareEventIds} orders event IDs by their
 * numeric `replicaId:sequence` suffix.
 *
 * Each property test randomises something the engine should be robust
 * to (topological order, branching shape, replica count) and asserts
 * the strong list-spec convergence property: every valid topological
 * order of the same DAG produces the same document text.
 */

import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import { compareEventIds } from "../graph/event-id";
import type { EventId, GraphEvent, Version } from "../types";

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const cloneEvent = (event: GraphEvent): GraphEvent => ({
  id: event.id,
  operation: { ...event.operation },
  parentVersion: new Set(event.parentVersion),
  timestamp: event.timestamp,
});

/**
 * Random valid topological order. Maintains a `ready` set of events
 * whose parents are already emitted and picks one uniformly at random.
 */
const randomTopologicalOrder = (
  events: ReadonlyArray<GraphEvent>,
  rand: () => number,
): GraphEvent[] => {
  const byId = new Map(events.map((event) => [event.id, event]));
  const remainingParents = new Map<EventId, number>();
  const children = new Map<EventId, EventId[]>();
  const ready: EventId[] = [];

  for (const event of events) {
    const parents = Array.from(event.parentVersion).filter((parentId) =>
      byId.has(parentId),
    );
    remainingParents.set(event.id, parents.length);
    if (parents.length === 0) {
      ready.push(event.id);
    }
    for (const parentId of parents) {
      const list = children.get(parentId) ?? [];
      list.push(event.id);
      children.set(parentId, list);
    }
  }

  const order: GraphEvent[] = [];
  while (ready.length > 0) {
    const pickIndex = Math.floor(rand() * ready.length);
    const chosenId = ready.splice(pickIndex, 1)[0]!;
    const chosen = byId.get(chosenId);
    if (!chosen) {
      throw new Error(`Unknown event ${chosenId}`);
    }
    order.push(chosen);
    for (const childId of children.get(chosenId) ?? []) {
      const remaining = (remainingParents.get(childId) ?? 0) - 1;
      remainingParents.set(childId, remaining);
      if (remaining === 0) {
        ready.push(childId);
      }
    }
  }

  if (order.length !== events.length) {
    throw new Error("Cycle detected while shuffling topological order");
  }
  return order;
};

/**
 * Build a graph by feeding shuffled events into a fresh
 * {@link EventGraph}. The engine relies on `eventGraph` for transitive
 * version diffs, so the graph must be reconstructed per shuffle.
 */
const generateFromShuffledOrder = (
  events: ReadonlyArray<GraphEvent>,
  rand: () => number,
): string => {
  const order = randomTopologicalOrder(events, rand).map(cloneEvent);
  const graph = new EventGraph();
  for (const event of order) {
    graph.addEvent(event);
  }
  return new EgWalkerEngine().generate(order, "", { eventGraph: graph }).text;
};

interface BuiltGraph {
  readonly events: ReadonlyArray<GraphEvent>;
  readonly canonicalText: string;
}

const buildCanonical = (events: ReadonlyArray<GraphEvent>): BuiltGraph => {
  const graph = new EventGraph();
  for (const event of events.map(cloneEvent)) {
    graph.addEvent(event);
  }
  const text = new EgWalkerEngine().generate(graph.getTopologicalOrder(), "", {
    eventGraph: graph,
  }).text;
  return { events, canonicalText: text };
};

const concurrentRootInserts = (count: number): GraphEvent[] => {
  const events: GraphEvent[] = [
    {
      id: "root:0",
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "_" },
      timestamp: 0,
    },
  ];
  for (let i = 0; i < count; i++) {
    const replica = String.fromCharCode("a".charCodeAt(0) + i);
    events.push({
      id: `${replica}:0`,
      parentVersion: new Set(["root:0"]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: replica.toUpperCase(),
      },
      timestamp: i + 1,
    });
  }
  return events;
};

const multiCharConcurrentInserts = (): GraphEvent[] => [
  {
    id: "root:0",
    parentVersion: new Set<EventId>(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "XY" },
    timestamp: 0,
  },
  {
    id: "alice:0",
    parentVersion: new Set(["root:0"]),
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "abc" },
    timestamp: 1,
  },
  {
    id: "bob:0",
    parentVersion: new Set(["root:0"]),
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "PQR" },
    timestamp: 2,
  },
];

const diamondHistory = (): GraphEvent[] => {
  const baseSet: Version = new Set(["root:0"]);
  return [
    {
      id: "root:0",
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "hello" },
      timestamp: 0,
    },
    {
      id: "alice:0",
      parentVersion: baseSet,
      operation: { type: OPERATION_TYPE.INSERT, index: 5, text: " world" },
      timestamp: 1,
    },
    {
      id: "bob:0",
      parentVersion: baseSet,
      operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
      timestamp: 2,
    },
    {
      id: "carol:0",
      parentVersion: new Set(["alice:0", "bob:0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "H" },
      timestamp: 3,
    },
  ];
};

/**
 * Random branching DAG: starts with a shared root, then forks into
 * `branchCount` chains where each chain repeatedly inserts a character
 * at a random index. Branches occasionally merge by extending an event
 * whose parent set contains two branch frontiers.
 */
const randomBranchingHistory = (
  rand: () => number,
  branchCount: number,
  depth: number,
): GraphEvent[] => {
  const events: GraphEvent[] = [];
  events.push({
    id: "root:0",
    parentVersion: new Set<EventId>(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "*" },
    timestamp: 0,
  });

  const frontiers: EventId[][] = Array.from({ length: branchCount }, () => [
    "root:0",
  ]);

  let counter = 1;
  for (let level = 0; level < depth; level++) {
    for (let branch = 0; branch < branchCount; branch++) {
      const replica = `r${branch}`;
      const mergeWith =
        branchCount > 1 && rand() < 0.15
          ? Math.floor(rand() * branchCount)
          : branch;
      const parents = new Set<EventId>(frontiers[branch]);
      if (mergeWith !== branch) {
        for (const id of frontiers[mergeWith] ?? []) {
          parents.add(id);
        }
      }
      const id = `${replica}:${level}`;
      const text = String.fromCharCode(
        "A".charCodeAt(0) + ((counter - 1) % 26),
      );
      events.push({
        id,
        parentVersion: parents,
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text },
        timestamp: counter,
      });
      counter++;
      frontiers[branch] = [id];
      if (mergeWith !== branch) {
        frontiers[mergeWith] = [id];
      }
    }
  }
  return events;
};

const isMultiCharRunContiguous = (text: string, fragment: string): boolean => {
  if (fragment.length <= 1) {
    return true;
  }
  return text.includes(fragment);
};

describe("EgWalkerEngine traversal-order independence", () => {
  it("converges on the same text across all valid topological orders of N concurrent root inserts", () => {
    const events = concurrentRootInserts(5);
    const canonical = buildCanonical(events);
    const rand = createPrng(0xfeed_face);

    const observed = new Set<string>([canonical.canonicalText]);
    for (let trial = 0; trial < 50; trial++) {
      observed.add(generateFromShuffledOrder(events, rand));
    }

    expect(observed.size).toBe(1);
    // YATA tie-break: lower event id first, so the underscored root
    // ends up between the alphabetically ordered concurrent chars.
    expect(canonical.canonicalText).toBe("ABCDE_");
  });

  it("converges on a diamond history regardless of traversal order", () => {
    const events = diamondHistory();
    const canonical = buildCanonical(events);
    const rand = createPrng(0xc0ff_ee);

    const observed = new Set<string>([canonical.canonicalText]);
    for (let trial = 0; trial < 60; trial++) {
      observed.add(generateFromShuffledOrder(events, rand));
    }
    expect(observed.size).toBe(1);
  });

  it("keeps concurrent multi-character inserts non-interleaving", () => {
    const events = multiCharConcurrentInserts();
    const canonical = buildCanonical(events);
    const rand = createPrng(0xbeef_0042);

    const observed = new Set<string>([canonical.canonicalText]);
    for (let trial = 0; trial < 60; trial++) {
      observed.add(generateFromShuffledOrder(events, rand));
    }

    expect(observed.size).toBe(1);
    // Both inserts land at root index 1, so the text must keep the
    // shared X / Y around the merged middle run.
    expect(canonical.canonicalText.startsWith("X")).toBe(true);
    expect(canonical.canonicalText.endsWith("Y")).toBe(true);
    // Neither alice's "abc" nor bob's "PQR" may interleave.
    expect(isMultiCharRunContiguous(canonical.canonicalText, "abc")).toBe(true);
    expect(isMultiCharRunContiguous(canonical.canonicalText, "PQR")).toBe(true);
  });

  it("converges across many shuffles of a random branching history", () => {
    const rand = createPrng(0x1234_5678);
    for (let scenario = 0; scenario < 5; scenario++) {
      const events = randomBranchingHistory(rand, 3 + (scenario % 2), 4);
      const canonical = buildCanonical(events);
      const observed = new Set<string>([canonical.canonicalText]);
      for (let trial = 0; trial < 40; trial++) {
        observed.add(generateFromShuffledOrder(events, rand));
      }
      expect(observed.size).toBe(1);
    }
  });
});

describe("compareEventIds (sub-issue 5 numeric suffix tie-break)", () => {
  it("orders r1:10 after r1:2 numerically", () => {
    expect(compareEventIds("r1:2", "r1:10")).toBeLessThan(0);
    expect(compareEventIds("r1:10", "r1:2")).toBeGreaterThan(0);
    expect(compareEventIds("r1:10", "r1:10")).toBe(0);
  });

  it("sorts a mixed-suffix series in ascending numeric order", () => {
    const ids: EventId[] = ["r1:1", "r1:11", "r1:2", "r1:20", "r1:3"];
    const sorted = [...ids].sort(compareEventIds);
    expect(sorted).toEqual(["r1:1", "r1:2", "r1:3", "r1:11", "r1:20"]);
  });

  it("compares replicas lexicographically before sequence numbers", () => {
    expect(compareEventIds("alice:99", "bob:1")).toBeLessThan(0);
    expect(compareEventIds("bob:1", "alice:99")).toBeGreaterThan(0);
  });

  it("falls back to lexicographic ordering for non-numeric suffixes", () => {
    expect(compareEventIds("rev-a", "rev-b")).toBeLessThan(0);
    expect(compareEventIds("r1:abc", "r1:abd")).toBeLessThan(0);
    expect(compareEventIds("r1:abc", "r1:abc")).toBe(0);
  });

  it("keeps concurrent inserts under double-digit sequence numbers stable", () => {
    // Sub-issue 5 cited `r1:10` vs `r1:2` as the canonical regression:
    // before this fix the engine's bucket lookup tied them with
    // lexicographic ordering, which inverted the YATA tie-break for
    // any replica that crosses ten events between checkpoints.
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Z" },
        timestamp: 0,
      },
      {
        id: "r1:2",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
        timestamp: 1,
      },
      {
        id: "r1:10",
        parentVersion: new Set(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 2,
      },
    ];
    const canonical = buildCanonical(events);
    const rand = createPrng(0xdead_beef);
    const observed = new Set<string>([canonical.canonicalText]);
    for (let trial = 0; trial < 32; trial++) {
      observed.add(generateFromShuffledOrder(events, rand));
    }
    expect(observed.size).toBe(1);
    // r1:2 has the smaller numeric suffix, so B is integrated before
    // A. Lexicographic ordering would have placed `r1:10` first
    // ("0" < "2"), producing "ABZ" instead.
    expect(canonical.canonicalText).toBe("BAZ");
  });
});
