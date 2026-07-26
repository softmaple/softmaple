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

  it("updates a split anchor and inserts its continuation with one aggregate walk", () => {
    const items = [
      { id: "left", prepare: 1, effect: 2, anchor: 1 },
      { id: "split", prepare: 3, effect: 4, anchor: 1 },
      { id: "right", prepare: 2, effect: 1, anchor: 1 },
    ];
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item) => item.effect,
      items,
      (item) => item.anchor,
      true,
    );
    const continuation = {
      id: "continuation",
      prepare: 4,
      effect: 5,
      anchor: 2,
    };

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
        { id: "missing", prepare: 1, effect: 1, anchor: 1 },
        { id: "unused", prepare: 1, effect: 1, anchor: 1 },
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
    const inserted: WeightedItem = {
      id: "object-anchored",
      prepare: 2,
      effect: 3,
    };

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
        { id: "missing", prepare: 1, effect: 1 },
        { id: "unused", prepare: 1, effect: 1 },
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
    const missing: WeightedItem = {
      id: "missing",
      prepare: 7,
      effect: 11,
    };
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
    const continuation: WeightedItem = {
      id: "boundary-continuation",
      prepare: 2,
      effect: 3,
    };
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
      sequence.areAdjacent(items[31]!, {
        id: "missing",
        prepare: 1,
        effect: 1,
      }),
    ).toBe(false);
    expect(sequence.getStructuralOperationCount()).toBe(
      operationsBeforeAdjacencyChecks,
    );
  });
});
