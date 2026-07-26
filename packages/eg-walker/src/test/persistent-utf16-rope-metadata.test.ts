import { describe, expect, it } from "vitest";

import {
  containsUtf16SurrogateCodeUnit,
  PersistentUtf16Rope,
  UTF16_ROPE_TARGET_LEAF,
} from "../text/persistent-utf16-rope";

describe("PersistentUtf16Rope UTF-16 metadata", () => {
  it("distinguishes BMP text, surrogate code units, and complete pairs", () => {
    const bmp = PersistentUtf16Rope.from("plain e\u0301 text");
    const emoji = PersistentUtf16Rope.from("A👩‍💻B");
    const loneHigh = PersistentUtf16Rope.from("\ud83d");

    expect(bmp.hasSurrogateCodeUnits).toBe(false);
    expect(bmp.hasSurrogatePairs).toBe(false);
    expect(emoji.hasSurrogateCodeUnits).toBe(true);
    expect(emoji.hasSurrogatePairs).toBe(true);
    expect(loneHigh.hasSurrogateCodeUnits).toBe(true);
    expect(loneHigh.hasSurrogatePairs).toBe(false);
    expect(containsUtf16SurrogateCodeUnit("BMP only")).toBe(false);
    expect(containsUtf16SurrogateCodeUnit("🙂")).toBe(true);
  });

  it("detects a surrogate pair split across adjacent rope leaves", () => {
    const totalLength = UTF16_ROPE_TARGET_LEAF * 2 + 1;
    const leafCount = Math.ceil(totalLength / UTF16_ROPE_TARGET_LEAF);
    const firstLeafLength = Math.ceil(totalLength / leafCount);
    const text = `${"x".repeat(firstLeafLength - 1)}😀${"y".repeat(
      totalLength - firstLeafLength - 1,
    )}`;
    const rope = PersistentUtf16Rope.from(text);

    expect(rope.getLeafLengths()[0]).toBe(firstLeafLength);
    expect(rope.hasSurrogateCodeUnits).toBe(true);
    expect(rope.hasSurrogatePairs).toBe(true);
  });

  it("recomputes exact metadata for persistent edits", () => {
    const bmp = PersistentUtf16Rope.from("ab");
    const withEmoji = bmp.insert(1, "🙂");
    const withoutEmoji = withEmoji.delete(1, 2);

    expect(bmp.hasSurrogateCodeUnits).toBe(false);
    expect(withEmoji.hasSurrogatePairs).toBe(true);
    expect(withoutEmoji.hasSurrogateCodeUnits).toBe(false);
    expect(withoutEmoji.hasSurrogatePairs).toBe(false);
    expect(withoutEmoji.toString()).toBe("ab");
  });
});
