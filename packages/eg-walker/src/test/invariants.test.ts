import { OPERATION_TYPE } from "../constants/operation-types";
import { describe, it, expect } from "vitest";
import type { GraphEvent, ExternalOperation } from "../types";
import {
  applyOperation,
  createDocumentState,
  topologicalSort,
  linearizeEvents,
} from "../core/invariants";

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
      // @ts-expect-error: intentionally passing an invalid operation type to assert runtime error handling
      applyOperation("Hello", {
        type: "UNKNOWN",
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

describe("topologicalSort", () => {
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

describe("linearizeEvents", () => {
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
