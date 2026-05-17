import { describe, expect, it } from "vitest";
import { findChangedSpan } from "../../lib/text-diff";

describe("text-diff utilities", () => {
  describe("findChangedSpan", () => {
    it("should identify no-op changes", () => {
      expect(findChangedSpan("hello", "hello")).toEqual({
        prefix: 5,
        suffix: 0,
      });
    });

    it("should identify insertion at the beginning", () => {
      expect(findChangedSpan("world", "hello world")).toEqual({
        prefix: 0,
        suffix: 5,
      });
    });

    it("should identify insertion in the middle", () => {
      expect(findChangedSpan("hello world", "hello beautiful world")).toEqual({
        prefix: 6,
        suffix: 5,
      });
    });

    it("should identify insertion at the end", () => {
      expect(findChangedSpan("hello", "hello world")).toEqual({
        prefix: 5,
        suffix: 0,
      });
    });

    it("should identify deletion at the beginning", () => {
      expect(findChangedSpan("hello world", "world")).toEqual({
        prefix: 0,
        suffix: 5,
      });
    });

    it("should identify deletion in the middle", () => {
      expect(findChangedSpan("hello beautiful world", "hello world")).toEqual({
        prefix: 6,
        suffix: 5,
      });
    });

    it("should identify deletion at the end", () => {
      expect(findChangedSpan("hello world", "hello")).toEqual({
        prefix: 5,
        suffix: 0,
      });
    });

    it("should identify same-length replacement", () => {
      expect(findChangedSpan("hello world", "hello WORLD")).toEqual({
        prefix: 6,
        suffix: 0,
      });
    });

    it("should identify replacement with net insertion", () => {
      expect(findChangedSpan("abcXYZdef", "abc12345def")).toEqual({
        prefix: 3,
        suffix: 3,
      });
    });

    it("should identify replacement with net deletion", () => {
      expect(findChangedSpan("abc12345def", "abcXYdef")).toEqual({
        prefix: 3,
        suffix: 3,
      });
    });

    it("should handle complete replacement", () => {
      expect(findChangedSpan("abc", "xyz")).toEqual({
        prefix: 0,
        suffix: 0,
      });
    });
  });
});
