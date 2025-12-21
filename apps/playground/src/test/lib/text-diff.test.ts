import { describe, it, expect } from "vitest";
import {
  findInsertPosition,
  findDeletePosition,
  findDifferingRange,
} from "../../lib/text-diff";

describe("text-diff utilities", () => {
  describe("findInsertPosition", () => {
    it("should find insertion at the beginning", () => {
      const oldText = "world";
      const newText = "hello world";
      expect(findInsertPosition(oldText, newText)).toBe(0);
    });

    it("should find insertion in the middle", () => {
      const oldText = "hello world";
      const newText = "hello beautiful world";
      expect(findInsertPosition(oldText, newText)).toBe(6);
    });

    it("should find insertion at the end", () => {
      const oldText = "hello";
      const newText = "hello world";
      expect(findInsertPosition(oldText, newText)).toBe(5);
    });

    it("should handle empty old text", () => {
      const oldText = "";
      const newText = "hello";
      expect(findInsertPosition(oldText, newText)).toBe(0);
    });

    it("should handle single character insertion", () => {
      const oldText = "hllo";
      const newText = "hello";
      expect(findInsertPosition(oldText, newText)).toBe(1);
    });
  });

  describe("findDeletePosition", () => {
    it("should find deletion at the beginning", () => {
      const oldText = "hello world";
      const newText = "world";
      expect(findDeletePosition(oldText, newText)).toBe(0);
    });

    it("should find deletion in the middle", () => {
      const oldText = "hello beautiful world";
      const newText = "hello world";
      expect(findDeletePosition(oldText, newText)).toBe(6);
    });

    it("should find deletion at the end", () => {
      const oldText = "hello world";
      const newText = "hello";
      expect(findDeletePosition(oldText, newText)).toBe(5);
    });

    it("should handle complete deletion", () => {
      const oldText = "hello";
      const newText = "";
      expect(findDeletePosition(oldText, newText)).toBe(0);
    });

    it("should handle single character deletion", () => {
      const oldText = "hello";
      const newText = "hllo";
      expect(findDeletePosition(oldText, newText)).toBe(1);
    });
  });

  describe("findDifferingRange", () => {
    it("should find differing range at the beginning", () => {
      const oldText = "hello world";
      const newText = "HELLO world";
      const result = findDifferingRange(oldText, newText);
      expect(result).toEqual({ start: 0, end: 4 });
    });

    it("should find differing range in the middle", () => {
      const oldText = "hello world";
      const newText = "hello WORLD";
      const result = findDifferingRange(oldText, newText);
      expect(result).toEqual({ start: 6, end: 10 });
    });

    it("should find differing range at the end", () => {
      const oldText = "hello world";
      const newText = "hello worlD";
      const result = findDifferingRange(oldText, newText);
      expect(result).toEqual({ start: 10, end: 10 });
    });

    it("should find differing range for complete replacement", () => {
      const oldText = "abc";
      const newText = "xyz";
      const result = findDifferingRange(oldText, newText);
      expect(result).toEqual({ start: 0, end: 2 });
    });

    it("should find differing range for single character", () => {
      const oldText = "hello";
      const newText = "heLlo";
      const result = findDifferingRange(oldText, newText);
      expect(result).toEqual({ start: 2, end: 2 });
    });

    it("should handle multiple differing ranges by finding outermost bounds", () => {
      const oldText = "abcde";
      const newText = "xbcdz";
      const result = findDifferingRange(oldText, newText);
      expect(result).toEqual({ start: 0, end: 4 });
    });

    it("should handle identical strings", () => {
      const oldText = "hello";
      const newText = "hello";
      const result = findDifferingRange(oldText, newText);
      // When strings are identical, start > end
      expect(result.start).toBeGreaterThan(result.end);
    });
  });
});
