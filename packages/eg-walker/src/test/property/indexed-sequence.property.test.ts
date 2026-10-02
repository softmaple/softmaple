/**
 * Property: an `IndexedSequence` agrees with an array of the same items
 * under any mix of ranked inserts, object-anchored inserts, record splits,
 * weight updates and weight batches. Every item resolves to its array
 * position, neighbours and order follow the array, and every prepare, effect
 * and anchor rank is a prefix sum of the array's weights.
 *
 * Items keep their leaf on themselves and leaves shift their slots in place,
 * so this pins down object-anchored lookups across inserts in front of an
 * item and across leaf splits, including splits inside an open weight batch,
 * whose ancestors catch up only when the batch closes.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  IndexedSequence,
  type IndexedSequenceItem,
} from "../../engine/indexed-sequence";
import { fcParams } from "./run-config";

describe("property: indexed sequence", () => {
  it("matches an array model under inserts, splits and weight updates", () => {
    fc.assert(
      fc.property(
        // Leaves split at 33 items, so runs need more than the default
        // handful of records and operations to cross leaf boundaries.
        fc.array(weightsArb, { size: "+1" }),
        fc.array(operationArb, { size: "+1" }),
        fc.boolean(),
        (initialWeights, operations, maintainOrder) => {
          // Arrange
          const items = createItemFactory();
          const model = initialWeights.map(items.create);
          const sequence = new IndexedSequence<ModelItem>(
            (item) => item.prepare,
            (item) => item.effect,
            model,
            (item) => item.anchor,
            maintainOrder,
          );

          // Act
          for (const operation of operations) {
            applyOperation(sequence, model, operation, items);
          }

          // Assert
          expectSequenceMatchesModel(sequence, model, maintainOrder);
        },
      ),
      fcParams(),
    );
  }, 60_000);
});

// Helpers

interface Weights {
  readonly prepare: number;
  readonly effect: number;
  readonly anchor: number;
}

interface ModelItem extends IndexedSequenceItem<ModelItem> {
  readonly id: number;
  prepare: number;
  effect: number;
  anchor: number;
}

/**
 * An operation names records by array position; positions are taken modulo
 * the current length, so every operation applies to every prefix of a run
 * and shrinking can drop any of them.
 */
type Operation =
  | { readonly kind: "insert"; readonly at: number; readonly weights: Weights }
  | {
      readonly kind: "insertMany";
      readonly at: number;
      readonly weights: ReadonlyArray<Weights>;
    }
  | {
      readonly kind: "insertAfter";
      readonly anchor: number;
      readonly weights: Weights;
    }
  | {
      readonly kind: "insertManyAround";
      readonly anchor: number;
      readonly after: boolean;
      readonly weights: ReadonlyArray<Weights>;
    }
  | {
      readonly kind: "split";
      readonly anchor: number;
      readonly anchorWeights: Weights;
      readonly weights: Weights;
    }
  | {
      readonly kind: "update";
      readonly target: number;
      readonly weights: Weights;
    }
  | {
      readonly kind: "updateMany";
      readonly updates: ReadonlyArray<{
        readonly target: number;
        readonly weights: Weights;
      }>;
    }
  | { readonly kind: "batch"; readonly steps: ReadonlyArray<BatchStep> };

/** A step inside one open weight batch. */
type BatchStep =
  | {
      readonly kind: "refresh";
      readonly target: number;
      readonly weights: Weights;
    }
  | {
      readonly kind: "split";
      readonly anchor: number;
      readonly anchorWeights: Weights;
      readonly weights: Weights;
    }
  | { readonly kind: "next"; readonly target: number };

