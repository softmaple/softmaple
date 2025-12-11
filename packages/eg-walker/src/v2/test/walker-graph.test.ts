/**
 * Tests for Section 3.2 — Graph Walking
 * Verify topological traversal and deterministic ordering
 */

import { describe, it, expect } from "vitest";
import { DefaultEventGraphWalker } from "../walker-graph/event-graph-walker";
import type { GraphEvent } from "../graph/event-graph";

describe("Section 3.2: EventGraphWalker", () => {
  describe("topologicalOrder", () => {
    it("should handle linear chain of events", () => {
      const walker = new DefaultEventGraphWalker();

      const events: GraphEvent[] = [
        {
          id: "e1",
          parentVersion: new Set(),
          type: "insert",
          position: 0,
          content: "a",
        },
        {
          id: "e2",
          parentVersion: new Set(["e1"]),
          type: "insert",
          position: 1,
          content: "b",
        },
        {
          id: "e3",
          parentVersion: new Set(["e2"]),
          type: "insert",
          position: 2,
          content: "c",
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
          type: "insert",
          position: 0,
          content: "r",
        },
        {
          id: "a1",
          parentVersion: new Set(["root"]),
          type: "insert",
          position: 1,
          content: "a1",
        },
        {
          id: "b1",
          parentVersion: new Set(["root"]),
          type: "insert",
          position: 1,
          content: "b1",
        },
        {
          id: "merge",
          parentVersion: new Set(["a1", "b1"]),
          type: "insert",
          position: 2,
          content: "m",
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
          type: "insert",
          position: 0,
          content: "base",
        },
        {
          id: "c1",
          parentVersion: new Set(["base"]),
          type: "insert",
          position: 1,
          content: "c1",
        },
        {
          id: "c2",
          parentVersion: new Set(["base"]),
          type: "insert",
          position: 1,
          content: "c2",
        },
        {
          id: "c3",
          parentVersion: new Set(["base"]),
          type: "insert",
          position: 1,
          content: "c3",
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
        type: "insert",
        position: 0,
        content: "1",
      });
      walker.addEvent({
        id: "e2",
        parentVersion: new Set(["e1"]),
        type: "insert",
        position: 1,
        content: "2",
      });
      walker.addEvent({
        id: "e3",
        parentVersion: new Set(["e2"]),
        type: "insert",
        position: 2,
        content: "3",
      });

      expect(() => walker.topologicalOrder()).toThrow(/Cycle detected/);
    });

    it("should handle disconnected components", () => {
      const walker = new DefaultEventGraphWalker();

      // Two disconnected chains
      walker.addEvent({
        id: "a1",
        parentVersion: new Set(),
        type: "insert",
        position: 0,
        content: "a1",
      });
      walker.addEvent({
        id: "a2",
        parentVersion: new Set(["a1"]),
        type: "insert",
        position: 1,
        content: "a2",
      });

      walker.addEvent({
        id: "b1",
        parentVersion: new Set(),
        type: "insert",
        position: 0,
        content: "b1",
      });
      walker.addEvent({
        id: "b2",
        parentVersion: new Set(["b1"]),
        type: "insert",
        position: 1,
        content: "b2",
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
  });
});
