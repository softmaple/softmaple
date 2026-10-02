import { describe, expect, it } from "vitest";

import {
  IndexedSequence,
  type IndexedSequenceItem,
} from "../engine/indexed-sequence";
import { unindexed } from "./test-helpers";

interface WeightedItem extends IndexedSequenceItem<WeightedItem> {
  readonly id: string;
  readonly prepare: number;
  readonly effect: number;
}

const weightedItem = (
  id: string,
  prepare: number,
  effect: number,
): WeightedItem => unindexed({ id, prepare, effect });

const createItems = (count: number): WeightedItem[] =>
  Array.from({ length: count }, (_, index) =>
    weightedItem(`item-${index}`, index % 5 === 0 ? 0 : 1, index % 4),
  );

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
    const items = Array.from({ length: 2_200 }, (_, index) =>
      unindexed({
        id: `sparse-${index}`,
        prepare: index === 7 || index === 1_101 || index === 2_199 ? 1 : 0,
        effect: 1,
        anchor: index === 23 || index === 1_337 ? 1 : 0,
      }),
    );
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
    expect(sequence.effectIndexOf(weightedItem("missing", 1, 1))).toBe(-1);
  });

  it("inserts before and after an object without a second ranked lookup", () => {
    const anchoredItems = createItems(2_200);
    const rankedItems = createItems(2_200);
    const anchored = createSequence(anchoredItems);
    const ranked = createSequence(rankedItems);
    const targetIndex = 1_337;
    // An item belongs to one sequence, so each sequence inserts its own run.
    const run = (prefix: string): WeightedItem[] =>
      createItems(2).map((item, index) =>
        weightedItem(`${prefix}-${index}`, item.prepare, item.effect),
      );
    const before = run("before");
    const after = run("after");

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
    ranked.insertMany(ranked.positionOf(target), run("before"));
    ranked.insertMany(ranked.positionOf(target) + 1, run("after"));
    const rankedOperations = ranked.getStructuralOperationCount();

    expect(anchored.toArray().map(({ id }) => id)).toEqual(
      ranked.toArray().map(({ id }) => id),
    );
    expect(anchoredOperations).toBeLessThan(rankedOperations);
    expect(
      anchored.insertManyBefore(weightedItem("missing", 1, 1), run("unused")),
    ).toBe(false);
  });

  it("updates a split anchor and inserts its continuation with one aggregate walk", () => {
    const items = [
      unindexed({ id: "left", prepare: 1, effect: 2, anchor: 1 }),
      unindexed({ id: "split", prepare: 3, effect: 4, anchor: 1 }),
      unindexed({ id: "right", prepare: 2, effect: 1, anchor: 1 }),
    ];
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item) => item.effect,
      items,
      (item) => item.anchor,
      true,
    );
    const continuation = unindexed({
      id: "continuation",
      prepare: 4,
      effect: 5,
      anchor: 2,
    });

    // The old values remain in the leaf caches until the fused operation, so
    // the aggregate delta must account for both the mutation and insertion.
    items[1]!.prepare = 0;
    items[1]!.effect = 2;
    items[1]!.anchor = 0;

    sequence.restoreStructuralOperationCount(0);
    expect(sequence.updateAndInsertAfter(items[1]!, continuation)).toBe(true);
    expect(sequence.getStructuralOperationCount()).toBe(2);
    expect(sequence.toArray()).toEqual([
      items[0],
      items[1],
      continuation,
      items[2],
    ]);
    expect(sequence.prepareLength).toBe(7);
    expect(sequence.effectIndexBeforePosition(sequence.length)).toBe(10);
    expect(sequence.nextPrepareAnchorPosition(1)).toBe(2);
    expect(sequence.positionOf(continuation)).toBe(2);
    expect(sequence.areAdjacent(items[1]!, continuation)).toBe(true);

    const beforeRejectedInsert = sequence.toArray();
    expect(sequence.updateAndInsertAfter(items[0]!, continuation)).toBe(false);
    expect(
      sequence.updateAndInsertAfter(
        unindexed({ id: "missing", prepare: 1, effect: 1, anchor: 1 }),
        unindexed({ id: "unused", prepare: 1, effect: 1, anchor: 1 }),
      ),
    ).toBe(false);
    expect(sequence.toArray()).toEqual(beforeRejectedInsert);
  });

  it("inserts one item after an object anchor without a rank walk", () => {
    const items = createItems(64);
    const sequence = new IndexedSequence<WeightedItem>(
      (item) => item.prepare,
      (item) => item.effect,
      items,
      undefined,
      true,
    );
    const inserted = weightedItem("object-anchored", 2, 3);

    sequence.restoreStructuralOperationCount(0);
    expect(sequence.insertAfter(items[31]!, inserted)).toBe(true);
    expect(sequence.positionOf(inserted)).toBe(32);
    expect(sequence.areAdjacent(items[31]!, inserted)).toBe(true);
    expect(sequence.areAdjacent(inserted, items[32]!)).toBe(true);
    expect(sequence.isLast(inserted)).toBe(false);
    expect(sequence.isLast(items[63]!)).toBe(true);
    expect(sequence.insertAfter(items[31]!, inserted)).toBe(false);
    expect(
      sequence.insertAfter(
        weightedItem("missing", 1, 1),
        weightedItem("unused", 1, 1),
      ),
    ).toBe(false);
  });

  it("finds the final item across leaves without order tracking", () => {
    const items = createItems(64);
    const sequence = new IndexedSequence<WeightedItem>(
      (item) => item.prepare,
      (item) => item.effect,
      items,
    );

    expect(sequence.isLast(items[31]!)).toBe(false);
    expect(sequence.isLast(items[63]!)).toBe(true);
  });

  it("aggregates multi-item weight updates by touched tree nodes", () => {
    const batchedItems = createItems(96);
    const scalarItems = createItems(96);
    const createSequence = (items: WeightedItem[]) =>
      new IndexedSequence<WeightedItem>(
        (item) => item.prepare,
        (item) => item.effect,
        items,
        undefined,
        true,
      );
    const batched = createSequence(batchedItems);
    const scalar = createSequence(scalarItems);
    const indexes = [1, 2, 3, 31, 32, 33, 70, 71, 72];
    for (const index of indexes) {
      Object.assign(batchedItems[index]!, {
        prepare: index % 2,
        effect: (index + 1) % 2,
      });
      Object.assign(scalarItems[index]!, {
        prepare: index % 2,
        effect: (index + 1) % 2,
      });
    }

    batched.restoreStructuralOperationCount(0);
    scalar.restoreStructuralOperationCount(0);
    batched.updateItems(indexes.map((index) => batchedItems[index]!));
    for (const index of indexes) {
      scalar.updateItem(scalarItems[index]!);
    }

    expect(batched.prepareLength).toBe(scalar.prepareLength);
    expect(batched.effectIndexBeforePosition(batched.length)).toBe(
      scalar.effectIndexBeforePosition(scalar.length),
    );
    expect(batched.prepareIndexToPosition(20, false)).toBe(
      scalar.prepareIndexToPosition(20, false),
    );
    expect(batched.getStructuralOperationCount()).toBeLessThan(
      scalar.getStructuralOperationCount(),
    );
  });

  it("rejects reentrant mutations and releases reusable scratch state", () => {
    const items = createItems(96);
    const missing = weightedItem("missing", 7, 11);
    let sequence: IndexedSequence<WeightedItem> | undefined;
    let nestedAction: "update" | "clear" | null = null;
    sequence = new IndexedSequence<WeightedItem>(
      (item) => {
        if (nestedAction === "update" && item === items[0]) {
          nestedAction = null;
          sequence!.updateItems([items[1]!]);
        } else if (nestedAction === "clear" && item === items[0]) {
          nestedAction = null;
          sequence!.clear();
        }
        return item.prepare;
      },
      (item) => item.effect,
      items,
      undefined,
      true,
    );

    for (const index of [0, 40, 70]) {
      Object.assign(items[index]!, {
        prepare: (index % 3) + 2,
        effect: (index % 5) + 3,
      });
    }
    nestedAction = "update";

    expect(() => sequence!.updateItems([items[0]!])).toThrow(/reentrantly/);
    nestedAction = "clear";
    expect(() => sequence!.updateItems([items[0]!])).toThrow(
      /during a batch update/,
    );
    sequence.updateItems([
      items[0]!,
      items[40]!,
      items[70]!,
      missing,
      items[0]!,
    ]);

    expect(sequence.prepareLength).toBe(
      items.reduce((sum, item) => sum + item.prepare, 0),
    );
    expect(sequence.effectIndexBeforePosition(sequence.length)).toBe(
      items.reduce((sum, item) => sum + item.effect, 0),
    );
    expect(sequence.toArray()).toEqual(items);
  });

  it("keeps adjacency and ranks correct when a 32-item leaf splits", () => {
    const items = createItems(64);
    const sequence = new IndexedSequence<WeightedItem>(
      (item) => item.prepare,
      (item) => item.effect,
      items,
      undefined,
      true,
    );
    const continuation = weightedItem("boundary-continuation", 2, 3);
    const oldPrepareLength = sequence.prepareLength;
    const oldEffectLength = sequence.effectIndexBeforePosition(sequence.length);

    // Item 31 is the final record in the first full leaf. Inserting after it
    // grows that leaf from 32 to 33 records and creates a leaf boundary between
    // the continuation and the old item 32.
    expect(sequence.updateAndInsertAfter(items[31]!, continuation)).toBe(true);
    expect(sequence.length).toBe(65);
    expect(sequence.prepareLength).toBe(
      oldPrepareLength + continuation.prepare,
    );
    expect(sequence.effectIndexBeforePosition(sequence.length)).toBe(
      oldEffectLength + continuation.effect,
    );
    expect(sequence.positionOf(items[31]!)).toBe(31);
    expect(sequence.positionOf(continuation)).toBe(32);
    expect(sequence.positionOf(items[32]!)).toBe(33);

    const operationsBeforeAdjacencyChecks =
      sequence.getStructuralOperationCount();
    expect(sequence.areAdjacent(items[30]!, items[31]!)).toBe(true);
    expect(sequence.areAdjacent(items[31]!, continuation)).toBe(true);
    expect(sequence.areAdjacent(continuation, items[32]!)).toBe(true);
    expect(sequence.areAdjacent(items[32]!, continuation)).toBe(false);
    expect(sequence.areAdjacent(items[30]!, items[32]!)).toBe(false);
    expect(sequence.areAdjacent(items[31]!, items[31]!)).toBe(false);
    expect(
      sequence.areAdjacent(items[31]!, weightedItem("missing", 1, 1)),
    ).toBe(false);
    expect(sequence.getStructuralOperationCount()).toBe(
      operationsBeforeAdjacencyChecks,
    );
  });
});

