/**
 * Tests for Section 3.3 - Internal CRDT State
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InternalCRDTState, withInternalState } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../constants/operation-types";
import {
  PREPARE_STATE_TYPE,
  EFFECT_STATE_TYPE,
} from "../constants/crdt-states";
import type { Record, PrepareState, EffectState } from "../crdt/internal-state";
import type { GraphEvent } from "../types";

describe("InternalCRDTState", () => {
  let state: InternalCRDTState;

  beforeEach(() => {
    state = new InternalCRDTState();
  });

  afterEach(() => {
    state?.destroy();
  });

  describe("Record Management", () => {
    it("should insert records with correct ordering", () => {
      const record1: Record = {
        id: "a:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "A",
        eventId: "a",
      };

      const record2: Record = {
        id: "b:1",
        originLeft: "a:1",
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "B",
        eventId: "b",
      };

      state.insertRecord(record1);
      state.insertRecord(record2);

      const records = state.getAllRecords();
      expect(records).toHaveLength(2);
      expect(records[0]?.id).toBe("a:1");
      expect(records[1]?.id).toBe("b:1");
    });

    it("should handle concurrent insertions with non-interleaving", () => {
      // Two concurrent insertions at the same position
      const recordA1: Record = {
        id: "a:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "H",
        eventId: "a",
      };

      const recordA2: Record = {
        id: "a:2",
        originLeft: "a:1",
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "i",
        eventId: "a",
      };

      const recordB1: Record = {
        id: "b:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "W",
        eventId: "b",
      };

      const recordB2: Record = {
        id: "b:2",
        originLeft: "b:1",
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "o",
        eventId: "b",
      };

      // Insert in mixed order
      state.insertRecord(recordA1);
      state.insertRecord(recordB1);
      state.insertRecord(recordA2);
      state.insertRecord(recordB2);

      const text = state.getVisibleText();
      // Should be either "HiWo" or "WoHi", not interleaved
      expect(["HiWo", "WoHi"]).toContain(text);
    });
  });

  describe("Prepare/Effect State Transitions", () => {
    it("should apply prepare state for insert operation", () => {
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

      state.applyPrepare(event);

      const records = state.getAllRecords();
      expect(records).toHaveLength(5); // "Hello" = 5 characters
      expect(records[0]?.prepareState.type).toBe(
        PREPARE_STATE_TYPE.NOT_YET_INSERTED,
      );
      expect(state.getVisibleText()).toBe("Hello");
    });

    it("should apply prepare state for delete operation", () => {
      // First insert some content
      const insertEvent: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Test",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(insertEvent);
      state.applyEffect(insertEvent);

      // Now delete part of it
      const deleteEvent: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 1,
          length: 2,
        },
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(deleteEvent);

      const records = state.getAllRecords();
      // Check that middle characters are marked for deletion
      expect(records[1]?.prepareState.type).toBe(PREPARE_STATE_TYPE.DELETED);
      expect(records[2]?.prepareState.type).toBe(PREPARE_STATE_TYPE.DELETED);
    });

    it("should transition from prepare to effect state", () => {
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hi",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(event);

      // Records should be in "not-inserted-yet" state
      let records = state.getAllRecords();
      expect(records[0]?.prepareState.type).toBe(
        PREPARE_STATE_TYPE.NOT_YET_INSERTED,
      );

      // Apply effect to transition to "ins" state
      state.applyEffect(event);

      records = state.getAllRecords();
      expect(records[0]?.prepareState.type).toBe(PREPARE_STATE_TYPE.VISIBLE);
      expect(records[0]?.effectState.type).toBe(PREPARE_STATE_TYPE.VISIBLE);
    });

    it("should undo prepare state", () => {
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Undo",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(event);
      expect(state.getAllRecords()).toHaveLength(4);

      state.undoPrepare(event);
      expect(state.getAllRecords()).toHaveLength(0);
    });
  });

  describe("O(log n) Operations", () => {
    it("should support efficient record lookup", () => {
      // Insert many records
      for (let i = 0; i < 100; i++) {
        const record: Record = {
          id: `r:${i}`,
          originLeft: i > 0 ? `r:${i - 1}` : null,
          originRight: null,
          prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
          effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
          content: String.fromCharCode(65 + (i % 26)),
          eventId: `e${i}`,
        };
        state.insertRecord(record);
      }

      // Lookup should be efficient
      const record = state.getRecord("r:50");
      expect(record).toBeDefined();
      expect(record?.content).toBe(String.fromCharCode(65 + (50 % 26)));
    });
  });

  describe("Temporary Nature", () => {
    it("should auto-destroy after max lifetime", async () => {
      const shortLivedState = new InternalCRDTState();

      // Override max lifetime for testing - accessing private field via reflection
      // TODO: Consider adding a test-only constructor option or setter
      const stateWithMaxLifetime = shortLivedState as any;
      stateWithMaxLifetime.maxLifetime = 100; // 100ms for test

      // Wait for the state to auto-destroy
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(() => shortLivedState.getVisibleText()).toThrow();
    });

    it("should clean up with scoped usage", async () => {
      let stateRef: InternalCRDTState | null = null;

      await withInternalState(async (state) => {
        stateRef = state;
        expect(state.getVisibleText()).toBe("");
      });

      // State should be destroyed after scope
      expect(() => stateRef?.getVisibleText()).toThrow();
    });
  });

  describe("Statistics", () => {
    it("should track record statistics", () => {
      // Insert some records
      const event1: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "ABC",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(event1);
      state.applyEffect(event1);

      // Delete one character
      const event2: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 1,
          length: 1,
        },
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(event2);
      state.applyEffect(event2);

      const stats = state.getStats();
      expect(stats.totalRecords).toBe(3);
      expect(stats.visibleRecords).toBe(2); // A and C
      expect(stats.deletedRecords).toBe(1); // B
    });

    it("should track record count", () => {
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

      state.applyPrepare(event);
      state.applyEffect(event);

      const stats = state.getStats();
      expect(stats.totalRecords).toBe(4);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle inserting duplicate records gracefully", () => {
      const record: Record = {
        id: "dup:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "D",
        eventId: "e1",
      };

      state.insertRecord(record);
      const initialCount = state.getAllRecords().length;

      // Try inserting same record again
      state.insertRecord(record);
      const finalCount = state.getAllRecords().length;

      // Should not duplicate
      expect(finalCount).toBe(initialCount);
      expect(finalCount).toBe(1);
    });

    it("should handle complex originRight positioning", () => {
      // Create a chain: A -> C, then insert B between them
      const recordA: Record = {
        id: "a:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "A",
        eventId: "e1",
      };

      const recordC: Record = {
        id: "c:1",
        originLeft: "a:1",
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "C",
        eventId: "e2",
      };

      state.insertRecord(recordA);
      state.insertRecord(recordC);

      // Now insert B with originRight = C
      const recordB: Record = {
        id: "b:1",
        originLeft: "a:1",
        originRight: "c:1",
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "B",
        eventId: "e3",
      };

      state.insertRecord(recordB);

      const text = state.getVisibleText();
      expect(text).toBe("ABC");
    });

    it("should handle delete operations at boundaries", () => {
      const event1: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "ABCDE",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(event1);
      state.applyEffect(event1);

      // Delete at start
      const event2: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 0,
          length: 1,
        },
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(event2);
      state.applyEffect(event2);

      expect(state.getVisibleText()).toBe("BCDE");

      // Delete at end
      const event3: GraphEvent = {
        id: "e3",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 3,
          length: 1,
        },
        parentVersion: new Set(["e1", "e2"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(event3);
      state.applyEffect(event3);

      expect(state.getVisibleText()).toBe("BCD");
    });

    it("should handle finding records in middle range", () => {
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "0123456789",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(event);
      state.applyEffect(event);

      // Delete middle range
      const deleteEvent: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 3,
          length: 4,
        },
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(deleteEvent);
      state.applyEffect(deleteEvent);

      expect(state.getVisibleText()).toBe("012789");
    });

    it("should handle record lookup for non-existent IDs", () => {
      const record = state.getRecord("nonexistent");
      expect(record).toBeUndefined();
    });

    it("should handle getting state when empty", () => {
      const text = state.getVisibleText();
      expect(text).toBe("");
      const records = state.getAllRecords();
      expect(records).toEqual([]);
    });

    it("should preserve record order with concurrent edits", () => {
      // Insert base text
      const base: GraphEvent = {
        id: "base",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "X",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(base);
      state.applyEffect(base);

      // Two concurrent insertions after X
      const e1: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "AAA",
        },
        parentVersion: new Set(["base"]),
        timestamp: Date.now(),
      };

      const e2: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "BBB",
        },
        parentVersion: new Set(["base"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(e1);
      state.applyEffect(e1);
      state.applyPrepare(e2);
      state.applyEffect(e2);

      const text = state.getVisibleText();
      // Should maintain non-interleaving
      expect(["XAAABBB", "XBBBAAA"]).toContain(text);
    });
  });
});
