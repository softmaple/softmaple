import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { diffText, type TextChange } from "../text-diff";

describe("diffText", () => {
  it("should report an insertion at the end as a pure insert", () => {
    // Arrange / Act
    const change = diffText("Hello", "Hello!");

    // Assert
    expect(change).toEqual({ from: 5, oldTo: 5, insert: "!" });
  });

  it("should report nothing for identical text", () => {
    // Arrange / Act / Assert
    expect(diffText("unchanged", "unchanged")).toBeNull();
  });

  it("should replace a whole emoji whose low surrogate changed", () => {
    // Arrange / Act
    const change = diffText("a😀b", "a😁b");

    // Assert
    expect(change).toEqual({ from: 1, oldTo: 3, insert: "😁" });
  });

  it("should keep a changed high surrogate out of the common suffix", () => {
    // Arrange: U+1F600 and U+1F400 share their low surrogate.
    const change = diffText("x\u{1F600}", "x\u{1F400}");

    // Assert
    expect(change).toEqual({ from: 1, oldTo: 3, insert: "\u{1F400}" });
  });

  it("should always match a code point by code point comparison", () => {
    fc.assert(
      fc.property(textArbitrary, textArbitrary, (before, after) => {
        // Arrange / Act
        const change = diffText(before, after);

        // Assert
        expect(change).toEqual(diffByCodePoints(before, after));
      }),
    );
  });

  it("should always turn the old text into the new one", () => {
    fc.assert(
      fc.property(textArbitrary, textArbitrary, (before, after) => {
        // Arrange / Act
        const change = diffText(before, after);

        // Assert
        const applied =
          change === null
            ? before
            : before.slice(0, change.from) +
              change.insert +
              before.slice(change.oldTo);
        expect(applied).toBe(after);
      }),
    );
  });
});

// Helpers

/** Few distinct units, several sharing surrogate halves, so edits collide. */
const textArbitrary = fc
  .array(fc.constantFrom("a", "b", "😀", "😁", "\u{1F400}", "é"))
  .map((units) => units.join(""));

/** The previous implementation: compare arrays of code points. */
const diffByCodePoints = (before: string, after: string): TextChange | null => {
  if (before === after) {
    return null;
  }
  const beforePoints = Array.from(before);
  const afterPoints = Array.from(after);
  let prefixCount = 0;
  while (
    prefixCount < beforePoints.length &&
    prefixCount < afterPoints.length &&
    beforePoints[prefixCount] === afterPoints[prefixCount]
  ) {
    prefixCount++;
  }
  let suffixCount = 0;
  while (
    suffixCount < beforePoints.length - prefixCount &&
    suffixCount < afterPoints.length - prefixCount &&
    beforePoints[beforePoints.length - suffixCount - 1] ===
      afterPoints[afterPoints.length - suffixCount - 1]
  ) {
    suffixCount++;
  }
  const from = beforePoints.slice(0, prefixCount).join("").length;
  const oldSuffixLength = beforePoints
    .slice(beforePoints.length - suffixCount)
    .join("").length;
  const newSuffixLength = afterPoints
    .slice(afterPoints.length - suffixCount)
    .join("").length;
  return {
    from,
    oldTo: before.length - oldSuffixLength,
    insert: after.slice(from, after.length - newSuffixLength),
  };
};