describe("IndexedSequence.refreshInBatch", () => {
  it("should leave exact sums when a leaf and then its parent split inside the batch", () => {
    // Arrange
    // 1,100 records bulk-load into 34 full leaves and one partial leaf; the
    // first internal node holds 32 full leaves.
    const items = Array.from({ length: 1_100 }, (_, index) =>
      mutableItem(`record-${index}`, index % 3 === 0 ? 0 : 1, index % 2),
    );
    const sequence = new IndexedSequence<MutableWeightedItem>(
      (item) => item.prepare,
      (item) => item.effect,
      items,
      undefined,
      true,
    );
    const refresh = (index: number, prepare: number): void => {
      items[index]!.prepare = prepare;
      sequence.refreshInBatch(items[index]!);
    };

    // Act
    sequence.beginWeightBatch();
    refresh(3, 4);
    refresh(643, 2);
    refresh(1_090, 5);
    // Overfills the first leaf, whose new sibling overfills the first
    // internal node: record 30 moves to a new leaf and record 643's leaf to
    // a new internal node, both with deltas still pending.
    sequence.updateAndInsertAfter(items[31]!, mutableItem("inserted", 3, 1));
    refresh(30, 2);
    refresh(3, 0);
    sequence.endWeightBatch();

    // Assert
    expect(recountedSums(sequence)).toEqual(sumsOf(sequence.toArray()));
  });

  it("should keep the sums of the items refreshed before a weight callback throws", () => {
    // Arrange
    const items = Array.from({ length: 64 }, (_, index) =>
      mutableItem(`record-${index}`, 1, 1),
    );
    let unavailable: MutableWeightedItem | null = null;
    const sequence = new IndexedSequence<MutableWeightedItem>(
      (item) => {
        if (item === unavailable) {
          throw new Error("weight unavailable");
        }
        return item.prepare;
      },
      (item) => item.effect,
      items,
      undefined,
      true,
    );
    items[5]!.prepare = 3;
    items[40]!.prepare = 3;
    unavailable = items[40]!;

    // Act
    sequence.beginWeightBatch();
    let failure: unknown;
    try {
      sequence.refreshInBatch(items[5]!);
      sequence.refreshInBatch(items[40]!);
    } catch (error) {
      failure = error;
    } finally {
      sequence.endWeightBatch();
    }

    // Assert
    expect(failure).toEqual(new Error("weight unavailable"));
    expect(sequence.prepareLength).toBe(64 + 2);
    expect(sequence.prepareIndexToPosition(5 + 2, false)).toBe(5);
  });

  it("should reject a nested batch and a refresh or close outside one", () => {
    // Arrange
    const items = createItems(8);
    const sequence = createSequence(items);

    // Act
    sequence.beginWeightBatch();
    const nested = (): void => sequence.beginWeightBatch();
    const nestedUpdate = (): void => sequence.updateItems([items[0]!]);
    const nestedFailures = [nested, nestedUpdate].map(captureError);
    sequence.endWeightBatch();

    // Assert
    expect(nestedFailures.map((error) => error?.message)).toEqual([
      "Cannot update IndexedSequence reentrantly",
      "Cannot update IndexedSequence reentrantly",
    ]);
    expect(() => sequence.endWeightBatch()).toThrow(
      "IndexedSequence weight batch is not open",
    );
    expect(() => sequence.refreshInBatch(items[0]!)).toThrow(
      "IndexedSequence weight batch is not open",
    );
  });
});

