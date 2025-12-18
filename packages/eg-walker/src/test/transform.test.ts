/**
 * Tests for Section 3.4 - Transform Mechanics
 */

import { describe, it, expect } from "vitest";
import { InternalCRDTState } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { GraphEvent } from "../types";

describe("Section 3.4 - Transform Mechanics", () => {
  describe("indexToRecordPrepare", () => {
    it("should convert prepare-index 0 to first visible record", () => {
      const state = new InternalCRDTState();

      // Add some records with mixed visibility
      const event1: GraphEvent = {
        id: "e1",
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Hello" },
        parentVersion: new Set(),
        timestamp: 100,
      };

      const event2: GraphEvent = {
        id: "e2",
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: " World" },
        parentVersion: new Set(["e1"]),
        timestamp: 200,
      };

      state.applyPrepare(event1);
      state.applyEffect(event1);
      state.applyPrepare(event2);
      state.applyEffect(event2);

      const record = state.indexToRecordPrepare(0);
      expect(record).toBeDefined();
      expect(record?.content).toContain("H");
    });
  });
});
