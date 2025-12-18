import { OPERATION_TYPE } from "../constants/operation-types";
import { describe, it, expect } from "vitest";
import type { GraphEvent } from "../types";
import {
  verifyStrongListSpecification,
  ensureConvergence,
  validateIndexBounds,
  applyOperation,
  createDocumentState,
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
      const result = validateIndexBounds("Hello", {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "X",
      });
      expect(result).toBe(true);

      const invalidResult = validateIndexBounds("Hello", {
        type: OPERATION_TYPE.INSERT,
        index: 10,
        text: "X",
      });
      expect(invalidResult).toBe(false);
    });

    it("should validate delete operations", () => {
      const result = validateIndexBounds("Hello", {
        type: OPERATION_TYPE.DELETE,
        index: 0,
        length: 2,
      });
      expect(result).toBe(true);

      const invalidResult = validateIndexBounds("Hello", {
        type: OPERATION_TYPE.DELETE,
        index: 3,
        length: 5,
      });
      expect(invalidResult).toBe(false);
    });

    it("should reject unknown operation types", () => {
      const invalidResult = validateIndexBounds("Hello", {
        type: "UNKNOWN" as any,
        index: 0,
      });
      expect(invalidResult).toBe(false);
    });
  });

  describe("applyOperation", () => {
    it("should insert text at index", () => {
      const result = applyOperation("Hello", {
        type: OPERATION_TYPE.INSERT,
        index: 5,
        text: " World",
      });
      expect(result).toBe("Hello World");
    });

    it("should throw error for invalid insert index", () => {
      expect(() =>
        applyOperation("Hello", {
          type: OPERATION_TYPE.INSERT,
          index: 10,
          text: "X",
        }),
      ).toThrow("Invalid insert index");

      expect(() =>
        applyOperation("Hello", {
          type: OPERATION_TYPE.INSERT,
          index: -1,
          text: "X",
        }),
      ).toThrow("Invalid insert index");
    });

    it("should delete text at range", () => {
      const result = applyOperation("Hello World", {
        type: OPERATION_TYPE.DELETE,
        index: 5,
        length: 6,
      });
      expect(result).toBe("Hello");
    });

    it("should throw error for invalid delete range", () => {
      expect(() =>
        applyOperation("Hello", {
          type: OPERATION_TYPE.DELETE,
          index: 3,
          length: 5,
        }),
      ).toThrow("Invalid delete range");

      expect(() =>
        applyOperation("Hello", {
          type: OPERATION_TYPE.DELETE,
          index: -1,
          length: 1,
        }),
      ).toThrow("Invalid delete range");
    });

    it("should throw error for unknown operation type", () => {
      expect(() =>
        applyOperation("Hello", {
          type: "UNKNOWN" as any,
          index: 0,
        }),
      ).toThrow("Unknown operation type");
    });
  });

  describe("createDocumentState", () => {
    it("should create document state from text", () => {
      const state = createDocumentState("Hello World");
      expect(state.text).toBe("Hello World");
    });
  });
});
