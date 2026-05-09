import { describe, it, expect } from "vitest";
import { EgWalkerAPI, createEgWalker } from "../core/external-api";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EventAlreadyExistsError } from "../graph/event-graph";
import type { GraphEvent, SerializedGraph } from "../types";

describe("EgWalkerAPI", () => {
  describe("insert", () => {
    it("should insert text at valid index", () => {
      const api = new EgWalkerAPI("r1", "");
      api.insert(0, "Hello");
      expect(api.getText()).toBe("Hello");
    });

    it("should insert text in middle of document", () => {
      const api = new EgWalkerAPI("r1", "Hello World");
      api.insert(5, " Beautiful");
      expect(api.getText()).toBe("Hello Beautiful World");
    });

    it("should handle empty insert as no-op", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      api.insert(2, "");
      expect(api.getText()).toBe("Hello");
    });

    it("should throw error for negative index", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      expect(() => api.insert(-1, "x")).toThrow("Index -1 out of bounds");
    });

    it("should throw error for index beyond document length", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      expect(() => api.insert(10, "x")).toThrow("Index 10 out of bounds");
    });
  });

  describe("delete", () => {
    it("should delete text at valid index", () => {
      const api = new EgWalkerAPI("r1", "Hello World");
      api.delete(5, 6);
      expect(api.getText()).toBe("Hello");
    });

    it("should handle zero-length delete as no-op", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      api.delete(2, 0);
      expect(api.getText()).toBe("Hello");
    });

    it("should handle negative length delete as no-op", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      api.delete(2, -1);
      expect(api.getText()).toBe("Hello");
    });

    it("should throw error for negative index", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      expect(() => api.delete(-1, 2)).toThrow("Index -1 out of bounds");
    });

    it("should throw error when delete range exceeds document length", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      expect(() => api.delete(3, 5)).toThrow(
        "Delete range [3, 8) exceeds document length 5",
      );
    });
  });

  describe("getDocument", () => {
    it("should return document state with text", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      const state = api.getDocument();
      expect(state.text).toBe("Hello");
    });
  });

  describe("getText", () => {
    it("should return current text", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      expect(api.getText()).toBe("Hello");
    });

    it("should return README-compatible document state text", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      expect(api.getDocumentState()).toBe("Hello");
    });
  });

  describe("serialize/deserialize", () => {
    it("should serialize document state", () => {
      const api = new EgWalkerAPI("r1", "Hello");
      api.insert(5, " World");
      const serialized = api.serialize();
      expect(serialized.text).toBe("Hello World");
      expect(serialized.eventGraph).toBeDefined();
    });

    it("should deserialize document state", () => {
      const api = EgWalkerAPI.deserialize({
        text: "Hello",
        eventGraph: null as unknown as SerializedGraph,
      });
      expect(api.getText()).toBe("Hello");
    });
  });

  describe("duplicate event handling", () => {
    it("ignores duplicate local events without throwing", () => {
      const api = new EgWalkerAPI("r1", "");
      // @ts-expect-error - swap eventGraph.addEvent for the duplicate branch
      const originalAddEvent = api.eventGraph.addEvent.bind(api.eventGraph);
      // @ts-expect-error - same
      api.eventGraph.addEvent = (event: GraphEvent) => {
        throw new EventAlreadyExistsError(event.id);
      };

      expect(() => api.insert(0, "Hello")).not.toThrow();
      expect(api.getText()).toBe("");

      // @ts-expect-error - restore
      api.eventGraph.addEvent = originalAddEvent;
    });

    it("ignores duplicate remote events without throwing", () => {
      const api = new EgWalkerAPI("r1", "");
      const event: GraphEvent = {
        id: "remote:1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
        timestamp: Date.now(),
      };

      api.applyRemoteEvent(event);
      expect(api.getText()).toBe("Hello");

      expect(() => api.applyRemoteEvent(event)).not.toThrow();
      expect(api.getText()).toBe("Hello");
    });
  });

  describe("exportEventGraph", () => {
    it("should export all events", () => {
      const api = new EgWalkerAPI("r1", "");
      api.insert(0, "Hello");
      api.insert(5, " World");
      const events = api.exportEventGraph();
      expect(events.length).toBe(2);
    });
  });

  describe("fromEventGraph", () => {
    it("should create API from event graph", () => {
      const events: GraphEvent[] = [
        {
          id: "r1:0",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
          timestamp: Date.now(),
        },
        {
          id: "r1:1",
          parentVersion: new Set(["r1:0"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 5, text: " World" },
          timestamp: Date.now() + 1,
        },
      ];

      const api = EgWalkerAPI.fromEventGraph("r2", events);
      expect(api.getText()).toBe("Hello World");
    });
  });

  describe("out-of-order remote delivery", () => {
    it("buffers events whose parents have not yet arrived", () => {
      const api = new EgWalkerAPI("r1", "");
      const root: GraphEvent = {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "AB" },
        timestamp: 1,
      };
      const child: GraphEvent = {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
        timestamp: 2,
      };

      api.applyRemoteEvent(child);
      expect(api.getText()).toBe("");
      expect(api.getPendingRemoteCount()).toBe(1);

      api.applyRemoteEvent(root);
      expect(api.getText()).toBe("ABC");
      expect(api.getPendingRemoteCount()).toBe(0);
    });

    it("flushes a chain of pending events when the root finally arrives", () => {
      const api = new EgWalkerAPI("r1", "");
      const events: GraphEvent[] = [
        {
          id: "a:0",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
          timestamp: 1,
        },
        {
          id: "a:1",
          parentVersion: new Set(["a:0"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
          timestamp: 2,
        },
        {
          id: "a:2",
          parentVersion: new Set(["a:1"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
          timestamp: 3,
        },
      ];

      api.applyRemoteEvent(events[2]!);
      api.applyRemoteEvent(events[1]!);
      expect(api.getText()).toBe("");
      expect(api.getPendingRemoteCount()).toBe(2);

      api.applyRemoteEvent(events[0]!);
      expect(api.getText()).toBe("ABC");
      expect(api.getPendingRemoteCount()).toBe(0);
    });
  });
});

describe("createEgWalker", () => {
  it("should create API instance", () => {
    const api = createEgWalker("r1", "Hello");
    expect(api.getText()).toBe("Hello");
  });

  it("should create API with empty text by default", () => {
    const api = createEgWalker("r1");
    expect(api.getText()).toBe("");
  });
});

describe("EgWalkerAPI - Edge cases and error handling", () => {
  it("should propagate non-duplicate errors in applyLocalOperation", () => {
    const api = new EgWalkerAPI("r1");
    // @ts-expect-error - swap eventGraph.addEvent for the failing branch
    const originalAddEvent = api.eventGraph.addEvent.bind(api.eventGraph);
    // @ts-expect-error - same
    api.eventGraph.addEvent = () => {
      throw new Error("Some other error");
    };

    expect(() => api.insert(0, "test")).toThrow("Some other error");

    // @ts-expect-error - restore
    api.eventGraph.addEvent = originalAddEvent;
  });

  it("should propagate non-duplicate errors in applyRemoteEvent", () => {
    const api = new EgWalkerAPI("r1");

    const event: GraphEvent = {
      id: "r2:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "test" },
      timestamp: Date.now(),
    };

    // @ts-expect-error - swap eventGraph.addEvent for the failing branch
    const originalAddEvent = api.eventGraph.addEvent.bind(api.eventGraph);
    // @ts-expect-error - same
    api.eventGraph.addEvent = () => {
      throw new Error("Network error");
    };

    expect(() => api.applyRemoteEvent(event)).toThrow("Network error");

    // @ts-expect-error - restore
    api.eventGraph.addEvent = originalAddEvent;
  });

  it("should handle deserialize with eventGraph data", () => {
    const api = new EgWalkerAPI("r1", "Test");
    const serialized = api.serialize();

    const deserialized = EgWalkerAPI.deserialize(serialized);
    expect(deserialized.getText()).toBe("Test");
  });

  it("should deserialize empty graph state without stored initial text metadata", () => {
    const deserialized = EgWalkerAPI.deserialize({
      text: "Fallback",
      eventGraph: {
        version: new Set(),
        events: [],
        metadata: {},
      },
    });

    expect(deserialized.getText()).toBe("Fallback");
  });
});
