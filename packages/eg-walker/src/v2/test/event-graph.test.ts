import { OPERATION_TYPE } from "../constants/operation-types";
import { describe, it, expect } from "vitest";
import type { GraphEvent, EventId, SerializedEventGraph } from "../types";
import { EventGraph } from "../graph/event-graph";

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

      // This would create a cycle: event-1 -> event-3 -> event-2 -> event-1
      const cyclicEvent: GraphEvent = {
        id: "event-1", // Same ID as first event
        timestamp: 400,
        parentVersion: new Set<EventId>(["event-3"]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 3,
          text: "D",
        },
      };

      graph.addEvent(event1);
      graph.addEvent(event2);
      graph.addEvent(event3);

      expect(() => graph.addEvent(cyclicEvent)).toThrow();
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
  });

  describe("getTopologicalOrder", () => {
    it("should return events in topological order", () => {
      const graph = new EventGraph();

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

      // Add in random order
      graph.addEvent(event3);
      graph.addEvent(event1);
      graph.addEvent(event2);

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

      expect(serialized.version.size).toBe(2); // Should have 2 events
      expect(serialized.events).toHaveLength(2);

      const newGraph = EventGraph.deserialize(serialized);

      expect(newGraph.hasEvent("event-1")).toBe(true);
      expect(newGraph.hasEvent("event-2")).toBe(true);
      expect(newGraph.getEvent("event-2")?.parentVersion.has("event-1")).toBe(
        true,
      );
    });

    it("should validate version during deserialization", () => {
      const invalidData: SerializedEventGraph = {
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
       metadata: { customField: "test-value" }
     };

     const newGraph = EventGraph.deserialize(modifiedSerialized);
     const reSerialized = newGraph.serialize();

     expect(reSerialized.metadata?.customField).toBe("test-value");
   });
  });
});
