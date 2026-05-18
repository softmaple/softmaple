import { describe, expect, it } from "vitest";
import { mapSelectionThroughOperation } from "./map-selection";
import {
  POSITION_OPERATION_TYPE,
  type PositionOperation,
} from "./position-operation";

const insertAt = (index: number, length: number): PositionOperation => ({
  type: POSITION_OPERATION_TYPE.Insert,
  index,
  length,
});

const deleteAt = (index: number, length: number): PositionOperation => ({
  type: POSITION_OPERATION_TYPE.Delete,
  index,
  length,
});

describe("mapSelectionThroughOperation: insert", () => {
  it("leaves a selection strictly before the insert unchanged", () => {
    expect(
      mapSelectionThroughOperation({ from: 1, to: 3 }, insertAt(5, 4)),
    ).toEqual({
      from: 1,
      to: 3,
    });
  });

  it("shifts a selection strictly after the insert right by the inserted length", () => {
    expect(
      mapSelectionThroughOperation({ from: 6, to: 9 }, insertAt(5, 4)),
    ).toEqual({
      from: 10,
      to: 13,
    });
  });

  it("extends a selection whose range straddles the insert", () => {
    expect(
      mapSelectionThroughOperation({ from: 3, to: 8 }, insertAt(5, 4)),
    ).toEqual({
      from: 3,
      to: 12,
    });
  });

  it("shifts a collapsed selection at the insert index", () => {
    expect(
      mapSelectionThroughOperation({ from: 5, to: 5 }, insertAt(5, 2)),
    ).toEqual({
      from: 7,
      to: 7,
    });
  });

  it("keeps the trailing boundary put when insert lands exactly at `to`", () => {
    expect(
      mapSelectionThroughOperation({ from: 1, to: 3 }, insertAt(3, 2)),
    ).toEqual({ from: 1, to: 3 });
  });

  it("still advances the trailing boundary for inserts strictly inside the selection", () => {
    expect(
      mapSelectionThroughOperation({ from: 1, to: 5 }, insertAt(3, 2)),
    ).toEqual({ from: 1, to: 7 });
  });

  it("shifts a non-collapsed selection right when insert lands at `from`", () => {
    expect(
      mapSelectionThroughOperation({ from: 3, to: 5 }, insertAt(3, 2)),
    ).toEqual({ from: 5, to: 7 });
  });
});

describe("mapSelectionThroughOperation: delete", () => {
  it("leaves a selection before the delete unchanged", () => {
    expect(
      mapSelectionThroughOperation({ from: 1, to: 3 }, deleteAt(5, 4)),
    ).toEqual({
      from: 1,
      to: 3,
    });
  });

  it("shifts a selection after the delete left by the deleted length", () => {
    expect(
      mapSelectionThroughOperation({ from: 10, to: 14 }, deleteAt(5, 4)),
    ).toEqual({
      from: 6,
      to: 10,
    });
  });

  it("collapses a selection fully inside the deleted range to a point", () => {
    expect(
      mapSelectionThroughOperation({ from: 6, to: 8 }, deleteAt(5, 4)),
    ).toEqual({
      from: 5,
      to: 5,
    });
  });

  it("clamps a selection that partially overlaps the start of a deletion", () => {
    expect(
      mapSelectionThroughOperation({ from: 3, to: 7 }, deleteAt(5, 4)),
    ).toEqual({
      from: 3,
      to: 5,
    });
  });

  it("clamps a selection that partially overlaps the end of a deletion", () => {
    expect(
      mapSelectionThroughOperation({ from: 7, to: 12 }, deleteAt(5, 4)),
    ).toEqual({
      from: 5,
      to: 8,
    });
  });

  it("clamps a selection whose range fully contains a deletion", () => {
    expect(
      mapSelectionThroughOperation({ from: 2, to: 12 }, deleteAt(5, 4)),
    ).toEqual({
      from: 2,
      to: 8,
    });
  });

  it("collapses a selection whose endpoints extend past the deletion edges", () => {
    expect(
      mapSelectionThroughOperation({ from: 5, to: 9 }, deleteAt(3, 10)),
    ).toEqual({
      from: 3,
      to: 3,
    });
  });
});

describe("mapSelectionThroughOperation: invariants", () => {
  it("always returns from <= to", () => {
    const cases = [
      { range: { from: 0, to: 10 }, op: insertAt(5, 2) },
      { range: { from: 0, to: 10 }, op: deleteAt(2, 5) },
      { range: { from: 3, to: 3 }, op: deleteAt(2, 2) },
      { range: { from: 7, to: 9 }, op: deleteAt(5, 6) },
    ];
    for (const { range, op } of cases) {
      const mapped = mapSelectionThroughOperation(range, op);
      expect(mapped.from).toBeLessThanOrEqual(mapped.to);
    }
  });

  it("normalises a reversed input range (from > to) into from <= to", () => {
    expect(
      mapSelectionThroughOperation({ from: 9, to: 3 }, insertAt(5, 2)),
    ).toEqual({ from: 3, to: 11 });
  });

  it("normalises reversed input before mapping a delete overlap", () => {
    expect(
      mapSelectionThroughOperation({ from: 9, to: 3 }, deleteAt(5, 2)),
    ).toEqual({ from: 3, to: 7 });
  });

  it("maps equivalent forward and reversed ranges identically at insert boundaries", () => {
    const operation = insertAt(5, 2);

    expect(mapSelectionThroughOperation({ from: 3, to: 5 }, operation)).toEqual(
      { from: 3, to: 5 },
    );
    expect(mapSelectionThroughOperation({ from: 5, to: 3 }, operation)).toEqual(
      { from: 3, to: 5 },
    );
  });

  it("handles a collapsed selection at the end of the document through a delete before it", () => {
    // document length 7, cursor at 7 (end); delete [0, 3) → cursor shifts to 4
    expect(
      mapSelectionThroughOperation({ from: 7, to: 7 }, deleteAt(0, 3)),
    ).toEqual({ from: 4, to: 4 });
  });

  it("shrinks a selection whose trailing edge is the end of the document when a delete touches it", () => {
    // selection [3, 7], delete [4, 7) (3 chars from end) → trailing edge collapses to 4
    expect(
      mapSelectionThroughOperation({ from: 3, to: 7 }, deleteAt(4, 3)),
    ).toEqual({ from: 3, to: 4 });
  });
});
