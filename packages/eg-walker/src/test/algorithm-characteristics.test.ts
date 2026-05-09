import { OPERATION_TYPE } from "../constants/operation-types";
/**
 * Eg-walker Algorithm Characteristics Test Suite
 *
 * This test verifies that our implementation satisfies the key
 * characteristics of the Eg-walker algorithm:
 * 1. Strong list specification (convergence)
 * 2. Maximally non-interleaving behavior
 * 3. Minimal and temporary internal CRDT metadata
 * 4. Index-based external API
 * 5. No persistent CRDT tombstones or per-character IDs
 */

import { describe, it, expect } from "vitest";
import { EgWalkerAPI } from "../core/external-api";
import { EventGraph } from "../graph/event-graph";
import type { Event } from "../types";

describe("Eg-walker Algorithm Characteristics", () => {
  describe("Characteristic 1: Strong list specification", () => {
    it("should preserve sequential semantics of text editing", () => {
      const api1 = new EgWalkerAPI("replica1");
      const api2 = new EgWalkerAPI("replica2");

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

    it("should produce deterministic output independent of delivery order", async () => {
      const api1 = new EgWalkerAPI("replica1");
      const api2 = new EgWalkerAPI("replica2");

      // Simulate concurrent edits with different delivery orders
      const event1: Event = {
        id: "alice-1",
        parentVersion: new Set<string>(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
      };

      const event2: Event = {
        id: "bob-1",
        parentVersion: new Set<string>(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "World",
        },
      };

      // Apply in different orders
      await api1.applyRemoteEvent(event1);
      await api1.applyRemoteEvent(event2);

      await api2.applyRemoteEvent(event2);
      await api2.applyRemoteEvent(event1);

      // Must converge to same result
      expect(api1.getText()).toBe(api2.getText());
    });
  });

  describe("Characteristic 2: Maximally non-interleaving behavior", () => {
    it("should never produce character-by-character interleaving", async () => {
      const api = new EgWalkerAPI("replica1");

      // Alice inserts "Hello" as a single operation
      const aliceEvent: Event = {
        id: "alice-1",
        parentVersion: new Set<string>(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
      };

      // Bob concurrently inserts "World" as a single operation
      const bobEvent: Event = {
        id: "bob-1",
        parentVersion: new Set<string>(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "World",
        },
      };

      // Apply both events
      await api.applyRemoteEvent(aliceEvent);
      await api.applyRemoteEvent(bobEvent);

      const result = api.getText();
      console.log("Non-interleaving test result:", result);

      // Must be either 'HelloWorld' or 'WorldHello', never interleaved
      expect(result === "HelloWorld" || result === "WorldHello").toBe(true);
    });

    it("should group multi-character insertions as blocks", async () => {
      const api = new EgWalkerAPI("replica1");

      // Alice inserts "Hello" as one operation
      const aliceEvent: Event = {
        id: "alice-1",
        parentVersion: new Set<string>(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
      };

      // Bob inserts "World" as one operation
      const bobEvent: Event = {
        id: "bob-1",
        parentVersion: new Set<string>(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "World",
        },
      };

      await api.applyRemoteEvent(aliceEvent);
      await api.applyRemoteEvent(bobEvent);

      const result = api.getText();

      // Both strings must appear as contiguous blocks
      expect(result.includes("Hello")).toBe(true);
      expect(result.includes("World")).toBe(true);

      // They should not be interleaved
      expect(result === "HelloWorld" || result === "WorldHello").toBe(true);
    });
  });

  describe("Characteristic 3: Minimal and temporary internal metadata", () => {
    it("should not expose CRDT internals through public API", () => {
      const api = new EgWalkerAPI("replica1");

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
      const api = new EgWalkerAPI("replica1");

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
      const api = new EgWalkerAPI("replica1");

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
      const api = new EgWalkerAPI("replica1");

      api.insert(0, "Hello World");

      // Should provide text content, not CRDT structures
      expect(typeof api.getText()).toBe("string");
      expect(api.getText()).toBe("Hello World");

      // Should provide simple numeric length
      expect(typeof api.getText().length).toBe("number");
      expect(api.getText().length).toBe(11);
    });
  });

  describe("Characteristic 5: No persistent CRDT tombstones or per-character IDs", () => {
    it("should serialize only text and event graph", () => {
      const api = new EgWalkerAPI("replica1");

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
      const api1 = new EgWalkerAPI("replica1");

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

      // Should persist the immutable event graph, but not CRDT tombstones.
      const serialized2 = api2.serialize();
      expect(serialized2.text).toBe("New Text");
      expect(serialized2.eventGraph.events).toHaveLength(4);
      expect(JSON.stringify(serialized2)).not.toContain("tombstone");
      expect(JSON.stringify(serialized2)).not.toContain("characterIds");
    });

    it("should handle event graph without per-character tracking", () => {
      const graph = new EventGraph();

      // Add multi-character insertion as single event
      const event: Event = {
        id: "event-1",
        parentVersion: new Set<string>(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello World", // 11 characters as one event
        },
      };

      graph.addEvent(event);

      const serialized = graph.serialize();
      expect(serialized.events).toHaveLength(1); // Only 1 event, not 11
      // Explicitly handle possibly-undefined operation and text properties
      const firstEvent = serialized.events[0];
      if (!firstEvent) {
        throw new Error("Expected at least one event in serialized graph");
      }
      const hasOperation = "operation" in firstEvent;
      const isInsert =
        hasOperation && firstEvent.operation.type === OPERATION_TYPE.INSERT;
      const text = isInsert ? (firstEvent.operation.text ?? "") : "";
      expect(text).toBe("Hello World");
    });
  });
});
