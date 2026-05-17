import { describe, expect, it } from "vitest";
import {
  findChangedSpan,
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

  it("returns end < start when newText only appends to oldText", () => {
    const result = findDifferingRange("abc", "abcdef");
    expect(result.end).toBeLessThan(result.start);
  });

  it("reports a suffix deletion in oldText correctly", () => {
    expect(findDifferingRange("abcdef", "abc")).toEqual({ start: 3, end: 5 });
  });

  it("aligns the backward scan to each string's own length", () => {
    expect(findDifferingRange("abcde", "abXYZde")).toEqual({
      start: 2,
      end: 2,
    });
  });
});

describe("findChangedSpan", () => {
  it("returns zero-length span for equal strings", () => {
    expect(findChangedSpan("abc", "abc")).toEqual({ prefix: 3, suffix: 0 });
  });

  it("identifies a pure prefix insert", () => {
    expect(findChangedSpan("world", "hello world")).toEqual({
      prefix: 0,
      suffix: 5,
    });
  });

  it("identifies a pure suffix delete", () => {
    expect(findChangedSpan("hello world", "hello")).toEqual({
      prefix: 5,
      suffix: 0,
    });
  });

  it("identifies a same-length middle replacement", () => {
    // "abc" + "XYZ" + "def" → "abc" + "123" + "def"
    expect(findChangedSpan("abcXYZdef", "abc123def")).toEqual({
      prefix: 3,
      suffix: 3,
    });
  });

  it("identifies a net-insertion middle replacement", () => {
    // "abc" + "XYZ" + "def" → "abc" + "12345" + "def"
    expect(findChangedSpan("abcXYZdef", "abc12345def")).toEqual({
      prefix: 3,
      suffix: 3,
    });
  });

  it("identifies a net-deletion middle replacement", () => {
    // "abc" + "12345" + "def" → "abc" + "XY" + "def"
    expect(findChangedSpan("abc12345def", "abcXYdef")).toEqual({
      prefix: 3,
      suffix: 3,
    });
  });

  it("does not double-count overlapping prefix and suffix on shrinks", () => {
    // Prefix walks "ab" (matches), then stops at index 2. Suffix walks back
    // through "b" and "a" but must not cross into the prefix — `suffix` is
    // capped by the remaining length on each side.
    expect(findChangedSpan("abab", "ab")).toEqual({ prefix: 2, suffix: 0 });
  });

  it("handles insert into empty string", () => {
    expect(findChangedSpan("", "abc")).toEqual({ prefix: 0, suffix: 0 });
  });

  it("handles delete to empty string", () => {
    expect(findChangedSpan("abc", "")).toEqual({ prefix: 0, suffix: 0 });
  });
});
