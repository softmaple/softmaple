import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  PersistentUtf16Rope,
  UTF16_ROPE_BRANCH_FACTOR,
  UTF16_ROPE_MAX_LEAF,
  UTF16_ROPE_MIN_LEAF,
  UTF16_ROPE_TARGET_LEAF,
} from "../text/persistent-utf16-rope";

describe("PersistentUtf16Rope", () => {
  it.each([
    1_023, 1_024, 2_048, 4_096, 4_097, 131_073,
  ])("balances %i UTF-16 code units within leaf/fan-out bounds", (length) => {
    const rope = PersistentUtf16Rope.from("x".repeat(length));
    const leaves = rope.getLeafLengths();

    expect(rope.getMaxBranchWidth()).toBeLessThanOrEqual(
      UTF16_ROPE_BRANCH_FACTOR,
    );
    if (leaves.length > 1) {
      expect(Math.min(...leaves)).toBeGreaterThanOrEqual(UTF16_ROPE_MIN_LEAF);
    }
    expect(Math.max(...leaves)).toBeLessThanOrEqual(UTF16_ROPE_MAX_LEAF);
  });

  it("supports boundary-spanning UTF-16 edits and slices", () => {
    const originalText = "a".repeat(UTF16_ROPE_TARGET_LEAF) + "😀tail";
    const original = PersistentUtf16Rope.from(originalText);

    const inserted = original.insert(UTF16_ROPE_TARGET_LEAF - 1, "XYZ");
    const deleted = inserted.delete(UTF16_ROPE_TARGET_LEAF, 4);

    expect(inserted.toString()).toBe(
      `${originalText.slice(0, UTF16_ROPE_TARGET_LEAF - 1)}XYZ${originalText.slice(UTF16_ROPE_TARGET_LEAF - 1)}`,
    );
    expect(
      deleted.slice(UTF16_ROPE_TARGET_LEAF - 3, UTF16_ROPE_TARGET_LEAF + 5),
    ).toBe(
      deleted
        .toString()
        .slice(UTF16_ROPE_TARGET_LEAF - 3, UTF16_ROPE_TARGET_LEAF + 5),
    );
    expect(original.toString()).toBe(originalText);
  });

  it("rebalances underfilled boundary leaves after deletion", () => {
    const original = PersistentUtf16Rope.from("x".repeat(5_000));
    const edited = original.delete(0, 1_000);

    expect(edited.toString()).toBe("x".repeat(4_000));
    expect(Math.min(...edited.getLeafLengths())).toBeGreaterThanOrEqual(
      UTF16_ROPE_MIN_LEAF,
    );
    expect(Math.max(...edited.getLeafLengths())).toBeLessThanOrEqual(
      UTF16_ROPE_MAX_LEAF,
    );
  });

  it("uses multi-level fan-out and shares untouched leaves", () => {
    const text = "x".repeat(
      UTF16_ROPE_TARGET_LEAF * (UTF16_ROPE_BRANCH_FACTOR + 2),
    );
    const original = PersistentUtf16Rope.from(text);
    const edited = original.insert(1, "!");
    const oldLeaves = new Set(original.getLeafIdentities());
    const shared = edited
      .getLeafIdentities()
      .filter((candidate) => oldLeaves.has(candidate));

    expect(original.height).toBeGreaterThan(1);
    expect(shared.length).toBeGreaterThan(UTF16_ROPE_BRANCH_FACTOR - 2);
    expect(edited.toString()).toBe(`x!${text.slice(1)}`);
  });

  it("keeps the neighbours of deleted whole leaves by identity", () => {
    // Arrange
    const original = PersistentUtf16Rope.from(
      "x".repeat(UTF16_ROPE_TARGET_LEAF * 8),
    );
    const leaves = original.getLeafIdentities();

    // Act
    const edited = original.delete(
      UTF16_ROPE_TARGET_LEAF,
      UTF16_ROPE_TARGET_LEAF * 2,
    );

    // Assert
    expect(
      edited.getLeafIdentities().map((candidate) => leaves.indexOf(candidate)),
    ).toEqual([0, 3, 4, 5, 6, 7]);
  });

  it("assembles structural slices without flattening shared leaves", () => {
    const text = "x".repeat(UTF16_ROPE_TARGET_LEAF * 8);
    const original = PersistentUtf16Rope.from(text);
    const originalLeaves = new Set(original.getLeafIdentities());
    PersistentUtf16Rope.resetInstrumentation();

    const middle = original.sliceRope(100, original.length - 100);
    const assembled = PersistentUtf16Rope.fromSegments(["<", middle, ">"]);
    const stats = PersistentUtf16Rope.getInstrumentation();
    const sharedLeaves = assembled
      .getLeafIdentities()
      .filter((candidate) => originalLeaves.has(candidate));

    expect(assembled.toString()).toBe(`<${text.slice(100, -100)}>`);
    expect(sharedLeaves.length).toBeGreaterThanOrEqual(
      original.getLeafIdentities().length - 2,
    );
    expect(stats.flattenCount).toBe(0);
    expect(stats.flattenedCodeUnits).toBe(0);
  });

  it("assembles shared ranges without allocating discarded slice roots", () => {
    const text = "x".repeat(UTF16_ROPE_TARGET_LEAF * 8);
    const original = PersistentUtf16Rope.from(text);
    const originalLeaves = new Set(original.getLeafIdentities());
    PersistentUtf16Rope.resetInstrumentation();

    const assembled = PersistentUtf16Rope.assemble((assembler) => {
      assembler.appendText("<");
      assembler.appendSlice(original, 100, original.length - 100);
      assembler.appendText(">🙂");
    });
    const sharedLeaves = assembled
      .getLeafIdentities()
      .filter((candidate) => originalLeaves.has(candidate));
    const stats = PersistentUtf16Rope.getInstrumentation();

    expect(assembled.toString()).toBe(`<${text.slice(100, -100)}>🙂`);
    expect(sharedLeaves.length).toBeGreaterThanOrEqual(
      original.getLeafIdentities().length - 2,
    );
    // Every post-reset allocation belongs to the final rope. A temporary
    // sliceRope() hierarchy would increase this count without appearing in
    // assembled.nodeCount.
    expect(stats.nodeAllocations).toBe(
      assembled.nodeCount - sharedLeaves.length,
    );
    expect(stats.flattenCount).toBe(0);
    expect(stats.flattenedCodeUnits).toBe(0);
    expect(() =>
      PersistentUtf16Rope.assemble((assembler) => {
        assembler.appendSlice(original, 2, 1);
      }),
    ).toThrow(/Invalid rope slice/);
  });

  it("reuses one source traversal across whole-leaf assembly ranges", () => {
    const original = PersistentUtf16Rope.from(
      "x".repeat(UTF16_ROPE_TARGET_LEAF * 64),
    );
    const originalLeaves = original.getLeafIdentities();
    PersistentUtf16Rope.resetInstrumentation();

    const assembled = PersistentUtf16Rope.assemble((assembler) => {
      for (
        let startLeaf = 0;
        startLeaf < originalLeaves.length;
        startLeaf += 4
      ) {
        assembler.appendLeafRange(
          original,
          startLeaf,
          Math.min(startLeaf + 4, originalLeaves.length),
        );
      }
    });
    const stats = PersistentUtf16Rope.getInstrumentation();

    expect(assembled.toString()).toBe(original.toString());
    expect(assembled.getLeafIdentities()).toEqual(originalLeaves);
    expect(stats.nodeVisits).toBe(original.nodeCount);
    expect(() =>
      PersistentUtf16Rope.assemble((assembler) => {
        assembler.appendLeafRange(original, -1, 1);
      }),
    ).toThrow(/Invalid rope leaf range/);
  });

  it("touches only a root-to-leaf path for a point edit", () => {
    const rope = PersistentUtf16Rope.from("x".repeat(2_048 * 2_000));
    PersistentUtf16Rope.resetInstrumentation();

    const edited = rope.insert(123, "!");
    const stats = PersistentUtf16Rope.getInstrumentation();

    expect(edited.length).toBe(rope.length + 1);
    expect(stats.nodeVisits).toBeLessThanOrEqual(rope.height + 1);
    expect(stats.nodeAllocations).toBeLessThanOrEqual(rope.height * 2 + 3);
  });

  it("rebalances a deletion seam without scanning all leaves", () => {
    const rope = PersistentUtf16Rope.from("x".repeat(2_048 * 2_000));
    PersistentUtf16Rope.resetInstrumentation();

    const edited = rope.delete(100, 1_500);
    const stats = PersistentUtf16Rope.getInstrumentation();
    const leaves = edited.getLeafLengths();

    expect(edited.length).toBe(rope.length - 1_500);
    expect(stats.nodeVisits).toBeLessThan(rope.height * 12 + 20);
    expect(Math.min(...leaves)).toBeGreaterThanOrEqual(UTF16_ROPE_MIN_LEAF);
    expect(Math.max(...leaves)).toBeLessThanOrEqual(UTF16_ROPE_MAX_LEAF);
  });

  it("matches JavaScript strings under generated UTF-16 operations", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom("insert" as const, "delete" as const),
            seed: fc.nat(100),
            length: fc.nat(20),
            text: fc.string({ maxLength: 20 }),
          }),
          { maxLength: 80 },
        ),
        (operations) => {
          let expected = "";
          let rope = PersistentUtf16Rope.from("");
          for (const operation of operations) {
            const index = operation.seed % (expected.length + 1);
            if (operation.kind === "insert") {
              expected = `${expected.slice(0, index)}${operation.text}${expected.slice(index)}`;
              rope = rope.insert(index, operation.text);
            } else {
              const length = Math.min(
                operation.length,
                expected.length - index,
              );
              expected = `${expected.slice(0, index)}${expected.slice(index + length)}`;
              rope = rope.delete(index, length);
            }
            expect(rope.length).toBe(expected.length);
            expect(rope.toString()).toBe(expected);
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });

  // The property above stays within one or two leaves. These start from
  // documents with two branch levels and apply edits large enough to split,
  // merge and delete whole leaves and branches.
  it("matches JavaScript strings and UTF-16 metadata when edits span branches", () => {
    fc.assert(
      fc.property(multiLevelScriptArb, ({ initial, edits }) => {
        // Arrange
        let expected = initial;
        let rope = PersistentUtf16Rope.from(initial);

        for (const edit of edits) {
          // Act
          const resolved = resolveEdit(edit, expected.length);
          expected = editString(expected, resolved);
          rope = editRope(rope, resolved);

          // Assert
          expect(rope.toString()).toBe(expected);
          expect(rope.hasSurrogateCodeUnits).toBe(
            /[\ud800-\udfff]/.test(expected),
          );
          expect(rope.hasSurrogatePairs).toBe(
            /[\ud800-\udbff][\udc00-\udfff]/.test(expected),
          );
        }
      }),
      { numRuns: MULTI_LEVEL_RUNS },
    );
  });

  it("keeps fan-out and leaf sizes within bounds when edits span branches", () => {
    fc.assert(
      fc.property(multiLevelScriptArb, ({ initial, edits }) => {
        // Arrange
        let length = initial.length;
        let rope = PersistentUtf16Rope.from(initial);

        for (const edit of edits) {
          // Act
          const resolved = resolveEdit(edit, length);
          rope = editRope(rope, resolved);
          length = rope.length;

          // Assert
          const leaves = rope.getLeafLengths();
          expect(rope.getMaxBranchWidth()).toBeLessThanOrEqual(
            UTF16_ROPE_BRANCH_FACTOR,
          );
          expect(Math.max(0, ...leaves)).toBeLessThanOrEqual(
            UTF16_ROPE_MAX_LEAF,
          );
          if (leaves.length > 1) {
            expect(Math.min(...leaves)).toBeGreaterThanOrEqual(
              UTF16_ROPE_MIN_LEAF,
            );
          }
        }
      }),
      { numRuns: MULTI_LEVEL_RUNS },
    );
  });
});