const weightsArb: fc.Arbitrary<Weights> = fc.record({
  prepare: fc.nat(),
  effect: fc.nat(),
  anchor: fc.nat(),
});

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({
    kind: fc.constant("insert" as const),
    at: fc.nat(),
    weights: weightsArb,
  }),
  fc.record({
    kind: fc.constant("insertMany" as const),
    at: fc.nat(),
    weights: fc.array(weightsArb),
  }),
  fc.record({
    kind: fc.constant("insertAfter" as const),
    anchor: fc.nat(),
    weights: weightsArb,
  }),
  fc.record({
    kind: fc.constant("insertManyAround" as const),
    anchor: fc.nat(),
    after: fc.boolean(),
    weights: fc.array(weightsArb),
  }),
  fc.record({
    kind: fc.constant("split" as const),
    anchor: fc.nat(),
    anchorWeights: weightsArb,
    weights: weightsArb,
  }),
  fc.record({
    kind: fc.constant("update" as const),
    target: fc.nat(),
    weights: weightsArb,
  }),
  fc.record({
    kind: fc.constant("updateMany" as const),
    updates: fc.array(fc.record({ target: fc.nat(), weights: weightsArb })),
  }),
  fc.record({
    kind: fc.constant("batch" as const),
    steps: fc.array(
      fc.oneof(
        fc.record({
          kind: fc.constant("refresh" as const),
          target: fc.nat(),
          weights: weightsArb,
        }),
        fc.record({
          kind: fc.constant("split" as const),
          anchor: fc.nat(),
          anchorWeights: weightsArb,
          weights: weightsArb,
        }),
        fc.record({ kind: fc.constant("next" as const), target: fc.nat() }),
      ),
    ),
  }),
);

interface ItemFactory {
  readonly create: (weights: Weights) => ModelItem;
}

const createItemFactory = (): ItemFactory => {
  let nextId = 0;
  return {
    create: (weights) => ({
      id: nextId++,
      ...weights,
      sequenceLeaf: null,
    }),
  };
};

const setWeights = (item: ModelItem, weights: Weights): void => {
  item.prepare = weights.prepare;
  item.effect = weights.effect;
  item.anchor = weights.anchor;
};

/** Apply `operation` to the sequence and the same change to `model`. */
const applyOperation = (
  sequence: IndexedSequence<ModelItem>,
  model: ModelItem[],
  operation: Operation,
  items: ItemFactory,
): void => {
  switch (operation.kind) {
    case "insert": {
      const at = operation.at % (model.length + 1);
      const item = items.create(operation.weights);
      sequence.insert(at, item);
      model.splice(at, 0, item);
      return;
    }
    case "insertMany": {
      const at = operation.at % (model.length + 1);
      const inserted = operation.weights.map(items.create);
      sequence.insertMany(at, inserted);
      model.splice(at, 0, ...inserted);
      return;
    }
    default:
      break;
  }
  if (model.length === 0) {
    return;
  }

  switch (operation.kind) {
    case "insertAfter": {
      const at = operation.anchor % model.length;
      const item = items.create(operation.weights);
      expect(sequence.insertAfter(model[at]!, item)).toBe(true);
      model.splice(at + 1, 0, item);
      return;
    }
    case "insertManyAround": {
      const at = operation.anchor % model.length;
      const inserted = operation.weights.map(items.create);
      const anchor = model[at]!;
      expect(
        operation.after
          ? sequence.insertManyAfter(anchor, inserted)
          : sequence.insertManyBefore(anchor, inserted),
      ).toBe(true);
      model.splice(operation.after ? at + 1 : at, 0, ...inserted);
      return;
    }
    case "split": {
      const at = operation.anchor % model.length;
      const anchor = model[at]!;
      const item = items.create(operation.weights);
      setWeights(anchor, operation.anchorWeights);
      expect(sequence.updateAndInsertAfter(anchor, item)).toBe(true);
      model.splice(at + 1, 0, item);
      return;
    }
    case "update": {
      const target = model[operation.target % model.length]!;
      setWeights(target, operation.weights);
      sequence.updateItem(target);
      return;
    }
    case "updateMany": {
      const targets = operation.updates.map(({ target, weights }) => {
        const item = model[target % model.length]!;
        setWeights(item, weights);
        return item;
      });
      sequence.updateItems(targets);
      return;
    }
    case "batch": {
      sequence.beginWeightBatch();
      try {
        for (const step of operation.steps) {
          applyBatchStep(sequence, model, step, items);
        }
      } finally {
        sequence.endWeightBatch();
      }
      return;
    }
    default:
      return;
  }
};

