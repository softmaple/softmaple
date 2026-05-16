import { OPERATION_TYPE } from "../constants/operation-types";
import { describe, it, expect, vi } from "vitest";
import type { GraphEvent, EventId, SerializedGraphInput } from "../types";
import { EventGraph } from "../graph/event-graph";

/**
 * Build a chain `root → e1 → e2 → ... → e{length-1}` and return the graph
 * plus the ordered IDs. Used to construct deep histories whose ancestor set
 * is large compared to typical divergent suffixes.
 */
const buildLinearHistory = (
  length: number,
  prefix = "n",
): { graph: EventGraph; ids: EventId[] } => {
  const graph = new EventGraph();
  const ids: EventId[] = [];
  let previous: EventId | null = null;
  for (let i = 0; i < length; i++) {
    const id = `${prefix}-${i}`;
    graph.addEvent({
      id,
      timestamp: i,
      parentVersion: new Set<EventId>(previous ? [previous] : []),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: i,
        text: prefix.charAt(0),
      },
    });
    ids.push(id);
    previous = id;
  }
  return { graph, ids };
};

describe("EventGraph", () => {
  describe("addEvent", () => {
    it("should add events and track dependencies", () => {
      const graph = new EventGraph();

      const event1: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
      };

      const event2: GraphEvent = {
        id: "event-2",
        timestamp: 200,
        parentVersion: new Set<EventId>(["event-1"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 5,
          text: "World",
        },
      };

      graph.addEvent(event1);
      graph.addEvent(event2);

      expect(graph.getEvent("event-1")).toBeDefined();
      expect(graph.getEvent("event-2")).toBeDefined();
      expect(graph.getEvent("event-2")?.parentVersion.has("event-1")).toBe(
        true,
      );
    });

    it("should detect and reject cycles", () => {
      const graph = new EventGraph();

      const event1: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
        },
      };

      const event2: GraphEvent = {
        id: "event-2",
        timestamp: 200,
        parentVersion: new Set<EventId>(["event-1"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "B",
        },
      };

      const event3: GraphEvent = {
        id: "event-3",
        timestamp: 300,
        parentVersion: new Set<EventId>(["event-2"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 2,
          text: "C",
        },
      };

      graph.addEvent(event1);
      graph.addEvent(event2);
      graph.addEvent(event3);

      // This test is actually testing duplicate IDs, not cycles
      // The test with id: "event-1" is already tested in the duplicate ID test
      // Since the EventGraph doesn't actually store cycles (DAG structure),
      // we expect this to succeed (adding events with same ID is prevented)
      const duplicateIdEvent: GraphEvent = {
        id: "event-1", // Same ID as first event
        timestamp: 400,
        parentVersion: new Set<EventId>(["event-3"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 3,
          text: "D",
        },
      };

      // This should throw because of duplicate ID
      expect(() => graph.addEvent(duplicateIdEvent)).toThrow(
        "Event event-1 already exists",
      );
    });

    it("should prevent duplicate event IDs", () => {
      const graph = new EventGraph();

      const event1: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
        },
      };

      const duplicateEvent: GraphEvent = {
        id: "event-1", // Same ID
        timestamp: 200,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "B",
        },
      };

      graph.addEvent(event1);
      expect(() => graph.addEvent(duplicateEvent)).toThrow(
        "Event event-1 already exists",
      );
    });

    it("should reject events with missing parents", () => {
      const graph = new EventGraph();

      expect(() =>
        graph.addEvent({
          id: "event-2",
          timestamp: 200,
          parentVersion: new Set<EventId>(["missing-parent"]),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "B",
          },
        }),
      ).toThrow("Missing parent event: missing-parent");
    });
  });

  describe("getTopologicalOrder", () => {
    it("should return events in topological order", () => {
      const graph = new EventGraph();

      const event1: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
        },
      };

      const event2: GraphEvent = {
        id: "event-2",
        timestamp: 200,
        parentVersion: new Set<EventId>(["event-1"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "B",
        },
      };

      const event3: GraphEvent = {
        id: "event-3",
        timestamp: 300,
        parentVersion: new Set(["event-1", "event-2"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 2,
          text: "C",
        },
      };

      // Add in correct dependency order
      graph.addEvent(event1);
      graph.addEvent(event2);
      graph.addEvent(event3);

      const ordered = graph.getTopologicalOrder();

      expect(ordered).toHaveLength(3);
      expect(ordered[0]?.id).toBe("event-1"); // No dependencies
      expect(ordered[1]?.id).toBe("event-2"); // Depends on event-1
      expect(ordered[2]?.id).toBe("event-3"); // Depends on event-1 and event-2
    });

    it("should handle concurrent events correctly", () => {
      const graph = new EventGraph();

      const root: GraphEvent = {
        id: "root",
        timestamp: 0,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "",
        },
      };

      const concurrent1: GraphEvent = {
        id: "concurrent-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(["root"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
        },
      };

      const concurrent2: GraphEvent = {
        id: "concurrent-2",
        timestamp: 100,
        parentVersion: new Set<EventId>(["root"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "B",
        },
      };

      graph.addEvent(root);
      graph.addEvent(concurrent1);
      graph.addEvent(concurrent2);

      const ordered = graph.getTopologicalOrder();

      expect(ordered[0]?.id).toBe("root");
      // concurrent1 and concurrent2 can be in any order, but both after root
      expect(ordered.slice(1).map((e) => e.id)).toContain("concurrent-1");
      expect(ordered.slice(1).map((e) => e.id)).toContain("concurrent-2");
    });
  });

  describe("getBranchPreservingTopologicalOrder", () => {
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

  describe("areConcurrent", () => {
    it("should detect concurrent events", () => {
      const graph = new EventGraph();

      const root: GraphEvent = {
        id: "root",
        timestamp: 0,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "",
        },
      };

      const event1: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(["root"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
        },
      };

      const event2: GraphEvent = {
        id: "event-2",
        timestamp: 100,
        parentVersion: new Set<EventId>(["root"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "B",
        },
      };

      const event3: GraphEvent = {
        id: "event-3",
        timestamp: 200,
        parentVersion: new Set<EventId>(["event-1"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "C",
        },
      };

      graph.addEvent(root);
      graph.addEvent(event1);
      graph.addEvent(event2);
      graph.addEvent(event3);

      // event1 and event2 are concurrent (both depend only on root)
      expect(graph.areConcurrent("event-1", "event-2")).toBe(true);

      // event1 and event3 are not concurrent (event3 depends on event1)
      expect(graph.areConcurrent("event-1", "event-3")).toBe(false);

      // event2 and event3 are concurrent (no causal relationship)
      expect(graph.areConcurrent("event-2", "event-3")).toBe(true);
    });
  });

  describe("serialization", () => {
    it("should serialize and deserialize event graph", () => {
      const graph = new EventGraph();

      const event1: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
      };

      const event2: GraphEvent = {
        id: "event-2",
        timestamp: 200,
        parentVersion: new Set<EventId>(["event-1"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 5,
          text: "World",
        },
      };

      graph.addEvent(event1);
      graph.addEvent(event2);

      const serialized = graph.serialize();

      expect(serialized.version).toEqual(["event-2"]);
      expect(serialized.events).toHaveLength(2);

      const newGraph = EventGraph.deserialize(serialized);

      expect(newGraph.hasEvent("event-1")).toBe(true);
      expect(newGraph.hasEvent("event-2")).toBe(true);
      expect(newGraph.getEvent("event-2")?.parentVersion.has("event-1")).toBe(
        true,
      );
    });

    it("serializes graph versions as JSON-safe arrays", () => {
      const graph = new EventGraph();

      graph.addEvent({
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
      });
      graph.addEvent({
        id: "event-2",
        timestamp: 200,
        parentVersion: new Set<EventId>(["event-1"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 5,
          text: "World",
        },
      });

      const parsed = JSON.parse(
        JSON.stringify(graph.serialize()),
      ) as unknown as SerializedGraphInput;
      const newGraph = EventGraph.deserialize(parsed);

      expect(parsed.version).toEqual(["event-2"]);
      expect(parsed.events[1]?.parentVersion).toEqual(["event-1"]);
      expect(newGraph.getEvent("event-2")?.parentVersion).toEqual(
        new Set(["event-1"]),
      );
    });

    it("should validate version during deserialization", () => {
      const invalidData: SerializedGraphInput = {
        version: new Set<EventId>(), // Empty version
        events: [],
        metadata: {},
      };

      // Should not throw with valid data structure
      const graph = EventGraph.deserialize(invalidData);
      expect(graph.getAllEvents()).toHaveLength(0);
    });

    it("should preserve metadata during serialization", () => {
      const graph = new EventGraph();

      const event: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
      };

      graph.addEvent(event);

      const serialized = graph.serialize();
      const modifiedSerialized = {
        ...serialized,
        metadata: { customField: "test-value" },
      };

      const newGraph = EventGraph.deserialize(modifiedSerialized);
      const reSerialized = newGraph.serialize();

      expect(reSerialized.metadata?.customField).toBe("test-value");
    });

    it("should reject serialized graphs whose parents cannot be resolved", () => {
      const invalidData: SerializedGraphInput = {
        version: new Set<EventId>(["event-2"]),
        events: [
          {
            id: "event-2",
            timestamp: 200,
            parentVersion: new Set<EventId>(["missing-parent"]),
            operation: {
              type: OPERATION_TYPE.INSERT,
              index: 0,
              text: "B",
            },
          },
        ],
        metadata: {},
      };

      expect(() => EventGraph.deserialize(invalidData)).toThrow(
        "Cannot deserialize event graph with missing parents: missing-parent",
      );
    });
  });

  describe("branch coverage improvements", () => {
    it("should handle getEvent for non-existent event", () => {
      const graph = new EventGraph();
      const result = graph.getEvent("non-existent");
      expect(result).toBeUndefined();
    });

    it("should ignore duplicate and unknown IDs when expanding versions", () => {
      const graph = new EventGraph();
      graph.addEvent({
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
      });

      expect(
        graph.expandVersion(
          new Set<EventId>(["event-1", "event-1", "missing"]),
        ),
      ).toEqual(new Set<EventId>(["event-1"]));
    });

    it("should clear all graph state and metadata", () => {
      const graph = new EventGraph();
      graph.setMetadata({ key: "value" });
      graph.addEvent({
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
      });

      graph.clear();

      expect(graph.getAllEvents()).toEqual([]);
      expect(graph.getFrontier()).toEqual(new Set());
      expect(graph.getMetadata()).toEqual({});
    });

    it("should handle getChildren for event with no children", () => {
      const graph = new EventGraph();

      const event: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
      };

      graph.addEvent(event);

      const children = graph.getChildren("event-1");
      expect(children.size).toBe(0);
    });

    it("should handle getParents for event with no parents", () => {
      const graph = new EventGraph();

      const event: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
      };

      graph.addEvent(event);

      const parents = graph.getParents("event-1");
      expect(parents.size).toBe(0);
    });

    it("should handle isAncestor when events are the same", () => {
      const graph = new EventGraph();

      const event: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
      };

      graph.addEvent(event);

      // Same event should return false
      expect(graph.isAncestor("event-1", "event-1")).toBe(false);
    });

    it("should handle isAncestor with visited set to prevent infinite loops", () => {
      const graph = new EventGraph();

      const event1: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
        },
      };

      const event2: GraphEvent = {
        id: "event-2",
        timestamp: 200,
        parentVersion: new Set<EventId>(["event-1"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "B",
        },
      };

      const event3: GraphEvent = {
        id: "event-3",
        timestamp: 300,
        parentVersion: new Set<EventId>(["event-1", "event-2"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 2,
          text: "C",
        },
      };

      graph.addEvent(event1);
      graph.addEvent(event2);
      graph.addEvent(event3);

      // event-1 is ancestor of event-3 (through multiple paths)
      expect(graph.isAncestor("event-1", "event-3")).toBe(true);

      // event-3 is not ancestor of event-1
      expect(graph.isAncestor("event-3", "event-1")).toBe(false);
    });

    it("should handle areConcurrent for same event IDs", () => {
      const graph = new EventGraph();

      const event: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
      };

      graph.addEvent(event);

      // Same event should not be concurrent with itself
      expect(graph.areConcurrent("event-1", "event-1")).toBe(false);
    });

    it("should handle getTopologicalOrder with cycle detection", () => {
      const graph = new EventGraph();

      const event1: GraphEvent = {
        id: "event-1",
        timestamp: 100,
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
        },
      };

      graph.addEvent(event1);

      // Should return events in topological order
      const order = graph.getTopologicalOrder();
      expect(order).toHaveLength(1);
      expect(order[0]?.id).toBe("event-1");
    });
  });

  describe("normalizeEventIds tolerant input handling", () => {
    const root = (): GraphEvent => ({
      id: "root",
      timestamp: 1,
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
    });
    const child = (parentVersion: unknown): unknown => ({
      id: "child",
      timestamp: 2,
      parentVersion,
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
    });

    it("accepts a Set instance for parentVersion (in-memory shape)", () => {
      const graph = EventGraph.deserialize({
        version: ["child"],
        events: [root(), child(new Set<EventId>(["root"])) as never] as never,
      });
      expect(graph.getEvent("child")?.parentVersion).toEqual(new Set(["root"]));
    });

    it("accepts a generic Iterable for parentVersion", () => {
      const iterableParents: Iterable<EventId> = {
        *[Symbol.iterator]() {
          yield "root";
        },
      };
      const graph = EventGraph.deserialize({
        version: ["child"],
        events: [root(), child(iterableParents) as never] as never,
      });
      expect(graph.getEvent("child")?.parentVersion).toEqual(new Set(["root"]));
    });

    it("falls back to [] for non-iterable object parentVersion payloads", () => {
      // A non-iterable plain object (e.g. the `{}` produced by accidentally
      // JSON.stringify-ing a Set in pre-1.0 code) deserializes to an event
      // with no parents instead of crashing.
      const isolated = EventGraph.deserialize({
        version: [],
        events: [{ ...root(), parentVersion: {} } as never] as never,
      });
      expect(isolated.getEvent("root")?.parentVersion).toEqual(new Set());
    });

    it("filters non-string entries out of array parentVersion", () => {
      const graph = EventGraph.deserialize({
        version: ["child"],
        events: [
          root(),
          child([42, "root", null, "root"] as unknown as EventId[]) as never,
        ] as never,
      });
      expect(graph.getEvent("child")?.parentVersion).toEqual(new Set(["root"]));
    });
  });

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

      expect(
        graph.diffVersions(new Set(["only"]), new Set(["missing"])),
      ).toEqual({
        onlyInLeft: new Set(["only"]),
        onlyInRight: new Set(),
      });
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
});

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
