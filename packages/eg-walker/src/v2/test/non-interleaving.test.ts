import { describe, it, expect } from "vitest";
import type { CRDTRun, ExternalOperation } from "../types";
import {
  groupIntoRuns,
  ensureNonInterleaving,
  BLOCK_ORDER_STRATEGIES,
} from "../crdt/non-interleaving";
import { OPERATION_TYPE } from "../crdt/internal-state";

describe("Non-interleaving invariants", () => {
  describe("groupIntoRuns", () => {
    it("should group consecutive operations from same author", () => {
      const operations: ExternalOperation[] = [
        {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "H",
          eventId: "a1",
          authorId: "alice",
          timestamp: 100,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "e",
          eventId: "a2",
          authorId: "alice",
          timestamp: 101,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 2,
          text: "l",
          eventId: "a3",
          authorId: "alice",
          timestamp: 102,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 3,
          text: "l",
          eventId: "a4",
          authorId: "alice",
          timestamp: 103,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 4,
          text: "o",
          eventId: "a5",
          authorId: "alice",
          timestamp: 104,
        },
      ];

      const runs = groupIntoRuns(operations);
      expect(runs).toHaveLength(1);
      expect(runs[0].authorId).toBe("alice");
      expect(runs[0].operations).toHaveLength(5);
      expect(runs[0].fullText).toBe("Hello");
    });

    it("should separate operations from different authors", () => {
      const operations: ExternalOperation[] = [
        {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "H",
          eventId: "a1",
          authorId: "alice",
          timestamp: 100,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "W",
          eventId: "b1",
          authorId: "bob",
          timestamp: 100,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 2,
          text: "e",
          eventId: "a2",
          authorId: "alice",
          timestamp: 101,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 3,
          text: "o",
          eventId: "b2",
          authorId: "bob",
          timestamp: 101,
        },
      ];

      const runs = groupIntoRuns(operations);
      expect(runs).toHaveLength(2);
      expect(runs[0].authorId).toBe("alice");
      expect(runs[0].fullText).toBe("He");
      expect(runs[1].authorId).toBe("bob");
      expect(runs[1].fullText).toBe("Wo");
    });

    it("should create separate runs when author changes back", () => {
      const operations: ExternalOperation[] = [
        {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
          eventId: "a1",
          authorId: "alice",
          timestamp: 100,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "B",
          eventId: "b1",
          authorId: "bob",
          timestamp: 101,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 2,
          text: "C",
          eventId: "a2",
          authorId: "alice",
          timestamp: 102,
        },
      ];

      const runs = groupIntoRuns(operations);
      expect(runs).toHaveLength(3);
      expect(runs[0].fullText).toBe("A");
      expect(runs[1].fullText).toBe("B");
      expect(runs[2].fullText).toBe("C");
    });
  });

  describe("ensureNonInterleaving", () => {
    it('should preserve "HelloWorld" ordering with firstWriteWins', () => {
      const runs: CRDTRun[] = [
        {
          runId: "run-alice",
          authorId: "alice",
          startPosition: 0,
          fullText: "Hello",
          operations: [],
          timestamp: 100,
        },
        {
          runId: "run-bob",
          authorId: "bob",
          startPosition: 0,
          fullText: "World",
          operations: [],
          timestamp: 100,
        },
      ];

      const ordered = ensureNonInterleaving(
        runs,
        BLOCK_ORDER_STRATEGIES.firstWriteWins,
      );
      expect(ordered).toHaveLength(2);
      expect(ordered[0].authorId).toBe("alice");
      expect(ordered[1].authorId).toBe("bob");
    });

    it('should never produce interleaved "HWeolrllod"', () => {
      const runs: CRDTRun[] = [
        {
          runId: "run-alice",
          authorId: "alice",
          startPosition: 0,
          fullText: "Hello",
          operations: [],
          timestamp: 100,
        },
        {
          runId: "run-bob",
          authorId: "bob",
          startPosition: 0,
          fullText: "World",
          operations: [],
          timestamp: 100,
        },
      ];

      // Try all strategies to ensure none produce interleaving
      for (const strategy of Object.values(BLOCK_ORDER_STRATEGIES)) {
        const ordered = ensureNonInterleaving(runs, strategy);
        const text = ordered.map((run) => run.fullText).join("");

        // Must be either "HelloWorld" or "WorldHello", never interleaved
        expect(text === "HelloWorld" || text === "WorldHello").toBe(true);
        expect(text).not.toBe("HWeolrllod");
        expect(text).not.toContain("HW");
        expect(text).not.toContain("Wello");
      }
    });
  });
});
