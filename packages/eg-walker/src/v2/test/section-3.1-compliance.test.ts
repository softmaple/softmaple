import { OPERATION_TYPE } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../crdt/internal-state";
/**
 * Section 3.1 Compliance Test Suite
 *
 * This test verifies that our implementation satisfies all
 * characteristics specified in Section 3.1 of the Eg-walker paper.
 */

import { describe, it, expect } from "vitest";
import { EgWalkerAPI } from "../core/external-api";
import { withTemporaryCRDT } from "../crdt/temporary-state";
import { EventGraph } from "../graph/event-graph";
import type { ExternalOperation, Event } from "../types";

describe("Section 3.1 - Eg-walker Characteristics Compliance", () => {
  describe("Characteristic 1: Strong list specification", () => {
    it("should preserve sequential semantics of text editing", () => {
      const api1 = new EgWalkerAPI();
      const api2 = new EgWalkerAPI();

      // Apply same operations to both replicas
      api1.insert(0, "Hello");
      api1.insert(5, " ");
      api1.insert(6, "World");

      api2.insert(0, "Hello");
      api2.insert(5, " ");
      api2.insert(6, "World");

      // Both replicas must have identical text
      expect(api1.getText()).toBe("Hello World");
      expect(api2.getText()).toBe("Hello World");
      expect(api1.getText()).toBe(api2.getText());
    });

    it("should produce deterministic output independent of delivery order", () => {
      const api1 = new EgWalkerAPI();
      const api2 = new EgWalkerAPI();

      // Simulate concurrent edits with different delivery orders
      const event1: Event = {
        id: "alice-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
          eventId: "alice-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      const event2: Event = {
        id: "bob-1",
        authorId: "bob",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "World",
          eventId: "bob-1",
          authorId: "bob",
          timestamp: 100,
        },
      };

      // Apply in different orders
      api1.applyRemoteEvent(event1);
      api1.applyRemoteEvent(event2);

      api2.applyRemoteEvent(event2);
      api2.applyRemoteEvent(event1);

      // Must converge to same result
      expect(api1.getText()).toBe(api2.getText());
    });
  });

  describe("Characteristic 2: Maximally non-interleaving behavior", () => {
    it("should never produce character-by-character interleaving", () => {
      const api = new EgWalkerAPI();

      // Simulate concurrent insertions at same position
      const aliceEvents: Event[] = [
        {
          id: "alice-1",
          authorId: "alice",
          timestamp: 100,
          parentIds: [],
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "H",
            eventId: "alice-1",
            authorId: "alice",
            timestamp: 100,
          },
        },
        {
          id: "alice-2",
          authorId: "alice",
          timestamp: 101,
          parentIds: ["alice-1"],
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 1,
            text: "e",
            eventId: "alice-2",
            authorId: "alice",
            timestamp: 101,
          },
        },
        {
          id: "alice-3",
          authorId: "alice",
          timestamp: 102,
          parentIds: ["alice-2"],
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 2,
            text: "llo",
            eventId: "alice-3",
            authorId: "alice",
            timestamp: 102,
          },
        },
      ];

      const bobEvents: Event[] = [
        {
          id: "bob-1",
          authorId: "bob",
          timestamp: 100,
          parentIds: [],
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "W",
            eventId: "bob-1",
            authorId: "bob",
            timestamp: 100,
          },
        },
        {
          id: "bob-2",
          authorId: "bob",
          timestamp: 101,
          parentIds: ["bob-1"],
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 1,
            text: "o",
            eventId: "bob-2",
            authorId: "bob",
            timestamp: 101,
          },
        },
        {
          id: "bob-3",
          authorId: "bob",
          timestamp: 102,
          parentIds: ["bob-2"],
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 2,
            text: "rld",
            eventId: "bob-3",
            authorId: "bob",
            timestamp: 102,
          },
        },
      ];

      // Apply all events (simulating interleaved network delivery)
      api.applyRemoteEvent(aliceEvents[0]);
      api.applyRemoteEvent(bobEvents[0]);
      api.applyRemoteEvent(aliceEvents[1]);
      api.applyRemoteEvent(bobEvents[1]);
      api.applyRemoteEvent(aliceEvents[2]);
      api.applyRemoteEvent(bobEvents[2]);

      const result = api.getText();

      // Must be either 'HelloWorld' or 'WorldHello', never interleaved
      expect(result === "HelloWorld" || result === "WorldHello").toBe(true);

      // Should NOT be character-interleaved
      expect(result).not.toBe("HWeolrllod");
      expect(result).not.toBe("WHoerllldo");
      expect(result).not.toContain("HW");
      expect(result).not.toContain("WH");
    });

    it("should group multi-character insertions as blocks", () => {
      const api = new EgWalkerAPI();

      // Alice inserts "Hello" as one operation
      const aliceEvent: Event = {
        id: "alice-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
          eventId: "alice-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      // Bob inserts "World" as one operation
      const bobEvent: Event = {
        id: "bob-1",
        authorId: "bob",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "World",
          eventId: "bob-1",
          authorId: "bob",
          timestamp: 100,
        },
      };

      api.applyRemoteEvent(aliceEvent);
      api.applyRemoteEvent(bobEvent);

      const result = api.getText();

      // Both strings must appear as contiguous blocks
      expect(result.includes("Hello")).toBe(true);
      expect(result.includes("World")).toBe(true);

      // They should not be interleaved
      expect(result === "HelloWorld" || result === "WorldHello").toBe(true);
    });
  });

  describe("Characteristic 3: Minimal and temporary internal metadata", () => {
    it("should automatically clean up CRDT state", () => {
      let crdtDestroyed = false;

      withTemporaryCRDT((crdt) => {
        expect(crdt.isDestroyed()).toBe(false);

        crdt.insertItem({
          id: "test-item",
          content: "test",
          authorId: "test",
          timestamp: 100,
          leftId: null,
          rightId: null,
        });

        // Set up check for destruction
        const originalDestroy = crdt.destroy.bind(crdt);
        crdt.destroy = () => {
          crdtDestroyed = true;
          originalDestroy();
        };

        return crdt.getOrderedItems();
      });

      // CRDT should be destroyed after use
      expect(crdtDestroyed).toBe(true);
    });

    it("should not expose CRDT internals through public API", () => {
      const api = new EgWalkerAPI();

      api.insert(0, "Test");

      // API should not have any CRDT-related methods or properties
      expect(api).not.toHaveProperty("crdt");
      expect(api).not.toHaveProperty("items");
      expect(api).not.toHaveProperty("tombstones");
      expect(api).not.toHaveProperty("getItems");
      expect(api).not.toHaveProperty("getCRDTState");
    });
  });

  describe("Characteristic 4: Index-based external API", () => {
    it("should only accept numeric indices in public API", () => {
      const api = new EgWalkerAPI();

      // These should work with numeric indices
      expect(() => api.insert(0, "Hello")).not.toThrow();
      expect(() => api.insert(5, " World")).not.toThrow();
      expect(() => api.delete(0, 5)).not.toThrow();

      // API should not have methods that accept CRDT IDs
      expect(api).not.toHaveProperty("insertAfterItem");
      expect(api).not.toHaveProperty("deleteById");
      expect(api).not.toHaveProperty("getItemById");
    });

    it("should validate index bounds", () => {
      const api = new EgWalkerAPI();

      api.insert(0, "Hello");

      // Valid operations
      expect(() => api.insert(5, "!")).not.toThrow();
      expect(() => api.delete(0, 5)).not.toThrow();

      // Invalid operations
      expect(() => api.insert(10, "X")).toThrow();
      expect(() => api.delete(0, 10)).toThrow();
      expect(() => api.insert(-1, "X")).toThrow();
      expect(() => api.delete(-1, 1)).toThrow();
    });

    it("should provide simple text-based getters", () => {
      const api = new EgWalkerAPI();

      api.insert(0, "Hello World");

      // Should provide text content, not CRDT structures
      expect(typeof api.getText()).toBe("string");
      expect(api.getText()).toBe("Hello World");

      // Should provide simple numeric length
      expect(typeof api.getLength()).toBe("number");
      expect(api.getLength()).toBe(11);
    });
  });

  describe("Characteristic 5: No persistent CRDT tombstones or per-character IDs", () => {
    it("should serialize only text and event graph", () => {
      const api = new EgWalkerAPI();

      api.insert(0, "Hello");
      api.delete(2, 2); // Delete 'll'
      api.insert(2, "y"); // Insert 'y' -> "Heyo"

      const serialized = api.serialize();

      // Should contain text and event graph
      expect(serialized).toHaveProperty("text");
      expect(serialized).toHaveProperty("eventGraph");
      expect(serialized.text).toBe("Heyo");

      // Should NOT contain CRDT metadata
      expect(serialized).not.toHaveProperty("items");
      expect(serialized).not.toHaveProperty("tombstones");
      expect(serialized).not.toHaveProperty("crdt");
      expect(serialized).not.toHaveProperty("characterIds");
    });

    it("should deserialize without restoring CRDT state", () => {
      const api1 = new EgWalkerAPI();

      api1.insert(0, "Original");
      api1.delete(0, 8);
      api1.insert(0, "New");

      const serialized = api1.serialize();
      const api2 = EgWalkerAPI.deserialize(serialized);

      // Should restore text correctly
      expect(api2.getText()).toBe("New");

      // Should be able to continue editing
      api2.insert(3, " Text");
      expect(api2.getText()).toBe("New Text");

      // Should not have any tombstones from deleted "Original"
      const serialized2 = api2.serialize();
      expect(JSON.stringify(serialized2)).not.toContain("Original");
      expect(JSON.stringify(serialized2)).not.toContain("tombstone");
    });

    it("should handle event graph without per-character tracking", () => {
      const graph = new EventGraph();

      // Add multi-character insertion as single event
      const event: Event = {
        id: "event-1",
        authorId: "alice",
        timestamp: 100,
        parentIds: [],
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello World", // 11 characters as one event
          eventId: "event-1",
          authorId: "alice",
          timestamp: 100,
        },
      };

      graph.addEvent(event);

      const serialized = graph.serialize();
      expect(serialized.events).toHaveLength(1); // Only 1 event, not 11
      expect(serialized.events[0].operation.text).toBe("Hello World");
    });
  });
});
