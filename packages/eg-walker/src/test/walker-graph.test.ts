import { OPERATION_TYPE } from "../constants/operation-types";
/**
 * Tests for Section 3.2 — Graph Walking
 * Verify topological traversal and deterministic ordering
 */

import { describe, it, expect } from "vitest";
import { DefaultEventGraphWalker } from "../graph/topological-walker";
import type { GraphEvent } from "../graph/event-graph";

describe("Section 3.2: EventGraphWalker", () => {
  describe("topologicalOrder", () => {
    it("should handle linear chain of events", () => {
      const walker = new DefaultEventGraphWalker();

      const events: GraphEvent[] = [
        {
          id: "e1",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
          timestamp: Date.now(),
        },
        {
          id: "e2",
          parentVersion: new Set(["e1"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
          timestamp: Date.now() + 1,
        },
        {
          id: "e3",
          parentVersion: new Set(["e2"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "c" },
          timestamp: Date.now() + 2,
        },
      ];

      for (const event of events) {
        walker.addEvent(event);
      }

      const order = walker.topologicalOrder();
      expect(order).toEqual(["e1", "e2", "e3"]);
    });

    it("should handle branching DAG", () => {
      const walker = new DefaultEventGraphWalker();

      const events: GraphEvent[] = [
        {
          id: "root",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "r" },
          timestamp: Date.now(),
        },
        {
          id: "a1",
          parentVersion: new Set(["root"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "a1" },
          timestamp: Date.now() + 1,
        },
        {
          id: "b1",
          parentVersion: new Set(["root"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b1" },
          timestamp: Date.now() + 2,
        },
        {
          id: "merge",
          parentVersion: new Set(["a1", "b1"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "m" },
          timestamp: Date.now() + 3,
        },
      ];

      for (const event of events) {
        walker.addEvent(event);
      }

      const order = walker.topologicalOrder();

      // Root must come first
      expect(order[0]).toBe("root");

      // a1 and b1 must come before merge
      const a1Index = order.indexOf("a1");
      const b1Index = order.indexOf("b1");
      const mergeIndex = order.indexOf("merge");

      expect(a1Index).toBeGreaterThan(0);
      expect(b1Index).toBeGreaterThan(0);
      expect(a1Index).toBeLessThan(mergeIndex);
      expect(b1Index).toBeLessThan(mergeIndex);
    });

    it("should produce deterministic order for concurrent events", () => {
      const walker1 = new DefaultEventGraphWalker();
      const walker2 = new DefaultEventGraphWalker();

      const events: GraphEvent[] = [
        {
          id: "base",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "base" },
          timestamp: Date.now(),
        },
        {
          id: "c1",
          parentVersion: new Set(["base"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "c1" },
          timestamp: Date.now() + 1,
        },
        {
          id: "c2",
          parentVersion: new Set(["base"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "c2" },
          timestamp: Date.now() + 2,
        },
        {
          id: "c3",
          parentVersion: new Set(["base"]),
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "c3" },
          timestamp: Date.now() + 3,
        },
      ];

      // Add in different orders
      for (const event of events) {
        walker1.addEvent(event);
      }

      for (const event of events.reverse()) {
        walker2.addEvent(event);
      }

      const order1 = walker1.topologicalOrder();
      const order2 = walker2.topologicalOrder();

      expect(order1).toEqual(order2);
    });

    it("should detect cycles in event graph", () => {
      const walker = new DefaultEventGraphWalker();

      // Create a cycle: e1 -> e2 -> e3 -> e1
      walker.addEvent({
        id: "e1",
        parentVersion: new Set(["e3"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "1" },
        timestamp: Date.now(),
      });
      walker.addEvent({
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "2" },
        timestamp: Date.now() + 1,
      });
      walker.addEvent({
        id: "e3",
        parentVersion: new Set(["e2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "3" },
        timestamp: Date.now() + 2,
      });

      expect(() => walker.topologicalOrder()).toThrow(/Cycle detected/);
    });

    it("should handle disconnected components", () => {
      const walker = new DefaultEventGraphWalker();

      // Two disconnected chains
      walker.addEvent({
        id: "a1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a1" },
        timestamp: Date.now(),
      });
      walker.addEvent({
        id: "a2",
        parentVersion: new Set(["a1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "a2" },
        timestamp: Date.now() + 1,
      });

      walker.addEvent({
        id: "b1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b1" },
        timestamp: Date.now(),
      });
      walker.addEvent({
        id: "b2",
        parentVersion: new Set(["b1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b2" },
        timestamp: Date.now() + 1,
      });

      const order = walker.topologicalOrder();

      // Each chain should be properly ordered
      expect(order.indexOf("a1")).toBeLessThan(order.indexOf("a2"));
      expect(order.indexOf("b1")).toBeLessThan(order.indexOf("b2"));

      // Order should be deterministic
      // The current algorithm visits all nodes in root-to-leaf order
      // but processes disconnected components in the order encountered
      expect(order).toEqual(["a1", "b1", "a2", "b2"]);
    });

    it("should handle getParents with non-existent event", () => {
      const walker = new DefaultEventGraphWalker();

      // Try to get parents of event that doesn't exist
      const parents = walker.getParents("nonexistent");
      expect(parents).toEqual([]);
    });

    it("should return all events via getAllEvents", () => {
      const walker = new DefaultEventGraphWalker();

      walker.addEvent({
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        timestamp: 1,
      });
      walker.addEvent({
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
        timestamp: 2,
      });

      const events = walker.getAllEvents();
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    });

    it("should cache topological order on repeated calls", () => {
      const walker = new DefaultEventGraphWalker();

      walker.addEvent({
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        timestamp: 1,
      });

      // First call computes order
      const order1 = walker.topologicalOrder();
      // Second call should return cached result
      const order2 = walker.topologicalOrder();

      expect(order1).toEqual(order2);
      expect(order1).toEqual(["e1"]);
    });

    it("should handle events with parents outside the graph", () => {
      const walker = new DefaultEventGraphWalker();

      // Add event that has parents not in the graph
      // This should be treated as a root node
      walker.addEvent({
        id: "child",
        parentVersion: new Set(["parent1", "parent2"]), // parents not in graph
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "child" },
        timestamp: 1,
      });

      walker.addEvent({
        id: "orphan",
        parentVersion: new Set(["nonexistent"]), // parent not in graph
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "orphan" },
        timestamp: 2,
      });

      const order = walker.topologicalOrder();
      
      // Both events should be in the result (treated as roots)
      expect(order).toContain("child");
      expect(order).toContain("orphan");
      expect(order).toHaveLength(2);
    });

    it("should skip visiting parent when not in graph", () => {
      const walker = new DefaultEventGraphWalker();

      // Add events where some parents are in the graph and some are not
      walker.addEvent({
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        timestamp: 1,
      });

      walker.addEvent({
        id: "e2",
        parentVersion: new Set(["e1", "missing"]), // e1 in graph, missing not
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "b" },
        timestamp: 2,
      });

      const order = walker.topologicalOrder();
      
      // Should handle mixed parent situation gracefully
      expect(order).toEqual(["e1", "e2"]);
      expect(order.indexOf("e1")).toBeLessThan(order.indexOf("e2"));
    });
  });
});
