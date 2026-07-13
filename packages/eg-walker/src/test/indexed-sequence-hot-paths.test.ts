import { describe, expect, it } from "vitest";

import { IndexedSequence } from "../engine/indexed-sequence";

interface WeightedItem {
  readonly id: string;
  readonly prepare: number;
  readonly effect: number;
}

const createItems = (count: number): WeightedItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    prepare: index % 5 === 0 ? 0 : 1,
    effect: index % 4,
  }));

const createSequence = (
  items: ReadonlyArray<WeightedItem>,
): IndexedSequence<WeightedItem> =>
  IndexedSequence.fromRecords(
    items,
    (item) => item.prepare,
    (item) => item.effect,
  );

describe("IndexedSequence object-anchored hot paths", () => {
  it("finds weighted neighbours in one aggregate-guided traversal", () => {
    const items = Array.from({ length: 2_200 }, (_, index) => ({
      id: `sparse-${index}`,
      prepare: index === 7 || index === 1_101 || index === 2_199 ? 1 : 0,
      effect: 1,
      anchor: index === 23 || index === 1_337 ? 1 : 0,
    }));
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item) => item.effect,
      items,
      (item) => item.anchor,
    );

    sequence.restoreStructuralOperationCount(0);
    expect(sequence.nextPrepareVisiblePosition(8)).toBe(1_101);
    expect(sequence.nextPrepareVisiblePosition(1_102)).toBe(2_199);
    expect(sequence.nextPrepareAnchorPosition(24)).toBe(1_337);
    expect(sequence.previousPrepareVisiblePosition(2_199)).toBe(1_101);
    expect(sequence.previousPrepareVisiblePosition(1_101)).toBe(7);
    expect(sequence.nextPrepareVisiblePosition(items.length)).toBeNull();
    expect(sequence.nextPrepareAnchorPosition(-1)).toBeNull();

    // Sparse spans are skipped by subtree aggregates rather than by walking
    // every hidden record between the probes.
    expect(sequence.getStructuralOperationCount()).toBeLessThan(700);
  });

  it("fuses object location and effect-prefix lookup across tree levels", () => {
    const items = createItems(3_000);
    const sequence = createSequence(items);

    for (const index of [0, 63, 64, 1_337, 2_999]) {
      const item = items[index]!;
      const expected = items
        .slice(0, index)
        .reduce((sum, candidate) => sum + candidate.effect, 0);
      expect(sequence.effectIndexOf(item)).toBe(expected);
    }
    expect(
      sequence.effectIndexOf({ id: "missing", prepare: 1, effect: 1 }),
    ).toBe(-1);
  });

  it("inserts before and after an object without a second ranked lookup", () => {
    const anchoredItems = createItems(2_200);
    const rankedItems = createItems(2_200);
    const anchored = createSequence(anchoredItems);
    const ranked = createSequence(rankedItems);
    const targetIndex = 1_337;
    const before = createItems(2).map((item, index) => ({
      ...item,
      id: `before-${index}`,
    }));
    const after = createItems(2).map((item, index) => ({
      ...item,
      id: `after-${index}`,
    }));

    anchored.restoreStructuralOperationCount(0);
    expect(anchored.insertManyBefore(anchoredItems[targetIndex]!, before)).toBe(
      true,
    );
    expect(anchored.insertManyAfter(anchoredItems[targetIndex]!, after)).toBe(
      true,
    );
    const anchoredOperations = anchored.getStructuralOperationCount();

    ranked.restoreStructuralOperationCount(0);
    const target = rankedItems[targetIndex]!;
    ranked.insertMany(ranked.positionOf(target), before);
    ranked.insertMany(ranked.positionOf(target) + 1, after);
    const rankedOperations = ranked.getStructuralOperationCount();

    expect(anchored.toArray().map(({ id }) => id)).toEqual(
      ranked.toArray().map(({ id }) => id),
    );
    expect(anchoredOperations).toBeLessThan(rankedOperations);
    expect(
      anchored.insertManyBefore(
        { id: "missing", prepare: 1, effect: 1 },
        before,
      ),
    ).toBe(false);
  });
});
