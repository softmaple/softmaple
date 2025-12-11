import { OPERATION_TYPE } from "../crdt/internal-state";
import { describe, it, expect } from "vitest";
import type { GraphEvent } from "../types";
import {
  verifyStrongListSpecification,
  ensureConvergence,
  validateIndexBounds,
} from "../core/invariants";

describe("Strong List Specification", () => {
  describe("verifyStrongListSpecification", () => {
    it("should verify sequential semantics are preserved", () => {
      const events: GraphEvent[] = [
        {
          id: "e1",
          timestamp: 100,
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "Hello",
          },
        },
        {
          id: "e2",
          timestamp: 101,
          parentVersion: new Set(["e1"]),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 5,
            text: " World",
          },
        },
      ];

      const result = verifyStrongListSpecification(events);
      expect(result).toBe(true);
    });
  });

  describe("ensureConvergence", () => {
    it("should verify convergence across replicas", () => {
      const events: GraphEvent[] = [
        {
          id: "e1",
          timestamp: 100,
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "A",
          },
        },
        {
          id: "e2",
          timestamp: 101,
          parentVersion: new Set(),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: "B",
          },
        },
      ];

      const result = ensureConvergence(events);
      expect(result).toBe(true);
    });
  });

  describe("validateIndexBounds", () => {
   it("should validate index bounds", () => {
     const result = validateIndexBounds("Hello", 0);
     expect(result).toBe(true);

     const invalidResult = validateIndexBounds("Hello", 10);
     expect(invalidResult).toBe(false);
   });
  });
});
