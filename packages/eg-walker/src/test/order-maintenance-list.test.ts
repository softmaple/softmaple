import { describe, expect, it } from "vitest";
import {
  OrderMaintenanceList,
  type OrderMaintenanceItem,
} from "../engine/internals/order-maintenance-list";

interface Item extends OrderMaintenanceItem {
  readonly id: number;
}

const item = (id: number): Item => ({
  id,
  orderLabel: 0,
  orderPrevious: null,
  orderNext: null,
  orderGeneration: 0,
});

describe("OrderMaintenanceList", () => {
  it("preserves before/after batch order and constant-time comparisons", () => {
    const left = item(0);
    const right = item(1);
    const order = new OrderMaintenanceList([left, right]);
    const before = [item(2), item(3), item(4)];
    const after = [item(5), item(6)];

    expect(order.insertManyBefore(right, before)).toBe(true);
    expect(order.insertManyAfter(left, after)).toBe(true);
    expect(order.toArray()).toEqual([left, ...after, ...before, right]);

    const operationsBeforeQueries = order.getStructuralOperationCount();
    const values = order.toArray();
    for (let index = 1; index < values.length; index++) {
      expect(order.compare(values[index - 1]!, values[index]!)).toBe(-1);
      expect(order.compare(values[index]!, values[index - 1]!)).toBe(1);
      expect(order.compare(values[index]!, values[index]!)).toBe(0);
    }
    expect(order.getStructuralOperationCount()).toBe(operationsBeforeQueries);
  });

  it("inserts into an empty list and at both list boundaries", () => {
    const order = new OrderMaintenanceList<Item>();
    const middle = item(0);
    const start = item(1);
    const end = item(2);

    expect(order.insertAtStart(middle)).toBe(true);
    expect(order.insertBefore(middle, start)).toBe(true);
    expect(order.insertAtEnd(end)).toBe(true);
    expect(order.insertAfter(start, start)).toBe(false);
    const startBatch = [item(3), item(4)];
    const endBatch = [item(5), item(6)];
    expect(order.insertManyAtStart(startBatch)).toBe(true);
    expect(order.insertManyAtEnd(endBatch)).toBe(true);
    expect(order.toArray()).toEqual([
      ...startBatch,
      start,
      middle,
      end,
      ...endBatch,
    ]);
  });

  it("matches an array oracle under deterministic insertions", () => {
    let state = 0x5eed;
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };
    const first = item(0);
    const order = new OrderMaintenanceList([first]);
    const oracle = [first];

    for (let id = 1; id <= 5_000; id++) {
      const anchorIndex = next() % oracle.length;
      const anchor = oracle[anchorIndex]!;
      const value = item(id);
      if ((next() & 1) === 0) {
        expect(order.insertManyBefore(anchor, [value])).toBe(true);
        oracle.splice(anchorIndex, 0, value);
      } else {
        expect(order.insertManyAfter(anchor, [value])).toBe(true);
        oracle.splice(anchorIndex + 1, 0, value);
      }
    }

    expect(order.toArray()).toEqual(oracle);
    for (let index = 1; index < oracle.length; index++) {
      expect(order.compare(oracle[index - 1]!, oracle[index]!)).toBe(-1);
    }
  });

  it("bounds relabel work for adversarial repeated-gap insertion", () => {
    const first = item(0);
    const anchor = item(1);
    const order = new OrderMaintenanceList([first, anchor]);
    const count = 20_000;

    for (let id = 0; id < count; id++) {
      expect(order.insertManyBefore(anchor, [item(id + 2)])).toBe(true);
    }

    const stats = order.getStats();
    const logarithmicBudget =
      count * (8 * Math.ceil(Math.log2(count + 2)) + 16);
    expect(order.getStructuralOperationCount()).toBeLessThan(logarithmicBudget);
    expect(stats.relabels).toBeGreaterThan(0);
    expect(stats.insertions).toBe(count);
    expect(order.toArray()).toHaveLength(count + 2);
  });

  it("rejects unavailable anchors and duplicate objects without mutation", () => {
    const first = item(0);
    const order = new OrderMaintenanceList([first]);
    const unavailable = item(1);

    expect(order.insertManyBefore(unavailable, [item(2)])).toBe(false);
    expect(order.insertBefore(unavailable, item(3))).toBe(false);
    expect(order.insertAtStart(first)).toBe(false);
    expect(order.insertAtEnd(first)).toBe(false);
    expect(order.insertManyAtStart([first])).toBe(false);
    expect(order.insertManyAtEnd([first])).toBe(false);
    expect(order.insertManyAfter(first, [first])).toBe(false);
    expect(order.insertManyAfter(first, [unavailable, unavailable])).toBe(
      false,
    );
    expect(order.toArray()).toEqual([first]);
    expect(() => order.compare(first, unavailable)).toThrow(/unavailable/);
    expect(() => new OrderMaintenanceList([first, first])).toThrow(
      /duplicated/,
    );
  });

  it("resets labels, membership, and structural counters", () => {
    const first = item(0);
    const second = item(1);
    const replacement = item(2);
    const order = new OrderMaintenanceList([first, second]);
    expect(order.insertManyBefore(second, [item(3)])).toBe(true);
    expect(order.getStructuralOperationCount()).toBeGreaterThan(0);

    order.resetFromItems([replacement]);
    expect(order.toArray()).toEqual([replacement]);
    expect(order.getStructuralOperationCount()).toBe(0);
    expect(() => order.compare(first, replacement)).toThrow(/unavailable/);

    order.restoreStructuralOperationCount(42);
    expect(order.getStructuralOperationCount()).toBe(42);
  });
});
