import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CRDTItem } from "../types";
import { TemporaryCRDT, withTemporaryCRDT } from "../crdt/temporary-state";

describe("TemporaryCRDT", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auto-cleanup", () => {
    it("should destroy itself after maxLifetime", () => {
      const crdt = new TemporaryCRDT({ maxLifetime: 1000 });

      expect(crdt.isDestroyed()).toBe(false);

      // Advance time past maxLifetime
      vi.advanceTimersByTime(1001);

      expect(crdt.isDestroyed()).toBe(true);
    });

    it("should allow manual destroy before timeout", () => {
      const crdt = new TemporaryCRDT({ maxLifetime: 5000 });

      expect(crdt.isDestroyed()).toBe(false);

      crdt.destroy();

      expect(crdt.isDestroyed()).toBe(true);

      // Ensure timer is cleared (advancing time should not cause issues)
      vi.advanceTimersByTime(6000);
      expect(crdt.isDestroyed()).toBe(true);
    });

    it("should throw when accessing destroyed CRDT", () => {
      const crdt = new TemporaryCRDT();
      crdt.destroy();

      expect(() => crdt.insertItem({} as CRDTItem)).toThrow(
        "CRDT has been destroyed",
      );
      expect(() => crdt.deleteItem("test-id")).toThrow(
        "CRDT has been destroyed",
      );
      expect(() => crdt.getOrderedItems()).toThrow("CRDT has been destroyed");
      expect(() => crdt.findInsertPosition({} as CRDTItem)).toThrow(
        "CRDT has been destroyed",
      );
    });
  });

  describe("item management", () => {
    it("should insert items and maintain order", () => {
      const crdt = new TemporaryCRDT();

      const item1: CRDTItem = {
        id: "item-1",
        content: "Hello",
        authorId: "alice",
        timestamp: 100,
        leftId: null,
        rightId: null,
      };

      const item2: CRDTItem = {
        id: "item-2",
        content: "World",
        authorId: "bob",
        timestamp: 200,
        leftId: "item-1",
        rightId: null,
      };

      crdt.insertItem(item1);
      crdt.insertItem(item2);

      const ordered = crdt.getOrderedItems();
      expect(ordered).toHaveLength(2);
      expect(ordered[0].id).toBe("item-1");
      expect(ordered[1].id).toBe("item-2");
    });

    it("should delete items by id", () => {
      const crdt = new TemporaryCRDT();

      const item: CRDTItem = {
        id: "item-1",
        content: "Test",
        authorId: "alice",
        timestamp: 100,
        leftId: null,
        rightId: null,
      };

      crdt.insertItem(item);
      expect(crdt.getOrderedItems()).toHaveLength(1);

      crdt.deleteItem("item-1");
      expect(crdt.getOrderedItems()).toHaveLength(0);
    });

    it("should handle concurrent insertions at same position", () => {
      const crdt = new TemporaryCRDT();

      const item1: CRDTItem = {
        id: "alice-1",
        content: "Hello",
        authorId: "alice",
        timestamp: 100,
        leftId: null,
        rightId: null,
      };

      const item2: CRDTItem = {
        id: "bob-1",
        content: "World",
        authorId: "bob",
        timestamp: 100,
        leftId: null,
        rightId: null,
      };

      crdt.insertItem(item1);
      crdt.insertItem(item2);

      const ordered = crdt.getOrderedItems();
      expect(ordered).toHaveLength(2);

      // Should be deterministically ordered (by ID in this case)
      expect(ordered[0].id).toBe("alice-1");
      expect(ordered[1].id).toBe("bob-1");
    });
  });

  describe("withTemporaryCRDT", () => {
    it("should create and cleanup CRDT automatically", () => {
      let crdtRef: TemporaryCRDT | null = null;

      const result = withTemporaryCRDT((crdt) => {
        crdtRef = crdt;
        expect(crdt.isDestroyed()).toBe(false);

        crdt.insertItem({
          id: "test",
          content: "Test",
          authorId: "test",
          timestamp: 100,
          leftId: null,
          rightId: null,
        });

        return crdt.getOrderedItems().length;
      });

      expect(result).toBe(1);
      expect(crdtRef!.isDestroyed()).toBe(true);
    });

    it("should cleanup even on error", () => {
      let crdtRef: TemporaryCRDT | null = null;

      expect(() => {
        withTemporaryCRDT((crdt) => {
          crdtRef = crdt;
          throw new Error("Test error");
        });
      }).toThrow("Test error");

      expect(crdtRef!.isDestroyed()).toBe(true);
    });

    it("should pass options to CRDT", () => {
      withTemporaryCRDT(
        (crdt) => {
          expect(crdt.isDestroyed()).toBe(false);
          return true;
        },
        { maxLifetime: 100 },
      );

      // CRDT should be destroyed after the callback
    });
  });

  describe("findInsertPosition", () => {
    it("should find correct position for new items", () => {
      const crdt = new TemporaryCRDT();

      const item1: CRDTItem = {
        id: "item-1",
        content: "A",
        authorId: "alice",
        timestamp: 100,
        leftId: null,
        rightId: null,
      };

      crdt.insertItem(item1);

      const newItem: CRDTItem = {
        id: "item-2",
        content: "B",
        authorId: "bob",
        timestamp: 200,
        leftId: "item-1",
        rightId: null,
      };

      const position = crdt.findInsertPosition(newItem);
      expect(position).toBe(1); // Should insert after item-1
    });

    it("should handle insertion at beginning", () => {
      const crdt = new TemporaryCRDT();

      const existingItem: CRDTItem = {
        id: "item-1",
        content: "B",
        authorId: "alice",
        timestamp: 200,
        leftId: null,
        rightId: null,
      };

      crdt.insertItem(existingItem);

      const newItem: CRDTItem = {
        id: "item-0",
        content: "A",
        authorId: "bob",
        timestamp: 100,
        leftId: null,
        rightId: "item-1",
      };

      const position = crdt.findInsertPosition(newItem);
      expect(position).toBe(0); // Should insert at beginning
    });
  });
});
