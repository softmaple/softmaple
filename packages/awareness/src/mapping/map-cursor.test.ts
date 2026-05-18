import { describe, expect, it } from "vitest";
import { mapCursorThroughOperation } from "./map-cursor";
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

describe("mapCursorThroughOperation: insert", () => {
  it("leaves a cursor strictly before the insert unchanged", () => {
    expect(mapCursorThroughOperation(2, insertAt(5, 3))).toBe(2);
  });

  it("shifts a cursor at the insert index right by the inserted length", () => {
    expect(mapCursorThroughOperation(5, insertAt(5, 3))).toBe(8);
  });

  it("shifts a cursor after the insert right by the inserted length", () => {
    expect(mapCursorThroughOperation(10, insertAt(5, 3))).toBe(13);
  });

  it("handles a zero-length insert as a no-op", () => {
    expect(mapCursorThroughOperation(5, insertAt(3, 0))).toBe(5);
  });

  it("handles an insert at index 0", () => {
    expect(mapCursorThroughOperation(0, insertAt(0, 4))).toBe(4);
    expect(mapCursorThroughOperation(7, insertAt(0, 4))).toBe(11);
  });
});

describe("mapCursorThroughOperation: delete", () => {
  it("leaves a cursor before the delete unchanged", () => {
    expect(mapCursorThroughOperation(2, deleteAt(5, 3))).toBe(2);
  });

  it("leaves a cursor at the start of the deleted range unchanged", () => {
    expect(mapCursorThroughOperation(5, deleteAt(5, 3))).toBe(5);
  });

  it("collapses a cursor inside the deleted range to the deletion start", () => {
    expect(mapCursorThroughOperation(6, deleteAt(5, 3))).toBe(5);
    expect(mapCursorThroughOperation(7, deleteAt(5, 3))).toBe(5);
  });

  it("shifts a cursor at the deletion end left by the deleted length", () => {
    expect(mapCursorThroughOperation(8, deleteAt(5, 3))).toBe(5);
  });

  it("shifts a cursor after the deletion left by the deleted length", () => {
    expect(mapCursorThroughOperation(12, deleteAt(5, 3))).toBe(9);
  });

  it("handles a zero-length delete as a no-op", () => {
    expect(mapCursorThroughOperation(5, deleteAt(3, 0))).toBe(5);
  });

  it("handles a delete at index 0", () => {
    expect(mapCursorThroughOperation(0, deleteAt(0, 4))).toBe(0);
    expect(mapCursorThroughOperation(2, deleteAt(0, 4))).toBe(0);
    expect(mapCursorThroughOperation(10, deleteAt(0, 4))).toBe(6);
  });
});

describe("mapCursorThroughOperation: boundary — end of document", () => {
  it("shifts a cursor at the end of the document when an insert occurs before it", () => {
    // document "hello" (length 5), cursor at 5 (after last char), insert 3 chars at 0
    expect(mapCursorThroughOperation(5, insertAt(0, 3))).toBe(8);
  });

  it("shifts a cursor at the very end when the insert lands at the same end position", () => {
    // Cursor at 5 = insert index 5: right-biased, shifts forward
    expect(mapCursorThroughOperation(5, insertAt(5, 2))).toBe(7);
  });

  it("shifts a cursor at the end left when a delete lands before it", () => {
    // document "hello world" (length 11), cursor at 11, delete [5, 11) → cursor 5
    expect(mapCursorThroughOperation(11, deleteAt(5, 6))).toBe(5);
  });

  it("handles a cursor at index 0 in an empty document through a zero-length insert", () => {
    expect(mapCursorThroughOperation(0, insertAt(0, 0))).toBe(0);
  });
});
