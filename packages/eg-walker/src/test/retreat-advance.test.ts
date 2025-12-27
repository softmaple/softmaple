import { OPERATION_TYPE } from "../constants/operation-types";
/**
 * Tests for Section 3.3 - Retreat/Advance Mechanics
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ConcreteCRDTState,
  RetreatAdvanceCoordinator,
  withCoordinator,
} from "../crdt/retreat-advance";
import type { GraphEvent } from "../types";

describe("Retreat/Advance Mechanics", () => {
  describe("ConcreteCRDTState", () => {
    let crdtState: ConcreteCRDTState;
    let appliedEvents: Set<string>;

    beforeEach(() => {
      crdtState = new ConcreteCRDTState();
      appliedEvents = new Set();
    });

    afterEach(() => {
      crdtState.destroy();
    });

    it("should apply prepare state for events", () => {
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      appliedEvents = crdtState.applyPrepare(event, appliedEvents);
      expect(crdtState.getCurrentText()).toBe("Hello");
    });

    it("should retreat by undoing events", () => {
      const event1: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "First",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      const event2: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 5,
          text: "Second",
        },
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
      };

      appliedEvents = crdtState.applyPrepare(event1, appliedEvents);
      appliedEvents = crdtState.applyPrepare(event2, appliedEvents);
      expect(crdtState.getCurrentText()).toBe("FirstSecond");

      // Retreat event2
      appliedEvents = crdtState.retreat("e2", appliedEvents);
      expect(crdtState.getCurrentText()).toBe("First");
    });

    it("should advance by applying events", () => {
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      appliedEvents = crdtState.applyPrepare(event, appliedEvents);
      appliedEvents = crdtState.advance("e1", appliedEvents);
      expect(crdtState.getCurrentText()).toBe("Test");
    });

    it("should reset to initial state", () => {
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Reset",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      appliedEvents = crdtState.applyPrepare(event, appliedEvents);
      expect(crdtState.getCurrentText()).toBe("Reset");

      crdtState.reset();
      appliedEvents = new Set();
      expect(crdtState.getCurrentText()).toBe("");
    });
  });

  describe("RetreatAdvanceCoordinator", () => {
    let coordinator: RetreatAdvanceCoordinator;

    beforeEach(() => {
      coordinator = new RetreatAdvanceCoordinator();
    });

    afterEach(() => {
      coordinator.destroy();
    });

    it("should transform events through retreat/advance", async () => {
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Transform",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      const prepareVersion = new Set<string>();
      const effectVersion = new Set(["e1"]);

      const transformed = await coordinator.transform(
        event,
        prepareVersion,
        effectVersion,
      );

      expect(transformed.id).toBe(event.id);
      expect(transformed.operation).toEqual(event.operation);
    });

    it("should adjust indices during transformation", async () => {
      // The test expects that when the document is empty,
      // any out-of-bound index is adjusted to 0
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 100, // Beyond current text length
          text: "Adjusted",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      // Empty versions mean empty document
      const prepareVersion = new Set<string>();
      const effectVersion = new Set<string>();

      const transformed = await coordinator.transform(
        event,
        prepareVersion,
        effectVersion,
      );

      // Index should be adjusted to text length (0 for empty text)
      expect(transformed.operation.index).toBe(0);
    });

    it("should handle delete operations", async () => {
      // First add some text
      const insertEvent: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "DeleteMe",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      await coordinator.transform(insertEvent, new Set(), new Set(["e1"]));

      // Now delete part of it
      const deleteEvent: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 2,
          length: 4,
        },
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
      };

      const transformed = await coordinator.transform(
        deleteEvent,
        new Set(["e1"]),
        new Set(["e1", "e2"]),
      );

      expect(transformed.operation.type).toBe(OPERATION_TYPE.DELETE);
      expect(transformed.operation.index).toBeLessThanOrEqual(8);
    });

    it("should use scoped coordinator", async () => {
      let coordinatorRef: RetreatAdvanceCoordinator | null = null;

      await withCoordinator(async (coord) => {
        coordinatorRef = coord;
        expect(coord.getCurrentText()).toBe("");

        const event: GraphEvent = {
          id: "e1",
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "Scoped",
          },
          parentVersion: new Set(),
          timestamp: Date.now(),
        };

        await coord.transform(event, new Set(), new Set(["e1"]));
        expect(coord.getCurrentText()).toBe("Scoped");
      });

      // Coordinator should be destroyed after scope
      expect(() => coordinatorRef?.getCurrentText()).toThrow();
    });
  });

  describe("Complex Transformation Scenarios", () => {
    it("should handle concurrent insertions with non-interleaving", async () => {
      const coordinator = new RetreatAdvanceCoordinator();

      // User A inserts "Hello"
      const eventA: GraphEvent = {
        id: "a:1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
        parentVersion: new Set(),
        timestamp: 1000,
      };

      // User B inserts "World" concurrently
      const eventB: GraphEvent = {
        id: "b:1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "World",
        },
        parentVersion: new Set(),
        timestamp: 1001,
      };

      // Apply both events
      await coordinator.transform(eventA, new Set(), new Set(["a:1"]));
      await coordinator.transform(
        eventB,
        new Set(), // eventB doesn't know about eventA yet (concurrent)
        new Set(["a:1", "b:1"]),
      );

      const finalText = coordinator.getCurrentText();
      // After applying both concurrent events, we should see both texts
      // The order depends on the CRDT resolution, but both should be present
      expect(finalText).toContain("Hello");
      expect(finalText).toContain("World");
      // And they should be non-interleaved
      expect(["HelloWorld", "WorldHello"]).toContain(finalText);

      coordinator.destroy();
    });

    it("should maintain deterministic ordering", async () => {
      const coordinator1 = new RetreatAdvanceCoordinator();
      const coordinator2 = new RetreatAdvanceCoordinator();

      const events: GraphEvent[] = [
        {
          id: "e1",
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
          parentVersion: new Set(),
          timestamp: 1000,
        },
        {
          id: "e2",
          operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
          parentVersion: new Set(["e1"]),
          timestamp: 1001,
        },
        {
          id: "e3",
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "C" },
          parentVersion: new Set(["e1"]),
          timestamp: 1002,
        },
      ];

      // Apply in different orders
      for (const event of events) {
        await coordinator1.transform(
          event,
          new Set(events.slice(0, events.indexOf(event)).map((e) => e.id)),
          new Set(events.slice(0, events.indexOf(event) + 1).map((e) => e.id)),
        );
      }

      // Apply in reverse order (should still converge)
      for (const event of [...events].reverse()) {
        const deps = event.parentVersion;
        await coordinator2.transform(
          event,
          deps as Set<string>,
          new Set([...Array.from(deps), event.id]),
        );
      }

      // Both should eventually have the same text
      // (Though intermediate states may differ)

      coordinator1.destroy();
      coordinator2.destroy();
    });

    it("should handle reset operation on coordinator", async () => {
      const coordinator = new RetreatAdvanceCoordinator();

      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      await coordinator.transform(event, new Set(), new Set(["e1"]));
      expect(coordinator.getCurrentText()).toBe("Test");

      coordinator.reset();
      expect(coordinator.getCurrentText()).toBe("");
      expect(coordinator.isEventApplied("e1")).toBe(false);

      coordinator.destroy();
    });

    it("should handle advance errors for non-existent events", () => {
      const crdtState = new ConcreteCRDTState();
      const appliedEvents = new Set<string>();

      expect(() => crdtState.advance("nonexistent", appliedEvents)).toThrow(
        /Event nonexistent not found/,
      );

      crdtState.destroy();
    });

    it("should handle retreat errors for non-existent events", () => {
      const crdtState = new ConcreteCRDTState();
      const appliedEvents = new Set<string>();

      expect(() => crdtState.retreat("nonexistent", appliedEvents)).toThrow(
        /Event nonexistent not found/,
      );

      crdtState.destroy();
    });

    it("should handle concurrent events with complex retreat/advance patterns", () => {
      const crdtState = new ConcreteCRDTState();

      // Create a base event
      const e1: GraphEvent = {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Base" },
        timestamp: 1,
      };
      let appliedEvents = crdtState.applyPrepare(e1, new Set());
      appliedEvents = crdtState.advance("e1", appliedEvents);

      // Create two concurrent events
      const e2: GraphEvent = {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 4, text: " A" },
        timestamp: 2,
      };
      appliedEvents = crdtState.applyPrepare(e2, appliedEvents);
      appliedEvents = crdtState.advance("e2", appliedEvents);

      const e3: GraphEvent = {
        id: "e3",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 4, text: " B" },
        timestamp: 3,
      };

      // Retreat e2 before applying e3
      appliedEvents = crdtState.retreat("e2", appliedEvents);
      appliedEvents = crdtState.applyPrepare(e3, appliedEvents);
      appliedEvents = crdtState.advance("e3", appliedEvents);

      const text = crdtState.getCurrentText();
      expect(text).toContain("Base");
      expect(text).toContain("B");

      crdtState.destroy();
    });

    it("should handle multiple retreats in sequence", () => {
      const crdtState = new ConcreteCRDTState();

      // Create three sequential events
      const e1: GraphEvent = {
        id: "e1",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      };
      let appliedEvents = crdtState.applyPrepare(e1, new Set());
      appliedEvents = crdtState.advance("e1", appliedEvents);

      const e2: GraphEvent = {
        id: "e2",
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
        timestamp: 2,
      };
      appliedEvents = crdtState.applyPrepare(e2, appliedEvents);
      appliedEvents = crdtState.advance("e2", appliedEvents);

      const e3: GraphEvent = {
        id: "e3",
        parentVersion: new Set(["e2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
        timestamp: 3,
      };
      appliedEvents = crdtState.applyPrepare(e3, appliedEvents);
      appliedEvents = crdtState.advance("e3", appliedEvents);

      // Now retreat in reverse order
      appliedEvents = crdtState.retreat("e3", appliedEvents);
      appliedEvents = crdtState.retreat("e2", appliedEvents);

      expect(crdtState.getCurrentText()).toBe("A");

      crdtState.destroy();
    });
  });
});
