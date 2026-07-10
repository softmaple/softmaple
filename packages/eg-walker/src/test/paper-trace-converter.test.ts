import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  convertPaperTraceToAtomicEvents,
  type AtomicPaperTrace,
} from "../conformance/paper-trace-converter";
import { EgWalkerEngine } from "../engine/eg-walker-engine";

describe("convertPaperTraceToAtomicEvents", () => {
  it("should convert scalar offsets to UTF-16 operation offsets", () => {
    // Arrange
    const trace: AtomicPaperTrace = {
      endContent: "a😀",
      txns: [
        {
          parents: [],
          agent: 0,
          patches: [
            [0, 0, "a😀b"],
            [2, 1, ""],
          ],
          _dtSpan: [0, 4],
        },
      ],
    };

    // Act
    const events = convertPaperTraceToAtomicEvents("unicode", trace);

    // Assert
    expect(events.map((event) => event.operation)).toEqual([
      { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      { type: OPERATION_TYPE.INSERT, index: 1, text: "😀" },
      { type: OPERATION_TYPE.INSERT, index: 3, text: "b" },
      { type: OPERATION_TYPE.DELETE, index: 3, length: 1 },
    ]);
  });

  it("should reconstruct Unicode offsets for a multi-parent transaction", () => {
    // Arrange
    const trace: AtomicPaperTrace = {
      endContent: "A😀B!",
      txns: [
        {
          parents: [],
          agent: "alice",
          patches: [[0, 0, "😀"]],
          _dtSpan: [0, 1],
        },
        {
          parents: [0],
          agent: "bob",
          patches: [[0, 0, "A"]],
          _dtSpan: [1, 2],
        },
        {
          parents: [0],
          agent: "carol",
          patches: [[1, 0, "B"]],
          _dtSpan: [2, 3],
        },
        {
          parents: [1, 2],
          agent: "dora",
          patches: [[3, 0, "!"]],
          _dtSpan: [3, 4],
        },
      ],
    };

    // Act
    const events = convertPaperTraceToAtomicEvents("merge-unicode", trace);

    // Assert
    expect(events.at(-1)?.operation).toEqual({
      type: OPERATION_TYPE.INSERT,
      index: 4,
      text: "!",
    });
  });

  it("should reject a converted trace whose final text is incorrect", () => {
    // Arrange
    const trace: AtomicPaperTrace = {
      endContent: "wrong",
      txns: [
        {
          parents: [],
          agent: 0,
          patches: [[0, 0, "right"]],
        },
      ],
    };

    // Act / Assert
    expect(() => convertPaperTraceToAtomicEvents("invalid", trace)).toThrow(
      /converted final text mismatch/,
    );
  });

  it("validates with an independent scalar oracle, not EgWalkerEngine", () => {
    const trace: AtomicPaperTrace = {
      endContent: "A😀B",
      txns: [
        {
          parents: [],
          agent: "alice",
          patches: [[0, 0, "😀"]],
          _dtSpan: [0, 1],
        },
        {
          parents: [0],
          agent: "bob",
          patches: [[0, 0, "A"]],
          _dtSpan: [1, 2],
        },
        {
          parents: [0],
          agent: "carol",
          patches: [[1, 0, "B"]],
          _dtSpan: [2, 3],
        },
      ],
    };
    const engine = vi
      .spyOn(EgWalkerEngine.prototype, "generate")
      .mockImplementation(() => {
        throw new Error("implementation under test must not be called");
      });

    try {
      expect(
        convertPaperTraceToAtomicEvents("independent", trace),
      ).toHaveLength(3);
    } finally {
      engine.mockRestore();
    }
  });
});
