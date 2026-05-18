import { describe, expect, it } from "vitest";
import { POSITION_OPERATION_TYPE } from "../../mapping/position-operation";
import {
  applyOperationsToText,
  computeTextareaOperations,
  toTextareaOperation,
} from "./textarea-operations";

describe("computeTextareaOperations", () => {
  it("returns an empty array for a no-op", () => {
    expect(computeTextareaOperations("hello", "hello")).toEqual([]);
  });

  it("emits an insert at the start", () => {
    expect(computeTextareaOperations("world", "hello world")).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 6,
        text: "hello ",
      },
    ]);
  });

  it("emits an insert in the middle", () => {
    expect(
      computeTextareaOperations("hello world", "hello beautiful world"),
    ).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 6,
        length: 10,
        text: "beautiful ",
      },
    ]);
  });

  it("emits an insert at the end", () => {
    expect(computeTextareaOperations("hello", "hello world")).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 5,
        length: 6,
        text: " world",
      },
    ]);
  });

  it("emits a delete at the start", () => {
    expect(computeTextareaOperations("hello world", "world")).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 0,
        length: 6,
      },
    ]);
  });

  it("emits a delete in the middle", () => {
    expect(
      computeTextareaOperations("hello beautiful world", "hello world"),
    ).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 6,
        length: 10,
      },
    ]);
  });

  it("emits a delete at the end", () => {
    expect(computeTextareaOperations("hello world", "hello")).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 5,
        length: 6,
      },
    ]);
  });

  it("emits delete-then-insert for a same-length replacement", () => {
    expect(computeTextareaOperations("hello", "heLlo")).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 2,
        length: 1,
      },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 2,
        length: 1,
        text: "L",
      },
    ]);
  });

  it("emits delete-then-insert for a net-insertion replacement", () => {
    expect(computeTextareaOperations("abcXYZdef", "abc12345def")).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 3,
        length: 3,
      },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 3,
        length: 5,
        text: "12345",
      },
    ]);
  });

  it("emits delete-then-insert for a net-deletion replacement", () => {
    expect(computeTextareaOperations("abc12345def", "abcXYdef")).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 3,
        length: 5,
      },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 3,
        length: 2,
        text: "XY",
      },
    ]);
  });

  it("handles a complete-text replacement", () => {
    expect(computeTextareaOperations("abc", "xyz")).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 0,
        length: 3,
      },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 3,
        text: "xyz",
      },
    ]);
  });
});

describe("applyOperationsToText", () => {
  it("returns the input for an empty op batch", () => {
    expect(applyOperationsToText("hello", [])).toBe("hello");
  });

  it("applies an insert", () => {
    expect(
      applyOperationsToText("hello", [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 5,
          length: 6,
          text: " world",
        },
      ]),
    ).toBe("hello world");
  });

  it("applies a delete", () => {
    expect(
      applyOperationsToText("hello world", [
        { type: POSITION_OPERATION_TYPE.Delete, index: 5, length: 6 },
      ]),
    ).toBe("hello");
  });

  it("applies delete-then-insert in order", () => {
    // Mirrors `computeTextareaOperations("hello", "heLlo")` round-trip.
    expect(
      applyOperationsToText("hello", [
        { type: POSITION_OPERATION_TYPE.Delete, index: 2, length: 1 },
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 2,
          length: 1,
          text: "L",
        },
      ]),
    ).toBe("heLlo");
  });

  it("is the inverse of computeTextareaOperations for arbitrary edits", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["", "hello"],
      ["hello", ""],
      ["hello world", "hello there world"],
      ["The quick brown fox", "The slow brown fox"],
      ["abc", "abcdef"],
      ["abcdef", "abc"],
    ];
    for (const [before, after] of cases) {
      const ops = computeTextareaOperations(before, after);
      expect(applyOperationsToText(before, ops)).toBe(after);
    }
  });
});

describe("toTextareaOperation", () => {
  it("passes a delete through unchanged", () => {
    const op = {
      type: POSITION_OPERATION_TYPE.Delete,
      index: 2,
      length: 3,
    } as const;
    expect(toTextareaOperation(op, "any text")).toBe(op);
  });

  it("enriches an insert with the literal characters from the post-image", () => {
    expect(
      toTextareaOperation(
        { type: POSITION_OPERATION_TYPE.Insert, index: 5, length: 6 },
        "hello world",
      ),
    ).toEqual({
      type: POSITION_OPERATION_TYPE.Insert,
      index: 5,
      length: 6,
      text: " world",
    });
  });
});