describe("IndexedSequence.itemAfter", () => {
  it("should walk every item in order across leaf boundaries", () => {
    // Arrange
    const items = createItems(100);
    const sequence = createSequence(items);

    // Act
    const walked = [items[0]!];
    for (
      let next = sequence.itemAfter(items[0]!);
      next !== undefined;
      next = sequence.itemAfter(next)
    ) {
      walked.push(next);
    }

    // Assert
    expect(walked).toEqual(items);
  });

  it("should return undefined after the last item and for an item it does not hold", () => {
    // Arrange
    const items = createItems(40);
    const sequence = createSequence(items);

    // Act
    const afterLast = sequence.itemAfter(items[39]!);
    const afterMissing = sequence.itemAfter(weightedItem("missing", 1, 1));

    // Assert
    expect(afterLast).toBeUndefined();
    expect(afterMissing).toBeUndefined();
  });

  it("should find the next item after an insert shifts the item located last", () => {
    // Arrange
    const items = createItems(20);
    const sequence = createSequence(items);
    expect(sequence.itemAfter(items[10]!)).toBe(items[11]);
    const inserted = weightedItem("inserted", 1, 1);

    // Act
    sequence.insertAfter(items[5]!, inserted);

    // Assert
    expect(sequence.itemAfter(items[10]!)).toBe(items[11]);
    expect(sequence.itemAfter(items[5]!)).toBe(inserted);
    expect(sequence.itemAfter(inserted)).toBe(items[6]);
  });
});

