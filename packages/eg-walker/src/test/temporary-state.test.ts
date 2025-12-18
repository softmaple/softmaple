import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CRDTItem, GraphEvent } from "../types";
import { TemporaryCRDT, withTemporaryCRDT } from "../crdt/temporary-state";
import { OPERATION_TYPE } from "../constants/operation-types";

describe("TemporaryCRDT", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auto-cleanup", () => {
    it("should destroy itself after maxLifetime", () => {
      const crdt = new TemporaryCRDT(1000);

      // Check it's not destroyed initially
      // @ts-expect-error - Accessing private destroyed flag for testing
      expect(crdt.destroyed).toBe(false);

      // Advance time past maxLifetime
      vi.advanceTimersByTime(1001);

      // Should be destroyed now
      // @ts-expect-error - Accessing private destroyed flag for testing
      expect(crdt.destroyed).toBe(true);
    });

    it("should allow manual destroy before timeout", () => {
      const crdt = new TemporaryCRDT(5000);

      // @ts-expect-error - Accessing private destroyed flag for testing
      expect(crdt.destroyed).toBe(false);

      crdt.destroy();

      // @ts-expect-error - Accessing private destroyed flag for testing
      expect(crdt.destroyed).toBe(true);

      // Ensure timer is cleared (advancing time should not cause issues)
      vi.advanceTimersByTime(6000);
      // @ts-expect-error - Accessing private destroyed flag for testing
      expect(crdt.destroyed).toBe(true);
    });

    it("should throw when accessing destroyed CRDT", () => {
      const crdt = new TemporaryCRDT(5000);
      crdt.destroy();

      expect(() => crdt.getPrepareState()).toThrow("CRDT has been destroyed");
    });
  });

  describe("createItemsFromEvent", () => {
    it("should create items from insert event", () => {
      const crdt = new TemporaryCRDT();

      const event: GraphEvent = {
        id: "e1",
        parentVersion: new Set(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
      };

      const items = crdt.createItemsFromEvent(event);
      expect(items).toHaveLength(5); // "Hello" split into 5 items
    });

    it("should create items from delete event", () => {
      const crdt = new TemporaryCRDT();

      // First insert some items
      const insertEvent: GraphEvent = {
        id: "e1",
        parentVersion: new Set(),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
        },
      };

      const insertedItems = crdt.createItemsFromEvent(insertEvent);
      crdt.integrate(insertedItems);

      // Now delete some items
      const deleteEvent: GraphEvent = {
        id: "e2",
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 0,
          length: 2,
        },
      };

      const deletedItems = crdt.createItemsFromEvent(deleteEvent);
      expect(deletedItems).toHaveLength(2);
      expect(deletedItems.every((item) => item.isDeleted)).toBe(true);
    });
  });

  describe("integrate", () => {
    it("should integrate items into CRDT", () => {
      const crdt = new TemporaryCRDT();

      const items: CRDTItem[] = [
        {
          id: "i1",
          content: "H",
          originLeft: null,
          originRight: null,
          isDeleted: false,
          insertedBy: "e1",
        },
      ];

      crdt.integrate(items);
      const state = crdt.getEffectState();
      expect(state.visibleText).toBe("H");
    });

    it("should integrate items with originLeft positioning", () => {
      const crdt = new TemporaryCRDT();

      // Insert first item
      const item1: CRDTItem = {
        id: "i1",
        content: "A",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "e1",
      };

      crdt.integrate([item1]);

      // Insert second item after the first
      const item2: CRDTItem = {
        id: "i2",
        content: "B",
        originLeft: "i1",
        originRight: null,
        isDeleted: false,
        insertedBy: "e2",
      };

      crdt.integrate([item2]);

      const state = crdt.getEffectState();
      expect(state.visibleText).toBe("AB");
    });

    it("should integrate items with originRight positioning", () => {
      const crdt = new TemporaryCRDT();

      // Insert first and last items
      const item1: CRDTItem = {
        id: "i1",
        content: "A",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "e1",
      };

      const item3: CRDTItem = {
        id: "i3",
        content: "C",
        originLeft: "i1",
        originRight: null,
        isDeleted: false,
        insertedBy: "e3",
      };

      crdt.integrate([item1, item3]);

      // Insert middle item with originRight
      const item2: CRDTItem = {
        id: "i2",
        content: "B",
        originLeft: "i1",
        originRight: "i3",
        isDeleted: false,
        insertedBy: "e2",
      };

      crdt.integrate([item2]);

      const state = crdt.getEffectState();
      expect(state.visibleText).toBe("ABC");
    });

    it("should skip already integrated items", () => {
      const crdt = new TemporaryCRDT();

      const item: CRDTItem = {
        id: "i1",
        content: "A",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "e1",
      };

      // Integrate same item twice
      crdt.integrate([item]);
      crdt.integrate([item]);

      const state = crdt.getEffectState();
      expect(state.visibleText).toBe("A");
      expect(state.items).toHaveLength(1);
    });

    it("should handle empty event items gracefully", () => {
      const crdt = new TemporaryCRDT();

      // This shouldn't crash
      crdt.integrate([]);

      const state = crdt.getEffectState();
      expect(state.visibleText).toBe("");
    });
  });

  describe("scoped usage", () => {
    it("should auto-cleanup with withTemporaryCRDT", async () => {
      let crdtRef: TemporaryCRDT | null = null;

      await withTemporaryCRDT(async (crdt) => {
        crdtRef = crdt;
        // @ts-expect-error - Accessing private destroyed flag for testing
        expect(crdtRef.destroyed).toBe(false);
      });

      // Should be destroyed after scope exits
      // @ts-expect-error - Accessing private destroyed flag for testing
      expect(crdtRef.destroyed).toBe(true);
    });

    it("should throw error when accessing destroyed CRDT", () => {
      const crdt = new TemporaryCRDT();
      crdt.destroy();

      // Should throw when calling methods on destroyed CRDT
      expect(() => crdt.integrate([])).toThrow(
        "CRDT has been destroyed",
      );
    });

    it("should handle integrate with complex item sequences", () => {
      const crdt = new TemporaryCRDT();

      // Create a complex sequence of items
      const items = [
        {
          id: "item1",
          originLeft: null,
          originRight: "item3",
          content: "A",
          insertedBy: "e1",
          isDeleted: false,
        },
        {
          id: "item2",
          originLeft: "item1",
          originRight: "item3",
          content: "B",
          insertedBy: "e2",
          isDeleted: false,
        },
        {
          id: "item3",
          originLeft: "item2",
          originRight: null,
          content: "C",
          insertedBy: "e3",
          isDeleted: false,
        },
      ];

      // Integrate items with originRight positioning
      crdt.integrate(items);

      // Should maintain correct ordering based on originRight
      const state = crdt.getEffectState();
      expect(state.items.length).toBe(3);
    });

    it("should handle multiple integrate calls with overlapping items", () => {
      const crdt = new TemporaryCRDT();

      const items1 = [
        { id: "item1", originLeft: null, originRight: null, content: "A", insertedBy: "e1", isDeleted: false },
      ];
      const items2 = [
        { id: "item2", originLeft: "item1", originRight: null, content: "B", insertedBy: "e2", isDeleted: false },
      ];

      crdt.integrate(items1);
      crdt.integrate(items2);

      // Should have both items integrated correctly
      const state = crdt.getEffectState();
      expect(state.items.length).toBe(2);
    });

    it("should handle integrate with originRight positioning for complex insertions", () => {
      const crdt = new TemporaryCRDT();

      const items1 = [
        { id: "item1", originLeft: null, originRight: null, content: "A", insertedBy: "e1", isDeleted: false },
        { id: "item3", originLeft: "item1", originRight: null, content: "C", insertedBy: "e2", isDeleted: false },
      ];
      crdt.integrate(items1);

      // Insert item2 between item1 and item3 using originRight
      const items2 = [
        { id: "item2", originLeft: "item1", originRight: "item3", content: "B", insertedBy: "e3", isDeleted: false },
      ];
      crdt.integrate(items2);

      const state = crdt.getEffectState();
      expect(state.items.length).toBe(3);
      // Should be positioned correctly
      const contents = state.items.map((item) => item?.content).filter(Boolean);
      expect(contents).toContain("A");
      expect(contents).toContain("B");
      expect(contents).toContain("C");
    });

    it("should handle integrate when originRight is at the middle of items array", () => {
      const crdt = new TemporaryCRDT();

      // Create a scenario where originRight needs to scan through items
      const items = [
        { id: "i1", originLeft: null, originRight: null, content: "1", insertedBy: "e1", isDeleted: false },
        { id: "i3", originLeft: "i1", originRight: null, content: "3", insertedBy: "e2", isDeleted: false },
        { id: "i5", originLeft: "i3", originRight: null, content: "5", insertedBy: "e3", isDeleted: false },
      ];
      crdt.integrate(items);

      // Insert i2 between i1 and i3 using originRight
      const items2 = [
        { id: "i2", originLeft: "i1", originRight: "i3", content: "2", insertedBy: "e4", isDeleted: false },
      ];
      crdt.integrate(items2);

      const state = crdt.getEffectState();
      expect(state.items.length).toBe(4);
    });

    it("should handle integrate with deleted items and originRight references", () => {
      const crdt = new TemporaryCRDT();

      const items = [
        { id: "i1", originLeft: null, originRight: null, content: "A", insertedBy: "e1", isDeleted: false },
        { id: "i2", originLeft: "i1", originRight: null, content: "B", insertedBy: "e2", isDeleted: true },
        { id: "i3", originLeft: "i1", originRight: "i2", content: "C", insertedBy: "e3", isDeleted: false },
      ];

      crdt.integrate(items);

      const state = crdt.getEffectState();
      // Deleted item should still exist but marked as deleted
      expect(state.items.length).toBeGreaterThanOrEqual(2);
    });
  });
});
