import { OPERATION_TYPE } from "../crdt/internal-state";
import { OPERATION_TYPE } from "../crdt/internal-state";
import { describe, it, expect } from "vitest";
import type { ExternalOperation, DocumentState } from "../types";
import {
  verifyStrongListSpecification,
  ensureConvergence,
  validateIndexBounds,
} from "../core/invariants";

describe("Strong List Specification", () => {
  describe("verifyStrongListSpecification", () => {
    it("should verify sequential semantics are preserved", () => {
      const state: DocumentState = {
        text: "Hello World",
        version: 2,
      };

      const operations: ExternalOperation[] = [
        {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "H",
          eventId: "e1",
          authorId: "alice",
          timestamp: 100,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 1,
          text: "ello",
          eventId: "e2",
          authorId: "alice",
          timestamp: 101,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 5,
          text: " ",
          eventId: "e3",
          authorId: "alice",
          timestamp: 102,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 6,
          text: "World",
          eventId: "e4",
          authorId: "alice",
          timestamp: 103,
        },
      ];

      const result = verifyStrongListSpecification(state, operations);

      expect(result.valid).toBe(true);
      expect(result.finalText).toBe("Hello World");
      expect(result.errors).toHaveLength(0);
    });

    it("should detect violations of sequential semantics", () => {
      const state: DocumentState = {
        text: "ABC",
        version: 1,
      };

      const operations: ExternalOperation[] = [
        // Invalid: index out of bounds
        {
          type: OPERATION_TYPE.INSERT,
          index: 10,
          text: "X",
          eventId: "e1",
          authorId: "alice",
          timestamp: 100,
        },
      ];

      const result = verifyStrongListSpecification(state, operations);

      expect(result.valid).toBe(false);
      expect(result.errors).not.toHaveLength(0);
      expect(result.errors[0]).toContain("out of bounds");
    });

    it("should handle delete operations correctly", () => {
      const state: DocumentState = {
        text: "Hello World",
        version: 1,
      };

      const operations: ExternalOperation[] = [
        {
          type: OPERATION_TYPE.DELETE,
          index: 5,
          length: 6,
          eventId: "e1",
          authorId: "alice",
          timestamp: 100,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 5,
          text: "TypeScript",
          eventId: "e2",
          authorId: "alice",
          timestamp: 101,
        },
      ];

      const result = verifyStrongListSpecification(state, operations);

      expect(result.valid).toBe(true);
      expect(result.finalText).toBe("HelloTypeScript");
    });

    it("should simulate operations sequentially", () => {
      const state: DocumentState = {
        text: "",
        version: 0,
      };

      const operations: ExternalOperation[] = [
        {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "A",
          eventId: "e1",
          authorId: "alice",
          timestamp: 100,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "B",
          eventId: "e2",
          authorId: "bob",
          timestamp: 101,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 2,
          text: "C",
          eventId: "e3",
          authorId: "charlie",
          timestamp: 102,
        },
      ];

      const result = verifyStrongListSpecification(state, operations);

      expect(result.valid).toBe(true);
      expect(result.finalText).toBe("BAC");
      expect(result.intermediateStates).toHaveLength(3);
      expect(result.intermediateStates[0]).toBe("A");
      expect(result.intermediateStates[1]).toBe("BA");
      expect(result.intermediateStates[2]).toBe("BAC");
    });
  });

  describe("ensureConvergence", () => {
    it("should verify that same operations produce same result", () => {
      const state1: DocumentState = { text: "", version: 0 };
      const state2: DocumentState = { text: "", version: 0 };

      const operations: ExternalOperation[] = [
        {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "Hello",
          eventId: "e1",
          authorId: "alice",
          timestamp: 100,
        },
        {
          type: OPERATION_TYPE.INSERT,
          index: 5,
          text: " World",
          eventId: "e2",
          authorId: "bob",
          timestamp: 200,
        },
      ];

      const convergence = ensureConvergence(state1, state2, operations);

      expect(convergence.converged).toBe(true);
      expect(convergence.finalState1.text).toBe("Hello World");
      expect(convergence.finalState2.text).toBe("Hello World");
      expect(convergence.finalState1.text).toBe(convergence.finalState2.text);
    });

    it("should detect divergence when operations produce different results", () => {
      const state1: DocumentState = { text: "A", version: 1 };
      const state2: DocumentState = { text: "B", version: 1 };

      const operations: ExternalOperation[] = [
        {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "X",
          eventId: "e1",
          authorId: "alice",
          timestamp: 100,
        },
      ];

      const convergence = ensureConvergence(state1, state2, operations);

      expect(convergence.converged).toBe(false);
      expect(convergence.finalState1.text).toBe("XA");
      expect(convergence.finalState2.text).toBe("XB");
      expect(convergence.divergencePoint).toBe(0);
    });

    it("should handle empty operation list", () => {
      const state1: DocumentState = { text: "Same", version: 1 };
      const state2: DocumentState = { text: "Same", version: 1 };

      const operations: ExternalOperation[] = [];

      const convergence = ensureConvergence(state1, state2, operations);

      expect(convergence.converged).toBe(true);
      expect(convergence.finalState1.text).toBe("Same");
      expect(convergence.finalState2.text).toBe("Same");
    });
  });

  describe("validateIndexBounds", () => {
    it("should validate insert index bounds", () => {
      const state: DocumentState = { text: "Hello", version: 1 };

      const validOp: ExternalOperation = {
        type: OPERATION_TYPE.INSERT,
        index: 5,
        text: "!",
        eventId: "e1",
        authorId: "alice",
        timestamp: 100,
      };

      const invalidOp: ExternalOperation = {
        type: OPERATION_TYPE.INSERT,
        index: 10,
        text: "!",
        eventId: "e2",
        authorId: "alice",
        timestamp: 101,
      };

      expect(validateIndexBounds(state, validOp).valid).toBe(true);
      expect(validateIndexBounds(state, invalidOp).valid).toBe(false);
      expect(validateIndexBounds(state, invalidOp).error).toContain(
        "out of bounds",
      );
    });

    it("should validate delete index and length bounds", () => {
      const state: DocumentState = { text: "Hello World", version: 1 };

      const validDelete: ExternalOperation = {
        type: OPERATION_TYPE.DELETE,
        index: 6,
        length: 5,
        eventId: "e1",
        authorId: "alice",
        timestamp: 100,
      };

      const invalidDelete1: ExternalOperation = {
        type: OPERATION_TYPE.DELETE,
        index: 15,
        length: 1,
        eventId: "e2",
        authorId: "alice",
        timestamp: 101,
      };

      const invalidDelete2: ExternalOperation = {
        type: OPERATION_TYPE.DELETE,
        index: 5,
        length: 20,
        eventId: "e3",
        authorId: "alice",
        timestamp: 102,
      };

      expect(validateIndexBounds(state, validDelete).valid).toBe(true);
      expect(validateIndexBounds(state, invalidDelete1).valid).toBe(false);
      expect(validateIndexBounds(state, invalidDelete2).valid).toBe(false);
    });

    it("should allow insert at text length (append)", () => {
      const state: DocumentState = { text: "Hello", version: 1 };

      const appendOp: ExternalOperation = {
        type: OPERATION_TYPE.INSERT,
        index: 5, // Equal to text.length
        text: "!",
        eventId: "e1",
        authorId: "alice",
        timestamp: 100,
      };

      expect(validateIndexBounds(state, appendOp).valid).toBe(true);
    });

    it("should handle negative indices", () => {
      const state: DocumentState = { text: "Hello", version: 1 };

      const negativeInsert: ExternalOperation = {
        type: OPERATION_TYPE.INSERT,
        index: -1,
        text: "X",
        eventId: "e1",
        authorId: "alice",
        timestamp: 100,
      };

      const negativeDelete: ExternalOperation = {
        type: OPERATION_TYPE.DELETE,
        index: -1,
        length: 1,
        eventId: "e2",
        authorId: "alice",
        timestamp: 101,
      };

      expect(validateIndexBounds(state, negativeInsert).valid).toBe(false);
      expect(validateIndexBounds(state, negativeDelete).valid).toBe(false);
    });
  });
});
