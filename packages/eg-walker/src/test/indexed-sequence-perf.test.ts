/**
 * Focused performance tests for the IndexedSequence ranked B-tree hot
 * paths.
 *
 * The ranked B-tree had three observable hot paths:
 *   - `refresh` recomputed an internal node's sums by mapping every
 *     child to its sum and reducing the result.
 *   - `updateItem` triggered `refreshUp`, which re-ran the above sum
 *     reduction on every ancestor.
 *   - `positionOf` scanned each leaf with `leaf.items.indexOf(item)`
 *     and walked up the tree via `parent.children.indexOf(current)`.
 *
 * The optimised implementation propagates `(size, prepareSum,
 * effectSum)` deltas to the root in O(log n) and caches the item's
 * offset inside its leaf plus each node's index inside its parent so
 * `positionOf`/`positionOfNode` avoid the inner `Array.indexOf`
 * scans. These tests sanity-check that the new paths run in a budget
 * compatible with that complexity on 10k-item trees, with generous
 * margins so the suite stays stable across CI machines.
 */

import { describe, expect, it } from "vitest";

import { IndexedSequence } from "../engine/indexed-sequence";
import { createPrng } from "./test-helpers";

interface PerfItem {
  id: number;
  prepare: number;
  effect: number;
}

const buildSequence = (
  size: number,
): { sequence: IndexedSequence<PerfItem>; items: PerfItem[] } => {
  const items: PerfItem[] = [];
  const sequence = new IndexedSequence<PerfItem>(
    (item) => item.prepare,
    (item) => item.effect,
  );
  for (let index = 0; index < size; index++) {
    const item: PerfItem = {
      id: index,
      prepare: index % 3 === 0 ? 0 : 1,
      effect: index % 5 === 0 ? 0 : 1,
    };
    items.push(item);
    sequence.push(item);
  }
  return { sequence, items };
};

