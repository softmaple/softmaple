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
});