/** Apply one step of an open weight batch to the sequence and `model`. */
const applyBatchStep = (
  sequence: IndexedSequence<ModelItem>,
  model: ModelItem[],
  step: BatchStep,
  items: ItemFactory,
): void => {
  const at = step.kind === "split" ? step.anchor : step.target;
  const target = model[at % model.length]!;
  switch (step.kind) {
    case "refresh":
      setWeights(target, step.weights);
      sequence.refreshInBatch(target);
      return;
    case "split": {
      const item = items.create(step.weights);
      setWeights(target, step.anchorWeights);
      expect(sequence.updateAndInsertAfter(target, item)).toBe(true);
      model.splice(model.indexOf(target) + 1, 0, item);
      return;
    }
    case "next":
      expect(sequence.itemAfter(target)).toBe(model[model.indexOf(target) + 1]);
      return;
  }
};

const expectSequenceMatchesModel = (
  sequence: IndexedSequence<ModelItem>,
  model: ReadonlyArray<ModelItem>,
  maintainOrder: boolean,
): void => {
  const positions = model.map((_, position) => position);
  const preparePrefix = prefixSums(model.map((item) => item.prepare));
  const effectPrefix = prefixSums(model.map((item) => item.effect));

  expect(sequence.toArray().map((item) => item.id)).toEqual(
    model.map((item) => item.id),
  );
  expect(sequence.length).toBe(model.length);
  expect(sequence.prepareLength).toBe(preparePrefix[model.length]);

  // Object-anchored lookups resolve every record to its array position.
  expect(model.map((item) => sequence.positionOf(item))).toEqual(positions);
  expect(model.map((item) => sequence.effectIndexOf(item))).toEqual(
    positions.map((position) => effectPrefix[position]),
  );
  expect(model.map((item) => sequence.prepareIndexAfter(item))).toEqual(
    positions.map((position) => preparePrefix[position + 1]),
  );
  expect(model.map((item) => sequence.isLast(item))).toEqual(
    positions.map((position) => position === model.length - 1),
  );
  expect(model.map((item) => sequence.itemAfter(item))).toEqual(
    positions.map((position) => model[position + 1]),
  );
  if (maintainOrder) {
    const pairs = positions.slice(1).map((position) => ({
      left: model[position - 1]!,
      right: model[position]!,
    }));
    expect(
      pairs.map(({ left, right }) => [
        sequence.areAdjacent(left, right),
        sequence.areAdjacent(right, left),
        sequence.compareOrder(left, right),
        sequence.compareOrder(right, left),
      ]),
    ).toEqual(pairs.map(() => [true, false, -1, 1]));
  }

  // Ranked lookups follow the same cached leaf weights.
  expect(
    [...positions, model.length].map((position) =>
      sequence.effectIndexBeforePosition(position),
    ),
  ).toEqual([...positions, model.length].map((p) => effectPrefix[p]));
  const visible = positions.filter((position) => model[position]!.prepare > 0);
  expect(
    visible.flatMap((position) => [
      sequence.prepareIndexToPositionAndOffset(preparePrefix[position]!, false),
      sequence.prepareIndexToPositionAndOffset(
        preparePrefix[position + 1]! - 1,
        false,
      ),
    ]),
  ).toEqual(
    visible.flatMap((position) => [
      { position, offsetInRecord: 0 },
      { position, offsetInRecord: model[position]!.prepare - 1 },
    ]),
  );
  expect(
    positions.map((position) => sequence.nextPrepareVisiblePosition(position)),
  ).toEqual(nextPositions(model, (item) => item.prepare > 0));
  expect(
    positions.map((position) => sequence.nextPrepareAnchorPosition(position)),
  ).toEqual(nextPositions(model, (item) => item.anchor > 0));
};

/** `sums[k]` is the sum of the first `k` values. */
const prefixSums = (values: ReadonlyArray<number>): number[] => {
  const sums = [0];
  for (const value of values) {
    sums.push(sums[sums.length - 1]! + value);
  }
  return sums;
};

/** For each position, the first position at or after it that matches. */
const nextPositions = (
  model: ReadonlyArray<ModelItem>,
  matches: (item: ModelItem) => boolean,
): Array<number | null> => {
  const next: Array<number | null> = model.map(() => null);
  let following: number | null = null;
  for (let position = model.length - 1; position >= 0; position--) {
    if (matches(model[position]!)) {
      following = position;
    }
    next[position] = following;
  }
  return next;
};
