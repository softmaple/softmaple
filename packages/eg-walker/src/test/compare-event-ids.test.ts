import { describe, expect, it } from "vitest";
import {
  compareEventIds,
  compareEventIdSortKeys,
  createEventIdSortKey,
  parseEventId,
} from "../graph/event-id";
import type { EventId, GraphEvent } from "../types";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { EventGraph } from "../graph/event-graph";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { cloneEvent, createPrng } from "./test-helpers";

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

const buildCanonical = (
  events: ReadonlyArray<GraphEvent>,
): { events: ReadonlyArray<GraphEvent>; canonicalText: string } => {
  const graph = new EventGraph();
  for (const event of events.map(cloneEvent)) {
    graph.addEvent(event);
  }
  const text = new EgWalkerEngine().generate(graph.getTopologicalOrder(), "", {
    eventGraph: graph,
  }).text;
  return { events, canonicalText: text };
};

describe("compareEventIds (numeric suffix tie-break)", () => {
  it("parses the canonical sequence boundaries", () => {
    expect(parseEventId("replica:0")).toEqual({
      replicaId: "replica",
      sequence: 0,
    });
    expect(parseEventId("team:replica:42")).toEqual({
      replicaId: "team:replica",
      sequence: 42,
    });
    expect(parseEventId("replica:9007199254740991")).toEqual({
      replicaId: "replica",
      sequence: Number.MAX_SAFE_INTEGER,
    });
  });

  it("rejects non-canonical and unsafe sequence suffixes", () => {
    const invalidIds: EventId[] = [
      "replica",
      ":0",
      "replica:",
      "replica:00",
      "replica:01",
      "replica:+1",
      "replica:-1",
      "replica:1.0",
      "replica:1e2",
      "replica: 1",
      "replica:1 ",
      "replica:\u0661",
      "replica:\uff11",
      "replica:9007199254740992",
      "replica:99999999999999999999999999999999999999999999999999",
    ];

    for (const id of invalidIds) {
      expect(parseEventId(id), id).toBeNull();
    }
  });

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

  it("defines a transitive total order across canonical and custom IDs", () => {
    // Arrange
    const ids: EventId[] = ["a:1x", "a:10", "a:2"];

    // Act
    const sorted = [...ids].sort(compareEventIds);

    // Assert
    expect(sorted).toEqual(["a:2", "a:10", "a:1x"]);
    expect(compareEventIds("a:2", "a:10")).toBeLessThan(0);
    expect(compareEventIds("a:10", "a:1x")).toBeLessThan(0);
    expect(compareEventIds("a:2", "a:1x")).toBeLessThan(0);
  });

  it("keeps cached sort keys identical to direct comparison", () => {
    const ids: EventId[] = [
      "alice:0",
      "alice:2",
      "alice:10",
      "bob:1",
      "custom",
      "alice:01",
      "alice:unsafe9007199254740992",
    ];
    for (const left of ids) {
      for (const right of ids) {
        expect(
          Math.sign(
            compareEventIdSortKeys(
              createEventIdSortKey(left),
              createEventIdSortKey(right),
            ),
          ),
        ).toBe(Math.sign(compareEventIds(left, right)));
      }
    }
  });

  it("keeps mixed-ID concurrent inserts convergent across delivery orders", () => {
    // Arrange
    const events: GraphEvent[] = [
      {
        id: "a:2",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 0,
      },
      {
        id: "a:10",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
        timestamp: 1,
      },
      {
        id: "a:1x",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "C" },
        timestamp: 2,
      },
    ];
    const deliveryOrders = [
      events,
      [events[1]!, events[2]!, events[0]!],
      [events[2]!, events[0]!, events[1]!],
      [events[0]!, events[2]!, events[1]!],
      [events[1]!, events[0]!, events[2]!],
      [events[2]!, events[1]!, events[0]!],
    ];

    // Act
    const observed = new Set(
      deliveryOrders.map((order) => {
        const replica = new EgWalkerReplica("mixed-id-order");
        order.forEach((event) => replica.applyRemoteEvent(cloneEvent(event)));
        return replica.getText();
      }),
    );

    // Assert
    expect(observed).toEqual(new Set(["ABC"]));
  });

  it("keeps concurrent inserts under double-digit sequence numbers stable", () => {
    // `r1:10` vs `r1:2` is the canonical regression: a plain
    // lexicographic compare would tie them in the wrong order, which
    // inverts the YATA tie-break for any replica that crosses ten
    // events between checkpoints.
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
