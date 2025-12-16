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
      expect((crdt as any).destroyed).toBe(false);

      // Advance time past maxLifetime
      vi.advanceTimersByTime(1001);

      // Should be destroyed now
      expect((crdt as any).destroyed).toBe(true);
    });

    it("should allow manual destroy before timeout", () => {
      const crdt = new TemporaryCRDT(5000);

      expect((crdt as any).destroyed).toBe(false);

      crdt.destroy();

      expect((crdt as any).destroyed).toBe(true);

      // Ensure timer is cleared (advancing time should not cause issues)
      vi.advanceTimersByTime(6000);
      expect((crdt as any).destroyed).toBe(true);
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
  });

  describe("scoped usage", () => {
    it("should auto-cleanup with withTemporaryCRDT", async () => {
      let crdtRef: TemporaryCRDT | null = null;

      await withTemporaryCRDT(async (crdt) => {
        crdtRef = crdt;
        expect((crdtRef as any).destroyed).toBe(false);
      });

      // Should be destroyed after scope exits
      expect((crdtRef as any).destroyed).toBe(true);
    });
  });
});
