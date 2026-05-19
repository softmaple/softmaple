import { describe, expect, it } from "vitest";
import { IndexedSequence } from "../engine/indexed-sequence";
import { createPrng } from "./test-helpers";

interface SequenceModelItem {
  readonly id: string;
  prepare: number;
  effect: number;
}

const visiblePositions = (
  items: ReadonlyArray<SequenceModelItem>,
  kind: "prepare" | "effect",
): number[] =>
  items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item[kind] === 1)
    .map(({ index }) => index);

describe("IndexedSequence", () => {
  it("maps prepare/effect indexes through the ranked B-tree sequence", () => {
    const items = [
      { id: "a", prepare: 1, effect: 1 },
      { id: "b", prepare: 0, effect: 1 },
      { id: "c", prepare: 1, effect: 0 },
      { id: "d", prepare: 1, effect: 1 },
    ];
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
      items,
    );

    expect(sequence.prepareIndexToPosition(0, false)).toBe(0);
    expect(sequence.prepareIndexToPosition(1, false)).toBe(2);
    expect(sequence.nextPrepareVisiblePosition(1)).toBe(2);
    expect(sequence.effectIndexBeforePosition(3)).toBe(2);

    items[1]!.prepare = 1;
    items[2]!.effect = 1;
    sequence.updateItem(items[1]!);
    sequence.updateItem(items[2]!);

    expect(sequence.prepareIndexToPosition(1, false)).toBe(1);
    expect(sequence.effectIndexBeforePosition(4)).toBe(4);
  });

  it("distinguishes out-of-range lookups from structural errors via tryPrepareIndexToPositionAndOffset", () => {
    const items = [
      { id: "a", prepare: 1, effect: 1 },
      { id: "b", prepare: 0, effect: 1 },
      { id: "c", prepare: 1, effect: 0 },
    ];
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
      items,
    );

    // Within range: prepare-index 1 lands at the second prepare-visible
    // record (position 2, which is item "c") with no record offset.
    expect(sequence.tryPrepareIndexToPositionAndOffset(1, false)).toEqual({
      position: 2,
      offsetInRecord: 0,
    });

    // Past the prepare-visible weight sum and negative indexes return
    // `undefined` instead of throwing, so callers can distinguish the
    // expected end-of-text condition from real bugs without a
    // catch-all try/catch.
    expect(
      sequence.tryPrepareIndexToPositionAndOffset(2, false),
    ).toBeUndefined();
    expect(
      sequence.tryPrepareIndexToPositionAndOffset(-1, false),
    ).toBeUndefined();

    // The throwing variant still raises on the same inputs so structural
    // bugs (aggregate corruption etc.) propagate as before.
    expect(() => sequence.prepareIndexToPositionAndOffset(2, false)).toThrow(
      /out of bounds/,
    );
  });

  it("keeps ranked B-tree indexes correct across leaf and internal splits", () => {
    const items = Array.from({ length: 2_200 }, (_, index) => ({
      id: `item-${index}`,
      prepare: index % 3 === 0 ? 0 : 1,
      effect: index % 5 === 0 ? 0 : 1,
    }));
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
    );

    for (const item of items) {
      sequence.push(item);
    }

    const expectedPreparePositions = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.prepare === 1)
      .map(({ index }) => index);
    const expectedEffectBefore1_700 = items
      .slice(0, 1_700)
      .filter((item) => item.effect === 1).length;

    expect(sequence.length).toBe(items.length);
    expect(sequence.at(1_799)).toBe(items[1_799]);
    expect(sequence.positionOf(items[1_799]!)).toBe(1_799);
    expect(sequence.prepareIndexToPosition(40, false)).toBe(
      expectedPreparePositions[40],
    );
    expect(sequence.effectIndexBeforePosition(1_700)).toBe(
      expectedEffectBefore1_700,
    );

    items[1_500]!.prepare = 1;
    items[1_500]!.effect = 1;
    sequence.updateItem(items[1_500]!);

    expect(sequence.nextPrepareVisiblePosition(1_499)).toBe(1_499);
    expect(sequence.positionOf(items[2_000]!)).toBe(2_000);
  });

  it("matches an array model across deterministic B-tree inserts and updates", () => {
    const random = createPrng(13_337);
    const model: SequenceModelItem[] = [];
    const sequence = new IndexedSequence<SequenceModelItem>(
      (item) => item.prepare,
      (item) => item.effect,
    );

    for (let step = 0; step < 1_000; step++) {
      const item: SequenceModelItem = {
        id: `item-${step}`,
        prepare: random() < 0.7 ? 1 : 0,
        effect: random() < 0.8 ? 1 : 0,
      };
      const index = Math.floor(random() * (model.length + 1));
      model.splice(index, 0, item);
      sequence.insert(index, item);

      if (step % 5 === 0 && model.length > 0) {
        const updateIndex = Math.floor(random() * model.length);
        const updated = model[updateIndex]!;
        updated.prepare = updated.prepare === 1 ? 0 : 1;
        updated.effect = updated.effect === 1 ? 0 : 1;
        sequence.updateItem(updated);
      }

      const probeIndex = Math.floor(random() * model.length);
      const probed = model[probeIndex]!;
      expect(sequence.at(probeIndex)).toBe(probed);
      expect(sequence.positionOf(probed)).toBe(probeIndex);

      const preparePositions = visiblePositions(model, "prepare");
      if (preparePositions.length > 0) {
        const prepareIndex = Math.floor(random() * preparePositions.length);
        expect(sequence.prepareIndexToPosition(prepareIndex, false)).toBe(
          preparePositions[prepareIndex],
        );
      }

      const effectProbe = Math.floor(random() * (model.length + 1));
      expect(sequence.effectIndexBeforePosition(effectProbe)).toBe(
        model.slice(0, effectProbe).filter((item) => item.effect === 1).length,
      );
    }

    expect(sequence.toArray()).toEqual(model);
  });

  it("covers ranked B-tree boundary behavior and bulk weight refresh", () => {
    const items = [
      { id: "a", prepare: 1, effect: 0 },
      { id: "b", prepare: 0, effect: 1 },
    ];
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
      items,
    );

    expect(sequence.at(-1)).toBeUndefined();
    expect(sequence.at(2)).toBeUndefined();
    expect(sequence.slice(1)).toEqual([items[1]]);
    expect(sequence.indexOf((item) => item.id === "b")).toBe(1);
    expect(sequence.indexOf((item) => item.id === "missing")).toBe(-1);
    expect(sequence.positionOf({ id: "external", prepare: 1, effect: 1 })).toBe(
      -1,
    );
    expect(sequence.nextPrepareVisiblePosition(-1)).toBeNull();
    expect(sequence.nextPrepareVisiblePosition(3)).toBeNull();
    expect(sequence.prepareIndexToPosition(1, true)).toBe(2);
    expect(() => sequence.prepareIndexToPosition(-1, false)).toThrow(
      "Index -1 out of bounds",
    );
    expect(() => sequence.prepareIndexToPosition(1, false)).toThrow(
      "Index 1 out of bounds",
    );
    expect(() => sequence.insert(-1, items[0]!)).toThrow(
      "Insert index -1 out of bounds",
    );

    items[0]!.prepare = 0;
    items[0]!.effect = 1;
    items[1]!.prepare = 1;
    items[1]!.effect = 0;
    sequence.updateWeights();

    expect(sequence.prepareIndexToPosition(0, false)).toBe(1);
    expect(sequence.effectIndexBeforePosition(2)).toBe(1);

    sequence.clear();
    expect(sequence.length).toBe(0);
    expect(sequence.toArray()).toEqual([]);
    expect(sequence.indexOf(() => true)).toBe(-1);
    expect(sequence.effectIndexBeforePosition(10)).toBe(0);
    expect(sequence.prepareIndexToPosition(0, true)).toBe(0);
    expect(() => sequence.prepareIndexToPosition(0, false)).toThrow(
      "Index 0 out of bounds",
    );
    expect(() => sequence.insert(1, items[0]!)).toThrow(
      "Insert index 1 out of bounds",
    );
    expect(() => sequence.updateItem(items[0]!)).not.toThrow();
  });

  it("refreshes ranked B-tree weights across internal nodes", () => {
    const items = Array.from({ length: 140 }, (_, index) => ({
      id: `bulk-${index}`,
      prepare: 1,
      effect: 1,
    }));
    const sequence = new IndexedSequence(
      (item: (typeof items)[number]) => item.prepare,
      (item: (typeof items)[number]) => item.effect,
      items,
    );

    items.forEach((item, index) => {
      item.prepare = index === 139 ? 1 : 0;
      item.effect = index === 0 ? 1 : 0;
    });
    sequence.updateWeights();

    expect(sequence.prepareIndexToPosition(0, false)).toBe(139);
    expect(sequence.effectIndexBeforePosition(140)).toBe(1);
  });
});
