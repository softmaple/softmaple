import { describe, it, expect } from "vitest";
import type { Event, SerializedEventGraph } from "../types";
import { EventGraph } from "../graph/event-graph";

describe("EventGraph", () => {
  describe("addEvent", () => {
    it("should add events and track dependencies", () => {
      const graph = new EventGraph();

      const event1: Event = {
        id: "event-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: "insert",
          index: 0,
          text: "Hello",
          eventId: "event-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      const event2: Event = {
        id: "event-2",
        authorId: "bob",
        timestamp: 200,
        parentIds: ["event-1"],
        operation: {
          type: "insert",
          index: 5,
          text: "World",
          eventId: "event-2",
          authorId: "bob",
          timestamp: 200,
        },
      };

      graph.addEvent(event1);
      graph.addEvent(event2);

      expect(graph.hasEvent("event-1")).toBe(true);
      expect(graph.hasEvent("event-2")).toBe(true);
      expect(graph.getEvent("event-2")?.parentIds).toContain("event-1");
    });

    it("should detect and reject cycles", () => {
      const graph = new EventGraph();

      const event1: Event = {
        id: "event-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: "insert",
          index: 0,
          text: "A",
          eventId: "event-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      const event2: Event = {
        id: "event-2",
        authorId: "bob",
        timestamp: 200,
        parentIds: ["event-1"],
        operation: {
          type: "insert",
          index: 1,
          text: "B",
          eventId: "event-2",
          authorId: "bob",
          timestamp: 200,
        },
      };

      const event3: Event = {
        id: "event-3",
        authorId: "charlie",
        timestamp: 300,
        parentIds: ["event-2"],
        operation: {
          type: "insert",
          index: 2,
          text: "C",
          eventId: "event-3",
          authorId: "charlie",
          timestamp: 300,
        },
      };

      // This would create a cycle: event-1 -> event-3 -> event-2 -> event-1
      const cyclicEvent: Event = {
        id: "event-1", // Same ID as first event
        authorId: "alice",
        timestamp: 400,
        parentIds: ["event-3"],
        operation: {
          type: "insert",
          index: 3,
          text: "D",
          eventId: "event-1",
          authorId: "alice",
          timestamp: 400,
        },
      };

      graph.addEvent(event1);
      graph.addEvent(event2);
      graph.addEvent(event3);

      expect(() => graph.addEvent(cyclicEvent)).toThrow();
    });

    it("should prevent duplicate event IDs", () => {
      const graph = new EventGraph();

      const event1: Event = {
        id: "event-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: "insert",
          index: 0,
          text: "A",
          eventId: "event-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      const duplicateEvent: Event = {
        id: "event-1", // Same ID
        authorId: "bob",
        timestamp: 200,
        parentIds: [],
        operation: {
          type: "insert",
          index: 1,
          text: "B",
          eventId: "event-1",
          authorId: "bob",
          timestamp: 200,
        },
      };

      graph.addEvent(event1);
      expect(() => graph.addEvent(duplicateEvent)).toThrow(
        "Event event-1 already exists",
      );
    });
  });

  describe("getTopologicalOrder", () => {
    it("should return events in topological order", () => {
      const graph = new EventGraph();

      const event3: Event = {
        id: "event-3",
        authorId: "charlie",
        timestamp: 300,
        parentIds: ["event-1", "event-2"],
        operation: {
          type: "insert",
          index: 2,
          text: "C",
          eventId: "event-3",
          authorId: "charlie",
          timestamp: 300,
        },
      };

      const event1: Event = {
        id: "event-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: "insert",
          index: 0,
          text: "A",
          eventId: "event-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      const event2: Event = {
        id: "event-2",
        authorId: "bob",
        timestamp: 200,
        parentIds: ["event-1"],
        operation: {
          type: "insert",
          index: 1,
          text: "B",
          eventId: "event-2",
          authorId: "bob",
          timestamp: 200,
        },
      };

      // Add in random order
      graph.addEvent(event3);
      graph.addEvent(event1);
      graph.addEvent(event2);

      const ordered = graph.getTopologicalOrder();

      expect(ordered).toHaveLength(3);
      expect(ordered[0].id).toBe("event-1"); // No dependencies
      expect(ordered[1].id).toBe("event-2"); // Depends on event-1
      expect(ordered[2].id).toBe("event-3"); // Depends on event-1 and event-2
    });

    it("should handle concurrent events correctly", () => {
      const graph = new EventGraph();

      const root: Event = {
        id: "root",
        authorId: "system",
        timestamp: 0,
        parentIds: [],
        operation: {
          type: "insert",
          index: 0,
          text: "",
          eventId: "root",
          authorId: "system",
          timestamp: 0,
        },
      };

      const concurrent1: Event = {
        id: "concurrent-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: ["root"],
        operation: {
          type: "insert",
          index: 0,
          text: "A",
          eventId: "concurrent-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      const concurrent2: Event = {
        id: "concurrent-2",
        authorId: "bob",
        timestamp: 100,
        parentIds: ["root"],
        operation: {
          type: "insert",
          index: 0,
          text: "B",
          eventId: "concurrent-2",
          authorId: "bob",
          timestamp: 100,
        },
      };

      graph.addEvent(root);
      graph.addEvent(concurrent1);
      graph.addEvent(concurrent2);

      const ordered = graph.getTopologicalOrder();

      expect(ordered[0].id).toBe("root");
      // concurrent1 and concurrent2 can be in any order, but both after root
      expect(ordered.slice(1).map((e) => e.id)).toContain("concurrent-1");
      expect(ordered.slice(1).map((e) => e.id)).toContain("concurrent-2");
    });
  });

  describe("areConcurrent", () => {
    it("should detect concurrent events", () => {
      const graph = new EventGraph();

      const root: Event = {
        id: "root",
        authorId: "system",
        timestamp: 0,
        parentIds: [],
        operation: {
          type: "insert",
          index: 0,
          text: "",
          eventId: "root",
          authorId: "system",
          timestamp: 0,
        },
      };

      const event1: Event = {
        id: "event-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: ["root"],
        operation: {
          type: "insert",
          index: 0,
          text: "A",
          eventId: "event-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      const event2: Event = {
        id: "event-2",
        authorId: "bob",
        timestamp: 100,
        parentIds: ["root"],
        operation: {
          type: "insert",
          index: 0,
          text: "B",
          eventId: "event-2",
          authorId: "bob",
          timestamp: 100,
        },
      };

      const event3: Event = {
        id: "event-3",
        authorId: "charlie",
        timestamp: 200,
        parentIds: ["event-1"],
        operation: {
          type: "insert",
          index: 1,
          text: "C",
          eventId: "event-3",
          authorId: "charlie",
          timestamp: 200,
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

      const event1: Event = {
        id: "event-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: "insert",
          index: 0,
          text: "Hello",
          eventId: "event-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      const event2: Event = {
        id: "event-2",
        authorId: "bob",
        timestamp: 200,
        parentIds: ["event-1"],
        operation: {
          type: "insert",
          index: 5,
          text: "World",
          eventId: "event-2",
          authorId: "bob",
          timestamp: 200,
        },
      };

      graph.addEvent(event1);
      graph.addEvent(event2);

      const serialized = graph.serialize();

      expect(serialized.version).toBe("1.0");
      expect(serialized.events).toHaveLength(2);

      const newGraph = EventGraph.deserialize(serialized);

      expect(newGraph.hasEvent("event-1")).toBe(true);
      expect(newGraph.hasEvent("event-2")).toBe(true);
      expect(newGraph.getEvent("event-2")?.parentIds).toContain("event-1");
    });

    it("should validate version during deserialization", () => {
      const invalidData: SerializedEventGraph = {
        version: "2.0", // Unsupported version
        events: [],
        metadata: {},
      };

      expect(() => EventGraph.deserialize(invalidData)).toThrow(
        "Unsupported version: 2.0",
      );
    });

    it("should preserve metadata during serialization", () => {
      const graph = new EventGraph();

      const event: Event = {
        id: "event-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: "insert",
          index: 0,
          text: "Test",
          eventId: "event-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      graph.addEvent(event);

      const serialized = graph.serialize();
      serialized.metadata = { customField: "test-value" };

      const newGraph = EventGraph.deserialize(serialized);
      const reSerialized = newGraph.serialize();

      expect(reSerialized.metadata.customField).toBe("test-value");
    });
  });
});
