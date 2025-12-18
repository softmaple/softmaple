import { describe, it, expect } from "vitest";
import type { ExternalOperation } from "../types";
import {
  groupIntoRuns,
  ensureNonInterleaving,
  NonInterleavingOrder,
  mergeRuns,
  verifyNonInterleaving,
  BLOCK_ORDER_STRATEGIES,
} from "../crdt/non-interleaving";
import { OPERATION_TYPE } from "../constants/operation-types";
import type { CRDTItem } from "../types";

describe("Non-Interleaving Behavior", () => {
  describe("groupIntoRuns", () => {
    it("should group consecutive operations from the same author", () => {
      const items: CRDTItem[] = [
        {
          id: "r1:1",
          content: "H",
          originLeft: null,
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
        {
          id: "r1:2",
          content: "e",
          originLeft: "r1:1",
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
        {
          id: "r1:3",
          content: "l",
          originLeft: "r1:2",
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
      ];

      const runs = groupIntoRuns(items);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.content).toBe("Hel");
      expect(runs[0]?.eventId).toBe("r1:1");
    });

    it("should split runs when author changes", () => {
      const items: CRDTItem[] = [
        {
          id: "r1:1",
          content: "H",
          originLeft: null,
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
        {
          id: "r2:1",
          content: "W",
          originLeft: "r1:1",
          originRight: null,
          isDeleted: false,
          insertedBy: "r2:1",
        },
        {
          id: "r1:2",
          content: "e",
          originLeft: "r2:1",
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
      ];

      const runs = groupIntoRuns(items);
      expect(runs).toHaveLength(3);
      expect(runs[0]?.content).toBe("H");
      expect(runs[1]?.content).toBe("W");
      expect(runs[2]?.content).toBe("e");
    });

    it("should handle mixed operations with deleted items", () => {
      const items: CRDTItem[] = [
        {
          id: "r1:1",
          content: "H",
          originLeft: null,
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
        {
          id: "r1:2",
          content: "e",
          originLeft: "r1:1",
          originRight: null,
          isDeleted: true,
          insertedBy: "r1:1",
        },
        {
          id: "r1:3",
          content: "l",
          originLeft: "r1:2",
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
      ];

      const runs = groupIntoRuns(items);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.content).toBe("Hl");
    });

    it("should handle empty input", () => {
      const runs = groupIntoRuns([]);
      expect(runs).toHaveLength(0);
    });
  });

  describe("ensureNonInterleaving", () => {
    it("should ensure runs don't interleave", () => {
      expect(ensureNonInterleaving).toBeDefined();
      const items: CRDTItem[] = [
        {
          id: "r1:1",
          content: "H",
          originLeft: null,
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
        {
          id: "r1:2",
          content: "i",
          originLeft: "r1:1",
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
      ];
      expect(ensureNonInterleaving(items)).toBe(true);
    });

    it("should detect interleaving", () => {
      const items: CRDTItem[] = [
        {
          id: "r1:1",
          content: "H",
          originLeft: null,
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
        {
          id: "r2:1",
          content: "W",
          originLeft: "r1:1",
          originRight: null,
          isDeleted: false,
          insertedBy: "r2:1",
        },
        {
          id: "r1:2",
          content: "e",
          originLeft: "r2:1",
          originRight: null,
          isDeleted: false,
          insertedBy: "r1:1",
        },
      ];
      expect(verifyNonInterleaving(items)).toBe(false);
    });
  });

  describe("NonInterleavingOrder", () => {
    it("should compare items from same event using id", () => {
      const order = new NonInterleavingOrder("replica-id");
      const a: CRDTItem = {
        id: "r1:1",
        content: "a",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "r1:1",
      };
      const b: CRDTItem = {
        id: "r1:2",
        content: "b",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "r1:1",
      };
      expect(order.compare(a, b)).toBe(true);
    });

    it("should use replica-id tiebreaker for concurrent items", () => {
      const order = new NonInterleavingOrder("replica-id");
      const a: CRDTItem = {
        id: "r1:1",
        content: "a",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "r1:1",
      };
      const b: CRDTItem = {
        id: "r2:1",
        content: "b",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "r2:1",
      };
      expect(order.compare(a, b)).toBe(true);
    });

    it("should use lexicographic tiebreaker", () => {
      const order = new NonInterleavingOrder("lexicographic");
      const a: CRDTItem = {
        id: "r1:1",
        content: "a",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "abc",
      };
      const b: CRDTItem = {
        id: "r2:1",
        content: "b",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "xyz",
      };
      expect(order.compare(a, b)).toBe(true);
    });

    it("should use timestamp tiebreaker", () => {
      const order = new NonInterleavingOrder("timestamp");
      const a: CRDTItem = {
        id: "r1:1",
        content: "a",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "r1:1",
      };
      const b: CRDTItem = {
        id: "r2:2",
        content: "b",
        originLeft: null,
        originRight: null,
        isDeleted: false,
        insertedBy: "r2:1",
      };
      expect(order.compare(a, b)).toBe(true);
    });

    it("should return false for non-concurrent items", () => {
      const order = new NonInterleavingOrder("replica-id");
      const a: CRDTItem = {
        id: "r1:1",
        content: "a",
        originLeft: "left1",
        originRight: null,
        isDeleted: false,
        insertedBy: "r1:1",
      };
      const b: CRDTItem = {
        id: "r2:1",
        content: "b",
        originLeft: "left2",
        originRight: null,
        isDeleted: false,
        insertedBy: "r2:1",
      };
      expect(order.compare(a, b)).toBe(false);
    });
  });

  describe("mergeRuns", () => {
    it("should merge runs in correct order", () => {
      const order = new NonInterleavingOrder("replica-id");
      const run1 = {
        eventId: "r1:1",
        content: "Hello",
        startIndex: 0,
        originLeft: null,
        originRight: null,
      };
      const run2 = {
        eventId: "r2:1",
        content: "World",
        startIndex: 5,
        originLeft: null,
        originRight: null,
      };

      const merged = mergeRuns(run1, run2, order);
      expect(merged).toHaveLength(2);
      expect(merged[0]?.eventId).toBe("r1:1");
      expect(merged[1]?.eventId).toBe("r2:1");
    });

    it("should reverse order when appropriate", () => {
      const order = new NonInterleavingOrder("replica-id");
      const run1 = {
        eventId: "r2:1",
        content: "World",
        startIndex: 5,
        originLeft: null,
        originRight: null,
      };
      const run2 = {
        eventId: "r1:1",
        content: "Hello",
        startIndex: 0,
        originLeft: null,
        originRight: null,
      };

      const merged = mergeRuns(run1, run2, order);
      expect(merged).toHaveLength(2);
      expect(merged[0]?.eventId).toBe("r1:1");
      expect(merged[1]?.eventId).toBe("r2:1");
    });
  });

  describe("BLOCK_ORDER_STRATEGIES", () => {
    it("should export block order strategy constants", () => {
      expect(BLOCK_ORDER_STRATEGIES.TIMESTAMP).toBe("timestamp");
      expect(BLOCK_ORDER_STRATEGIES.REPLICA_ID).toBe("replica-id");
      expect(BLOCK_ORDER_STRATEGIES.LEXICOGRAPHIC).toBe("lexicographic");
    });
  });
});