// Helpers

/** Each case flattens ropes of up to a few hundred thousand code units. */
const MULTI_LEVEL_RUNS = 200;

type RopeEdit =
  | { readonly kind: "insert"; readonly seed: number; readonly text: string }
  | { readonly kind: "delete"; readonly seed: number; readonly length: number };

type ResolvedEdit =
  | { readonly kind: "insert"; readonly index: number; readonly text: string }
  | {
      readonly kind: "delete";
      readonly index: number;
      readonly length: number;
    };

// Leaves hold 1,024 to 2,048 code units and a branch up to 32 children, so a
// document past 65,536 code units starts with two branch levels. Text is one
// repeated unit; "a😀" puts surrogate pairs at both parities, so leaf seams
// and edit boundaries split pairs.
const textRunArb = (length: fc.Arbitrary<number>): fc.Arbitrary<string> =>
  fc
    .tuple(fc.constantFrom("x", "😀", "a😀"), length)
    .map(([unit, codeUnits]) =>
      unit.repeat(Math.ceil(codeUnits / unit.length)).slice(0, codeUnits),
    );

/** Keystroke-sized edits half the time, otherwise edits up to `large`. */
const editSizeArb = (large: number): fc.Arbitrary<number> =>
  fc.oneof(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: large }));

const ropeEditArb: fc.Arbitrary<RopeEdit> = fc.oneof(
  fc.record({
    kind: fc.constant("insert" as const),
    seed: fc.nat(),
    text: textRunArb(editSizeArb(40_000)),
  }),
  fc.record({
    kind: fc.constant("delete" as const),
    seed: fc.nat(),
    length: editSizeArb(80_000),
  }),
);

const multiLevelScriptArb = fc.record({
  initial: textRunArb(fc.nat({ max: 200_000 })),
  edits: fc.array(ropeEditArb, { minLength: 1 }),
});

function resolveEdit(edit: RopeEdit, textLength: number): ResolvedEdit {
  const index = edit.seed % (textLength + 1);
  return edit.kind === "insert"
    ? { kind: "insert", index, text: edit.text }
    : {
        kind: "delete",
        index,
        length: Math.min(edit.length, textLength - index),
      };
}

function editString(text: string, edit: ResolvedEdit): string {
  return edit.kind === "insert"
    ? `${text.slice(0, edit.index)}${edit.text}${text.slice(edit.index)}`
    : `${text.slice(0, edit.index)}${text.slice(edit.index + edit.length)}`;
}

function editRope(
  rope: PersistentUtf16Rope,
  edit: ResolvedEdit,
): PersistentUtf16Rope {
  return edit.kind === "insert"
    ? rope.insert(edit.index, edit.text)
    : rope.delete(edit.index, edit.length);
}
