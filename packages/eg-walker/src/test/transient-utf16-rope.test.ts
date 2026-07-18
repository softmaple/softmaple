import { describe, expect, it } from "vitest";

import {
  PersistentUtf16Rope,
  UTF16_ROPE_MAX_LEAF,
  UTF16_ROPE_MIN_LEAF,
  UTF16_ROPE_TARGET_LEAF,
} from "../text/persistent-utf16-rope";
import { TransientUtf16RopeEditor } from "../text/transient-utf16-rope";

describe("TransientUtf16RopeEditor", () => {
  it("matches sequential UTF-16 string splices", () => {
    let expected = "a".repeat(7_000);
    const editor = new TransientUtf16RopeEditor(
      PersistentUtf16Rope.from(expected),
    );
    const insert = (index: number, text: string): void => {
      editor.insert(index, text);
      expected = `${expected.slice(0, index)}${text}${expected.slice(index)}`;
    };
    const remove = (index: number, length: number): void => {
      editor.delete(index, length);
      expected = `${expected.slice(0, index)}${expected.slice(index + length)}`;
    };

    insert(3_500, "🙂XYZ");
    remove(3_490, 25);
    insert(0, "prefix");
    insert(editor.length, "suffix");
    remove(7, 1_024);
    for (let edit = 0; edit < 500; edit++) {
      const index = (edit * 7919) % (editor.length + 1);
      if (edit % 3 === 0 || editor.length === 0) {
        insert(index, String.fromCharCode(65 + (edit % 26)));
      } else {
        const deleteIndex = Math.min(index, editor.length - 1);
        remove(deleteIndex, 1);
      }
    }

    const result = editor.finish();
    expect(result.toString()).toBe(expected);
    expect(result.length).toBe(expected.length);
    for (let index = 0; index < result.length; index += 97) {
      expect(result.codeUnitAt(index)).toBe(expected.charCodeAt(index));
    }
    expect(editor.finish()).toBe(result);
    expect(() => editor.insert(0, "x")).toThrow(/finished transient/);
    expect(() => editor.delete(0, 0)).toThrow(/finished transient/);
  });

  it("retains long immutable source ranges by leaf identity", () => {
    const text = "x".repeat(UTF16_ROPE_TARGET_LEAF * 8);
    const base = PersistentUtf16Rope.from(text);
    const baseLeaves = new Set(base.getLeafIdentities());
    const editor = new TransientUtf16RopeEditor(base);

    editor.insert(UTF16_ROPE_TARGET_LEAF * 4, "middle");
    editor.delete(100, 10);
    const result = editor.finish();
    const sharedLeaves = result
      .getLeafIdentities()
      .filter((leaf) => baseLeaves.has(leaf));

    expect(result.toString()).toBe(
      `${text.slice(0, 100)}${text.slice(110, UTF16_ROPE_TARGET_LEAF * 4)}middle${text.slice(UTF16_ROPE_TARGET_LEAF * 4)}`,
    );
    expect(sharedLeaves.length).toBeGreaterThanOrEqual(
      base.getLeafIdentities().length - 4,
    );
  });

  it("compacts short source fragments while freezing", () => {
    const base = PersistentUtf16Rope.from("a".repeat(8_192));
    const baseLeaves = new Set(base.getLeafIdentities());
    const editor = new TransientUtf16RopeEditor(base);

    editor.delete(1, base.length - 2);
    editor.insert(1, "b".repeat(5_000));
    const result = editor.finish();
    const leaves = result.getLeafLengths();

    expect(result.toString()).toBe(`a${"b".repeat(5_000)}a`);
    expect(
      result.getLeafIdentities().filter((leaf) => baseLeaves.has(leaf)),
    ).toHaveLength(0);
    expect(Math.min(...leaves)).toBeGreaterThanOrEqual(UTF16_ROPE_MIN_LEAF);
    expect(Math.max(...leaves)).toBeLessThanOrEqual(UTF16_ROPE_MAX_LEAF);
  });

  it("coalesces dense edited seams instead of retaining tiny leaves", () => {
    const seamCount = 200;
    const base = PersistentUtf16Rope.from(
      "a".repeat(UTF16_ROPE_TARGET_LEAF * (seamCount + 1)),
    );
    const editor = new TransientUtf16RopeEditor(base);

    for (let seam = 1; seam <= seamCount; seam++) {
      editor.insert(seam * UTF16_ROPE_TARGET_LEAF + seam - 1, "b");
    }

    const result = editor.finish();
    const leaves = result.getLeafLengths();
    expect(result.length).toBe(base.length + seamCount);
    for (let seam = 1; seam <= seamCount; seam++) {
      expect(result.codeUnitAt(seam * UTF16_ROPE_TARGET_LEAF + seam - 1)).toBe(
        "b".charCodeAt(0),
      );
    }
    expect(Math.min(...leaves)).toBeGreaterThanOrEqual(UTF16_ROPE_MIN_LEAF);
    expect(Math.max(...leaves)).toBeLessThanOrEqual(UTF16_ROPE_MAX_LEAF);
    expect(leaves.length).toBeLessThanOrEqual(
      Math.ceil(result.length / UTF16_ROPE_TARGET_LEAF) + 1,
    );
  });

  it("leaves the base root untouched after invalid edits", () => {
    const base = PersistentUtf16Rope.from("left🙂right");
    const editor = new TransientUtf16RopeEditor(base);

    expect(() => editor.insert(base.length + 1, "x")).toThrow(
      /Invalid transient rope index/,
    );
    expect(() => editor.delete(1, base.length)).toThrow(
      /Invalid transient rope delete range/,
    );
    expect(editor.length).toBe(base.length);
    expect(editor.finish()).toBe(base);
    expect(base.toString()).toBe("left🙂right");
  });

  it("uses a fresh one-shot editor at each persistent series boundary", () => {
    const checkpoint = PersistentUtf16Rope.from("checkpoint");
    const first = new TransientUtf16RopeEditor(checkpoint);
    first.insert(checkpoint.length, "-one");
    const firstRoot = first.finish();

    const second = new TransientUtf16RopeEditor(firstRoot);
    second.delete(0, "check".length);
    second.insert(0, "next");
    const secondRoot = second.finish();

    expect(checkpoint.toString()).toBe("checkpoint");
    expect(firstRoot.toString()).toBe("checkpoint-one");
    expect(secondRoot.toString()).toBe("nextpoint-one");
  });
});
