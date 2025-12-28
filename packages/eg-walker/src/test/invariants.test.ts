import { OPERATION_TYPE } from "../constants/operation-types";
import { describe, it, expect } from "vitest";
import type { GraphEvent, ExternalOperation } from "../types";
import {
  verifyStrongListSpecification,
  ensureConvergence,
  validateIndexBounds,
  applyOperation,
  createDocumentState,
  topologicalSort,
  linearizeEvents,
  StrongListInvariant,
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
      } as ExternalOperation);
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
        } as ExternalOperation),
      ).toThrow("Unknown operation type");
    });
  });

  describe("createDocumentState", () => {
    it("should create document state from text", () => {
      const state = createDocumentState("Hello World");
      expect(state.text).toBe("Hello World");
    });

    it("should freeze the document state", () => {
      const state = createDocumentState("test");
      expect(Object.isFrozen(state)).toBe(true);
      expect(() => {
        // @ts-expect-error - Testing frozen object modification
        state.text = "modified";
      }).toThrow();
    });
  });
});

describe("Section 3.1: verifyStrongListSpecification", () => {
  it("should return false for events with missing dependencies", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(["missing-parent"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "test" },
      },
    ];

    expect(verifyStrongListSpecification(events)).toBe(false);
  });

  it("should return false for invalid INSERT operations", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: -1, text: "test" },
      },
    ];

    expect(verifyStrongListSpecification(events)).toBe(false);
  });

  it("should return false for INSERT with empty text", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "" },
      },
    ];

    expect(verifyStrongListSpecification(events)).toBe(false);
  });

  it("should return false for invalid DELETE operations", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.DELETE, index: -1, length: 5 },
      },
    ];

    expect(verifyStrongListSpecification(events)).toBe(false);
  });

  it("should return false for DELETE with zero length", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 0 },
      },
    ];

    expect(verifyStrongListSpecification(events)).toBe(false);
  });

  it("should return false for unknown operation type", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        // @ts-expect-error - Testing with invalid operation type
        operation: { type: "UNKNOWN" },
      },
    ];

    expect(verifyStrongListSpecification(events)).toBe(false);
  });
});

describe("Section 3.1: validateIndexBounds", () => {
  it("should validate DELETE with exact bounds", () => {
    const text = "hello";
    const operation = { type: OPERATION_TYPE.DELETE, index: 0, length: 5 };

    expect(validateIndexBounds(text, operation)).toBe(true);
  });

  it("should reject DELETE with zero length", () => {
    const text = "hello";
    const operation = { type: OPERATION_TYPE.DELETE, index: 0, length: 0 };

    expect(validateIndexBounds(text, operation)).toBe(false);
  });

  it("should reject unknown operation type", () => {
    const text = "hello";
    const operation = { type: "UNKNOWN" } as unknown as ExternalOperation;

    expect(validateIndexBounds(text, operation)).toBe(false);
  });

  it("should validate INSERT at end of text", () => {
    const text = "hello";
    const operation = { type: OPERATION_TYPE.INSERT, index: 5, text: "!" };

    expect(validateIndexBounds(text, operation)).toBe(true);
  });
});

describe("Section 3.1: ensureConvergence", () => {
  it("should return false for events with cycles", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(["e2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b" },
      },
    ];

    expect(ensureConvergence(events)).toBe(false);
  });

  it("should return false for invalid operations during linearization", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.DELETE, index: 100, length: 5 },
      },
    ];

    expect(ensureConvergence(events)).toBe(false);
  });

  it("should handle valid convergent events", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "hello" },
      },
    ];

    expect(ensureConvergence(events)).toBe(true);
  });
});

describe("Section 3.1: topologicalSort", () => {
  it("should handle events with empty parent version", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "test" },
      },
    ];

    const sorted = topologicalSort(events);
    expect(sorted.length).toBe(1);
    expect(sorted[0]?.id).toBe("e1");
  });

  it("should throw on cycle detection", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(["e2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b" },
      },
    ];

    expect(() => topologicalSort(events)).toThrow("Cycle detected");
  });

  it("should handle complex dependency chains", () => {
    const events: GraphEvent[] = [
      {
        id: "e3",
        timestamp: Date.now(),
        parentVersion: new Set(["e1", "e2"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "c" },
      },
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "b" },
      },
    ];

    const sorted = topologicalSort(events);
    expect(sorted.length).toBe(3);
    // e1 must come first, then e2, then e3
    expect(sorted[0]?.id).toBe("e1");
    expect(sorted[1]?.id).toBe("e2");
    expect(sorted[2]?.id).toBe("e3");
  });
});

describe("Section 3.1: linearizeEvents", () => {
  it("should handle initial text parameter", () => {
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: " world" },
      },
    ];

    const result = linearizeEvents(events, "hello");
    expect(result).toBe("hello world");
  });

  it("should apply events in causal order", () => {
    const events: GraphEvent[] = [
      {
        id: "e2",
        timestamp: Date.now(),
        parentVersion: new Set(["e1"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: " world" },
      },
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "hello" },
      },
    ];

    const result = linearizeEvents(events);
    expect(result).toBe("hello world");
  });
});

describe("Section 3.1: StrongListInvariant class", () => {
  it("should check state equivalence correctly", () => {
    const invariant = new StrongListInvariant();
    const state1 = createDocumentState("hello");
    const state2 = createDocumentState("hello");
    const state3 = createDocumentState("world");

    expect(invariant.equivalent(state1, state2)).toBe(true);
    expect(invariant.equivalent(state1, state3)).toBe(false);
  });

  it("should verify events with valid causal order", () => {
    const invariant = new StrongListInvariant();
    const events: GraphEvent[] = [
      {
        id: "e1",
        timestamp: Date.now(),
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "hello" },
      },
    ];

    expect(invariant.verify(events)).toBe(true);
  });
});
