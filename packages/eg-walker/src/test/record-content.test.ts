import { describe, expect, it } from "vitest";

import {
  materializeRecordContent,
  RopeRecordContent,
} from "../engine/internals/record-content";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";

describe("RopeRecordContent", () => {
  it("should preserve UTF-16 slices and reject invalid bounds", () => {
    // Arrange
    const content = RopeRecordContent.from(PersistentUtf16Rope.from("A🙂B"));

    // Act and assert
    expect(Number.isNaN(content.charCodeAt(-1))).toBe(true);
    expect(content.slice(1, 3).toString()).toBe("🙂");
    expect(() => content.slice(3, 2)).toThrow(/Invalid rope record slice/);
    expect(materializeRecordContent("abcd", 1, 3)).toBe("bc");
  });

  it("should expose structural slices that retain full rope leaves", () => {
    const rope = PersistentUtf16Rope.from("x".repeat(2_048 * 4));
    const originalLeaves = new Set(rope.getLeafIdentities());
    const content = RopeRecordContent.from(rope).slice(100, rope.length - 100);
    PersistentUtf16Rope.resetInstrumentation();

    const sliced = content.toRope();
    const sharedLeaves = sliced
      .getLeafIdentities()
      .filter((candidate) => originalLeaves.has(candidate));
    const constructionStats = PersistentUtf16Rope.getInstrumentation();

    expect(sliced.toString()).toBe("x".repeat(rope.length - 200));
    expect(sharedLeaves.length).toBeGreaterThanOrEqual(
      rope.getLeafIdentities().length - 2,
    );
    expect(constructionStats.flattenCount).toBe(0);
  });

  it("appends complete and partial rope views without materializing them", () => {
    const content = RopeRecordContent.from(PersistentUtf16Rope.from("A🙂B"));

    const assembled = PersistentUtf16Rope.assemble((assembler) => {
      content.appendTo(assembler);
      content.appendRangeTo(assembler, 1, 3);
    });

    expect(content.hasSurrogateCodeUnits).toBe(true);
    expect(assembled.toString()).toBe("A🙂B🙂");
    expect(() =>
      content.appendRangeTo(
        {
          appendText: () => undefined,
          appendRope: () => undefined,
          appendSlice: () => undefined,
        },
        -1,
        1,
      ),
    ).toThrow("Invalid rope record append range");
  });
});
