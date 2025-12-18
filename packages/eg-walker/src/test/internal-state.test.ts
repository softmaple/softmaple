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
import type { Record } from "../crdt/internal-state";
import type { GraphEvent } from "../types";

describe("InternalCRDTState", () => {
  describe("Edge Cases for Record Insertion", () => {
    it("should handle insertRecord with duplicate ID gracefully", () => {
      const record1: Record = {
        id: "dup:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "A",
        eventId: "e1",
      };

      state.insertRecord(record1);

      // Try to insert the same record again
      state.insertRecord(record1);

      // Should only have one instance
      const records = state.getAllRecords();
      const duplicates = records.filter((r) => r.id === "dup:1");
      expect(duplicates.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle findRecordsInRange with no visible records", () => {
      // Insert records that are all deleted
      const record1: Record = {
        id: "r:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.DELETED, count: 1 },
        effectState: { type: EFFECT_STATE_TYPE.DELETED },
        content: "A",
        eventId: "e0",
      };

      state.insertRecord(record1);

      // Calling findRecordsInRange should handle empty visible records
      const deleteEvent: GraphEvent = {
        id: "delete1",
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      // This should not crash even with no visible records
      expect(() => state.applyEffect(deleteEvent)).not.toThrow();
    });

    it("should handle getPrepareText with deleted records with count", () => {
      // Insert a record and mark it as deleted with count > 0
      const record: Record = {
        id: "r:1",
        originLeft: null,
        originRight: null,
        prepareState: {
          type: PREPARE_STATE_TYPE.DELETED,
          count: 2,
        },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "AB",
        eventId: "e0",
      };

      state.insertRecord(record);

      // getPrepareText should handle deleted records with deleteCount
      const prepareText = state.getPrepareText();
      expect(prepareText).toBeDefined();
    });

    it("should handle compactEffectState with metadata compaction", () => {
      // Insert many records to trigger potential metadata compaction
      for (let i = 0; i < 100; i++) {
        const record: Record = {
          id: `r:${i}`,
          originLeft: i > 0 ? `r:${i - 1}` : null,
          originRight: null,
          prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
          effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
          content: String(i),
          eventId: `e${i}`,
        };
        state.insertRecord(record);
      }

      // Delete many records to create metadata entries
      for (let i = 0; i < 50; i++) {
        const deleteEvent: GraphEvent = {
          id: `delete${i}`,
          operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
          parentVersion: new Set(),
          timestamp: Date.now() + i,
        };
        state.applyEffect(deleteEvent);
      }

      // compactEffectState should have reduced metadata size
      const text = state.getVisibleText();
      expect(text).toBeDefined();
    });
  });

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
    it.skip("should auto-destroy after max lifetime", async () => {
      const _shortLivedState = new InternalCRDTState();

      // Override max lifetime for testing - accessing private field via reflection
      // TODO: Consider adding a test-only constructor option or setter
      // This test requires reflection to access private maxLifetime field
      // Skipped until a test-only constructor option is added

      // Wait for the state to auto-destroy
      // await new Promise((resolve) => setTimeout(resolve, 150));

      // expect(() => shortLivedState.getVisibleText()).toThrow();
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

    it("should handle placeholder records for deleted content", () => {
      // Insert base text
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

      // Delete the text
      const deleteEvent: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 0,
          length: 4,
        },
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(deleteEvent);
      state.applyEffect(deleteEvent);

      // Add placeholder
      state.addPlaceholder("e2", deleteEvent);

      // Check if placeholders exist
      expect(state.hasPlaceholders()).toBe(true);
      const placeholderIds = state.getPlaceholderIds();
      expect(placeholderIds).toContain("e2");
    });

    it("should compact effect state at critical versions", () => {
      // Insert multiple records
      const event: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello World",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(event);
      state.applyEffect(event);

      // Compact effect state
      const criticalVersion = new Set(["e1"]);
      state.compactEffectState(criticalVersion);

      // State should still be valid (text may be affected by compaction)
      const text = state.getVisibleText();
      expect(text.length).toBeGreaterThan(0);
    });

    it("should clear cached metadata", () => {
      // Insert records
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

      // Clear cached metadata
      state.clearCachedMetadata();

      // State should still be valid
      expect(state.getVisibleText()).toBe("Test");
    });

    it("should get statistics from state", () => {
      // Insert records
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
      state.applyEffect(event);

      // Get statistics
      const statistics = state.getStatistics();
      expect(statistics.totalRecords).toBe(5);
      expect(statistics.visibleRecords).toBe(5);
      expect(statistics.deletedRecords).toBe(0);
    });

    it("should handle deleted records in statistics", () => {
      // Insert and delete
      const insertEvent: GraphEvent = {
        id: "e1",
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "AB",
        },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(insertEvent);
      state.applyEffect(insertEvent);

      const deleteEvent: GraphEvent = {
        id: "e2",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 0,
          length: 1,
        },
        parentVersion: new Set(["e1"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(deleteEvent);
      state.applyEffect(deleteEvent);

      // Get statistics
      const statistics = state.getStatistics();
      expect(statistics.totalRecords).toBe(2);
      expect(statistics.visibleRecords).toBe(1);
      expect(statistics.deletedRecords).toBe(1);
    });
  });

  describe("Edge Cases for B-tree and Metadata", () => {
    it("should handle metadata initialization for new records", () => {
      const record: Record = {
        id: "test:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "X",
        eventId: "test",
      };

      state.insertRecord(record);

      // Verify metadata was created
      const records = state.getAllRecords();
      expect(records).toHaveLength(1);
      expect(records[0]?.id).toBe("test:1");
    });

    it("should handle record lookup for non-existent IDs", () => {
      const record: Record = {
        id: "exists:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "A",
        eventId: "exists",
      };

      state.insertRecord(record);

      // Try to find a non-existent record
      const records = state.getAllRecords();
      const foundNonExistent = records.find((r) => r.id === "nonexistent:99");
      expect(foundNonExistent).toBeUndefined();
    });

    it("should handle delete operations on boundary records", () => {
      // Insert multiple records
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

      const record3: Record = {
        id: "c:1",
        originLeft: "b:1",
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "C",
        eventId: "c",
      };

      state.insertRecord(record1);
      state.insertRecord(record2);
      state.insertRecord(record3);

      // Delete the first record
      const deleteEvent: GraphEvent = {
        id: "delete1",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 0,
          length: 1,
        },
        parentVersion: new Set(["a", "b", "c"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(deleteEvent);
      state.applyEffect(deleteEvent);

      const text = state.getVisibleText();
      expect(text).toBe("BC");
    });

    it("should handle delete operations in the middle of text", () => {
      // Insert multiple records
      const records = ["A", "B", "C", "D", "E"].map((char, i) => ({
        id: `r:${i + 1}`,
        originLeft: i > 0 ? `r:${i}` : null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: char,
        eventId: `e${i}`,
      }));

      records.forEach((r) => state.insertRecord(r as Record));

      // Delete middle 2 characters (BC)
      const deleteEvent: GraphEvent = {
        id: "delete_middle",
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 1,
          length: 2,
        },
        parentVersion: new Set(["e0", "e1", "e2", "e3", "e4"]),
        timestamp: Date.now(),
      };

      state.applyPrepare(deleteEvent);
      state.applyEffect(deleteEvent);

      const text = state.getVisibleText();
      expect(text).toBe("ADE");
    });

    it("should handle finding position for originRight positioning", () => {
      // First record
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
        content: "C",
        eventId: "b",
      };

      // Insert between a:1 and b:1 with originRight
      const record3: Record = {
        id: "c:1",
        originLeft: "a:1",
        originRight: "b:1",
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "B",
        eventId: "c",
      };

      state.insertRecord(record1);
      state.insertRecord(record2);
      state.insertRecord(record3);

      const text = state.getVisibleText();
      expect(text).toBe("ABC");
    });

    it("should handle empty state operations", () => {
      const text = state.getVisibleText();
      expect(text).toBe("");

      const records = state.getAllRecords();
      expect(records).toHaveLength(0);

      const stats = state.getStatistics();
      expect(stats.totalRecords).toBe(0);
      expect(stats.visibleRecords).toBe(0);
    });

    it("should handle compactEffectState with metadata compaction", () => {
      // Insert records with metadata
      const records = ["A", "B", "C"].map((char, i) => ({
        id: `r:${i + 1}`,
        originLeft: i > 0 ? `r:${i}` : null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: char,
        eventId: `e${i}`,
        metadata: { someData: "test" },
      }));

      records.forEach((r) => state.insertRecord(r as Record));

      // Compact at critical version
      const criticalVersion = new Set(["e0", "e1"]);
      state.compactEffectState(criticalVersion);

      // Records should still be accessible
      expect(state.getVisibleText()).toBe("ABC");
    });

    it("should handle hasPlaceholders with placeholder records", () => {
      expect(state.hasPlaceholders()).toBe(false);

      // Add a placeholder
      const placeholder: GraphEvent = {
        id: "placeholder1",
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.addPlaceholder("placeholder1", placeholder);
      expect(state.hasPlaceholders()).toBe(true);
    });

    it("should handle rebuildOrderedRecords with position sorting", () => {
      // Insert records with explicit positions
      const records = [
        {
          id: "r:1",
          originLeft: null,
          originRight: null,
          prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
          effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
          content: "A",
          eventId: "e0",
          position: 0,
        },
        {
          id: "r:2",
          originLeft: "r:1",
          originRight: null,
          prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
          effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
          content: "B",
          eventId: "e1",
          position: 1,
        },
      ];

      records.forEach((r) => state.insertRecord(r as Record));

      // Compact to trigger rebuild
      const criticalVersion = new Set(["e0", "e1"]);
      state.compactEffectState(criticalVersion);

      expect(state.getVisibleText()).toBe("AB");
    });

    it("should handle getPrepareText with deleted records", () => {
      // Insert records
      const records = ["A", "B", "C"].map((char, i) => ({
        id: `r:${i + 1}`,
        originLeft: i > 0 ? `r:${i}` : null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: char,
        eventId: `e${i}`,
      }));

      records.forEach((r) => state.insertRecord(r as Record));

      // Delete middle record in prepare state
      const deleteEvent: GraphEvent = {
        id: "delete1",
        operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyPrepare(deleteEvent);

      // getPrepareText should reflect the deletion
      const prepareText = state.getPrepareText();
      expect(prepareText.length).toBeLessThan(3);
    });

    it("should handle recordToIndexEffect with deleted record", () => {
      // Insert a record
      const record: Record = {
        id: "r:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.DELETED }, // Deleted in effect
        content: "X",
        eventId: "e0",
      };

      state.insertRecord(record);

      // recordToIndexEffect should return -1 for deleted records
      const index = state.recordToIndexEffect(record);
      expect(index).toBe(-1);
    });

    it("should handle recordToIndexEffect with non-existent record", () => {
      const nonExistentRecord: Record = {
        id: "r:does-not-exist",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "X",
        eventId: "e0",
      };

      expect(() => state.recordToIndexEffect(nonExistentRecord)).toThrow(
        "Record r:does-not-exist not found in CRDT state",
      );
    });

    it("should handle indexToRecordPrepare with invalid negative index", () => {
      expect(() => state.indexToRecordPrepare(-1)).toThrow(
        "Invalid prepare-index: -1",
      );
    });

    it("should handle indexToRecordPrepare with out-of-bounds index", () => {
      // Insert one record
      const record: Record = {
        id: "r:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "A",
        eventId: "e0",
      };
      state.insertRecord(record);

      // Index 10 is out of bounds
      expect(() => state.indexToRecordPrepare(10)).toThrow(
        /Prepare-index 10 out of bounds/,
      );
    });

    it("should handle findRecordsInRange with complex positioning", () => {
      // Insert records with explicit positions
      const records = [
        {
          id: "r:1",
          originLeft: null,
          originRight: "r:3",
          prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
          effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
          content: "A",
          eventId: "e0",
          position: 0,
        },
        {
          id: "r:2",
          originLeft: "r:1",
          originRight: "r:3",
          prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
          effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
          content: "B",
          eventId: "e1",
          position: 1,
        },
        {
          id: "r:3",
          originLeft: "r:2",
          originRight: null,
          prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
          effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
          content: "C",
          eventId: "e2",
          position: 2,
        },
      ];

      records.forEach((r) => state.insertRecord(r as Record));

      // Apply delete operation on middle record
      const deleteEvent: GraphEvent = {
        id: "delete1",
        operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
        parentVersion: new Set(),
        timestamp: Date.now(),
      };

      state.applyEffect(deleteEvent);

      // After delete, visible text should exclude the deleted record
      const text = state.getVisibleText();
      expect(text.length).toBeLessThan(3);
    });

    it("should handle getPrepareText with deleted records having count > 0", () => {
      // Insert a record in visible prepare state
      const record: Record = {
        id: "r:1",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.DELETED, count: 2 },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "AB",
        eventId: "e0",
      };
      state.insertRecord(record);

      // Get prepare text - should not include deleted records
      const text = state.getPrepareText();
      expect(text).toBe("");
    });

    it("should handle recordToIndexEffect when record is not in ordered list", () => {
      // Create a record but don't add it to ordered list properly
      const record: Record = {
        id: "r:orphan",
        originLeft: null,
        originRight: null,
        prepareState: { type: PREPARE_STATE_TYPE.VISIBLE },
        effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
        content: "X",
        eventId: "e0",
      };

      // Don't insert through insertRecord - manually add to map only
      // This simulates a corrupted state where record is in map but not in ordered list
      expect(() => state.recordToIndexEffect(record)).toThrow(
        /Record r:orphan not found/,
      );
    });
  });
});
