import { describe, expect, it } from "vitest";
import { POSITION_OPERATION_TYPE } from "../mapping/position-operation";
import { mapTextareaSelectionThroughOperation } from "./textarea-selection-sync";

describe("mapTextareaSelectionThroughOperation", () => {
  it("remaps a cursor forward when a remote insert lands before it", () => {
    const mapped = mapTextareaSelectionThroughOperation(
      {
        selectionStart: 6,
        selectionEnd: 6,
        selectionDirection: "none",
      },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 2,
        length: 4,
      },
    );

    expect(mapped).toEqual({
      selectionStart: 10,
      selectionEnd: 10,
      selectionDirection: "none",
    });
  });

  it("remaps a cursor backward when a remote delete lands before it", () => {
    const mapped = mapTextareaSelectionThroughOperation(
      {
        selectionStart: 10,
        selectionEnd: 10,
        selectionDirection: "none",
      },
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 2,
        length: 4,
      },
    );

    expect(mapped).toEqual({
      selectionStart: 6,
      selectionEnd: 6,
      selectionDirection: "none",
    });
  });

  it("collapses a selection covered by a remote delete", () => {
    const mapped = mapTextareaSelectionThroughOperation(
      {
        selectionStart: 4,
        selectionEnd: 8,
        selectionDirection: "forward",
      },
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: 3,
        length: 8,
      },
    );

    expect(mapped).toEqual({
      selectionStart: 3,
      selectionEnd: 3,
      selectionDirection: "forward",
    });
  });

  it("preserves backward selection direction while normalising offsets", () => {
    const mapped = mapTextareaSelectionThroughOperation(
      {
        selectionStart: 4,
        selectionEnd: 9,
        selectionDirection: "backward",
      },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 6,
        length: 3,
      },
    );

    expect(mapped).toEqual({
      selectionStart: 4,
      selectionEnd: 12,
      selectionDirection: "backward",
    });
  });

  it("defaults missing textarea direction to none", () => {
    const mapped = mapTextareaSelectionThroughOperation(
      {
        selectionStart: 1,
        selectionEnd: 1,
      },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 2,
      },
    );

    expect(mapped.selectionDirection).toBe("none");
  });
});
