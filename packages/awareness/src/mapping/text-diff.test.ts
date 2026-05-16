import { describe, expect, it } from "vitest";
import {
  findDeletePosition,
  findDifferingRange,
  findInsertPosition,
} from "./text-diff";

describe("findInsertPosition", () => {
  it("returns 0 when text is inserted at the start", () => {
    expect(findInsertPosition("world", "hello world")).toBe(0);
  });

  it("finds an insert in the middle", () => {
    expect(findInsertPosition("helloworld", "hello world")).toBe(5);
  });

  it("returns oldText.length when the insert is at the end", () => {
    expect(findInsertPosition("hello", "hello world")).toBe(5);
  });

  it("handles inserting into an empty string", () => {
    expect(findInsertPosition("", "abc")).toBe(0);
  });

  it("handles single-character inserts", () => {
    expect(findInsertPosition("ac", "abc")).toBe(1);
  });
});

describe("findDeletePosition", () => {
  it("returns 0 when text is deleted from the start", () => {
    expect(findDeletePosition("hello world", "world")).toBe(0);
  });

  it("finds a delete in the middle", () => {
    expect(findDeletePosition("hello world", "helloworld")).toBe(5);
  });

  it("returns newText.length when the delete is at the end", () => {
    expect(findDeletePosition("hello world", "hello")).toBe(5);
  });

  it("handles deleting to empty", () => {
    expect(findDeletePosition("abc", "")).toBe(0);
  });

  it("handles single-character deletes", () => {
    expect(findDeletePosition("abc", "ac")).toBe(1);
  });
});

describe("findDifferingRange", () => {
  it("identifies a replaced span in the middle", () => {
    expect(findDifferingRange("hello world", "hello WORLD")).toEqual({
      start: 6,
      end: 10,
    });
  });

  it("identifies a replacement at the start", () => {
    expect(findDifferingRange("hello world", "HELLO world")).toEqual({
      start: 0,
      end: 4,
    });
  });

  it("identifies a replacement at the end", () => {
    expect(findDifferingRange("hello world", "hello WORLD")).toEqual({
      start: 6,
      end: 10,
    });
  });

  it("returns end < start when strings are equal", () => {
    const result = findDifferingRange("abc", "abc");
    expect(result.end).toBeLessThan(result.start);
  });

  it("works for a single-character replacement", () => {
    expect(findDifferingRange("cat", "bat")).toEqual({ start: 0, end: 0 });
  });

  it("works for a multi-character middle replacement", () => {
    expect(findDifferingRange("abcdef", "abXYef")).toEqual({
      start: 2,
      end: 3,
    });
  });

  it("finds the outermost bounds when changes wrap around shared interior", () => {
    expect(findDifferingRange("abcde", "xbcdz")).toEqual({ start: 0, end: 4 });
  });
});