// Helpers

interface MutableWeightedItem extends IndexedSequenceItem<MutableWeightedItem> {
  readonly id: string;
  prepare: number;
  effect: number;
}

const mutableItem = (
  id: string,
  prepare: number,
  effect: number,
): MutableWeightedItem => unindexed({ id, prepare, effect });

interface Sums {
  readonly prepareLength: number;
  /** Effect width before each position, and after the last. */
  readonly effectBefore: ReadonlyArray<number>;
  /** Position of the first prepare-visible unit of each visible item. */
  readonly firstVisiblePositions: ReadonlyArray<number>;
}

/** The sums an exact tree reports for `items`, from a plain recount. */
const sumsOf = (items: ReadonlyArray<MutableWeightedItem>): Sums => {
  const effectBefore = [0];
  const firstVisiblePositions: number[] = [];
  let prepareLength = 0;
  items.forEach((item, position) => {
    effectBefore.push(effectBefore[position]! + item.effect);
    if (item.prepare > 0) {
      firstVisiblePositions.push(position);
    }
    prepareLength += item.prepare;
  });
  return { prepareLength, effectBefore, firstVisiblePositions };
};

/** The same sums as the sequence's ranked queries report them. */
const recountedSums = (
  sequence: IndexedSequence<MutableWeightedItem>,
): Sums => {
  const items = sequence.toArray();
  const firstVisiblePositions: number[] = [];
  let prepareBefore = 0;
  for (const item of items) {
    if (item.prepare > 0) {
      firstVisiblePositions.push(
        sequence.prepareIndexToPosition(prepareBefore, false),
      );
    }
    prepareBefore += item.prepare;
  }
  return {
    prepareLength: sequence.prepareLength,
    effectBefore: Array.from({ length: items.length + 1 }, (_, position) =>
      sequence.effectIndexBeforePosition(position),
    ),
    firstVisiblePositions,
  };
};

const captureError = (action: () => void): Error | undefined => {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
};