describe("IndexedSequence focused performance", () => {
  it("repeated updateItem on a 10k-item tree finishes well under an O(n) budget", () => {
    const ITEM_COUNT = 10_000;
    const UPDATE_COUNT = 20_000;
    // A naive O(n) update implementation would take >= ITEM_COUNT *
    // UPDATE_COUNT / k weight visits (200M weight accesses); a
    // delta-propagating update only touches the leaf and its ancestors
    // (a few dozen accesses per call). We pick a wall-clock budget
    // that's loose enough to be stable in CI while still catching a
    // regression to per-update full subtree refreshes.
    const BUDGET_MS = 1_500;

    const { sequence, items } = buildSequence(ITEM_COUNT);
    const rand = createPrng(0xa11c_e123);

    const start = performance.now();
    for (let iteration = 0; iteration < UPDATE_COUNT; iteration++) {
      const target = items[Math.floor(rand() * items.length)];
      if (!target) {
        continue;
      }
      target.prepare = target.prepare === 1 ? 0 : 1;
      target.effect = target.effect === 1 ? 0 : 1;
      sequence.updateItem(target);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);

    // Final correctness check: the cached ranks must agree with a
    // fresh recompute. updateWeights walks every item and rebuilds
    // each node's sums, so if the delta path drifted from reality
    // these would diverge.
    const prepareBefore = sequence.prepareIndexToPosition(0, true);
    const effectBefore = sequence.effectIndexBeforePosition(sequence.length);
    sequence.updateWeights();
    expect(sequence.prepareIndexToPosition(0, true)).toBe(prepareBefore);
    expect(sequence.effectIndexBeforePosition(sequence.length)).toBe(
      effectBefore,
    );
  });

  it("repeated positionOf on a 10k-item tree finishes well under an O(n) budget", () => {
    const ITEM_COUNT = 10_000;
    const PROBE_COUNT = 20_000;
    // O(leaf capacity * depth) per call after the cache, so 20k probes
    // is well under a second even on slow CI runners.
    const BUDGET_MS = 1_500;

    const { sequence, items } = buildSequence(ITEM_COUNT);
    const rand = createPrng(0xb0b_42);

    const start = performance.now();
    for (let iteration = 0; iteration < PROBE_COUNT; iteration++) {
      const target = items[Math.floor(rand() * items.length)];
      if (!target) {
        continue;
      }
      const position = sequence.positionOf(target);
      // The id of every item equals its initial index, so positionOf
      // must always report that same index. This also keeps the JIT
      // from optimising the call away.
      if (position !== target.id) {
        throw new Error(
          `positionOf returned ${position} for item ${target.id}`,
        );
      }
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("positionOf stays correct after interleaved inserts that shift cached offsets", () => {
    // Regression guard for the cached leaf offset: inserting before
    // an existing item must update every later item's cached offset
    // so subsequent positionOf calls do not return stale indexes.
    const sequence = new IndexedSequence<PerfItem>(
      (item) => item.prepare,
      (item) => item.effect,
    );
    const items: PerfItem[] = [];
    for (let index = 0; index < 300; index++) {
      const item: PerfItem = { id: index, prepare: 1, effect: 1 };
      items.push(item);
      sequence.push(item);
    }

    const rand = createPrng(0xcafe);
    const model: PerfItem[] = [...items];
    for (let step = 0; step < 200; step++) {
      const insertAt = Math.floor(rand() * (model.length + 1));
      const inserted: PerfItem = {
        id: 1_000_000 + step,
        prepare: 1,
        effect: 1,
      };
      model.splice(insertAt, 0, inserted);
      sequence.insert(insertAt, inserted);
    }

    for (let trial = 0; trial < 200; trial++) {
      const target = model[Math.floor(rand() * model.length)];
      if (!target) {
        continue;
      }
      const expected = model.indexOf(target);
      expect(sequence.positionOf(target)).toBe(expected);
    }
  });

  it("delta propagation stays consistent under thousands of mixed updates and inserts", () => {
    // End-to-end consistency test: drive a fresh sequence and an
    // array-backed model with the same workload, then compare. If the
    // delta-propagation introduced any drift in cached sums, the
    // prepare/effect index round-trips would diverge from the model.
    const sequence = new IndexedSequence<PerfItem>(
      (item) => item.prepare,
      (item) => item.effect,
    );
    const model: PerfItem[] = [];
    const rand = createPrng(0x1234);

    for (let step = 0; step < 4_000; step++) {
      const decision = rand();
      if (decision < 0.55 || model.length === 0) {
        const item: PerfItem = {
          id: step,
          prepare: rand() < 0.7 ? 1 : 0,
          effect: rand() < 0.7 ? 1 : 0,
        };
        const at = Math.floor(rand() * (model.length + 1));
        model.splice(at, 0, item);
        sequence.insert(at, item);
      } else {
        const target = model[Math.floor(rand() * model.length)];
        if (!target) {
          continue;
        }
        target.prepare = target.prepare === 1 ? 0 : 1;
        target.effect = target.effect === 1 ? 0 : 1;
        sequence.updateItem(target);
      }
    }

    const expectedPrepareTotal = model.filter(
      (item) => item.prepare === 1,
    ).length;
    const expectedEffectTotal = model.filter(
      (item) => item.effect === 1,
    ).length;

    expect(sequence.length).toBe(model.length);
    expect(sequence.effectIndexBeforePosition(sequence.length)).toBe(
      expectedEffectTotal,
    );
    if (expectedPrepareTotal > 0) {
      // prepareIndexToPosition at expectedPrepareTotal with allowEnd=true
      // should land at the end of the sequence.
      expect(sequence.prepareIndexToPosition(expectedPrepareTotal, true)).toBe(
        sequence.length,
      );
    }

    // Spot-check positionOf agrees with the model on every item.
    for (let index = 0; index < model.length; index += 7) {
      const target = model[index];
      if (target) {
        expect(sequence.positionOf(target)).toBe(index);
      }
    }
  });
});
