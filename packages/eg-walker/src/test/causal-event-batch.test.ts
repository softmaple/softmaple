import { describe, expect, it } from "vitest";

import {
  consumeCausalEventBatch,
  createCausalEventBatchBuilder,
  inspectCausalEventBatch,
  isExactCausalChain,
  isOwnedCausalEventBatch,
  type CausalEventBatch,
} from "../core/causal-event-batch";

describe("CausalEventBatchBuilder", () => {
  it("builds insert and delete events without exposing their payload", () => {
    const builder = createCausalEventBatchBuilder(2);

    const returned = builder
      .appendInsert("alice:0", [], 0, "A", 10)
      .appendDelete("alice:1", ["alice:0"], 0, 1, 11);
    const batch = builder.finish();

    expect(returned).toBe(builder);
    expect(builder.eventCount).toBe(2);
    expect(batch).toEqual({ eventCount: 2 });
    expect(inspectCausalEventBatch(batch)).toEqual([
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: "insert", index: 0, text: "A" },
        timestamp: 10,
      },
      {
        id: "alice:1",
        parentVersion: new Set(["alice:0"]),
        operation: { type: "delete", index: 0, length: 1 },
        timestamp: 11,
      },
    ]);
  });

  it("copies parent iterables and retains the final event objects", () => {
    const parents = new Set(["alice:0"]);
    const builder = createCausalEventBatchBuilder(4);
    builder.appendInsert("alice:1", parents, 1, "B", 1);
    parents.clear();
    parents.add("unrelated:0");

    const batch = builder.finish();
    const firstInspection = inspectCausalEventBatch(batch);
    const secondInspection = inspectCausalEventBatch(batch);

    expect(firstInspection).toBe(secondInspection);
    expect(firstInspection[0]).toBe(secondInspection[0]);
    expect(firstInspection[0]?.operation).toBe(secondInspection[0]?.operation);
    expect(firstInspection[0]?.parentVersion).toEqual(new Set(["alice:0"]));
  });

  it.each([
    { name: "an empty batch", parents: [], exactChain: true },
    { name: "one root", parents: [[]], exactChain: true },
    {
      name: "one event on a merge",
      parents: [["x:0", "y:0"]],
      exactChain: true,
    },
    {
      name: "a chain from an existing frontier",
      parents: [["x:0"], ["a:0"], ["a:1"]],
      exactChain: true,
    },
    { name: "a second root", parents: [[], []], exactChain: false },
    {
      name: "a sibling of the previous event",
      parents: [["x:0"], ["a:0"], ["a:0"]],
      exactChain: false,
    },
    {
      name: "a merge of the previous event",
      parents: [[], ["a:0", "x:0"]],
      exactChain: false,
    },
    {
      name: "an event after a break",
      parents: [[], ["x:0"], ["a:1"]],
      exactChain: false,
    },
  ])("records whether $name is an exact chain", ({ parents, exactChain }) => {
    const builder = createCausalEventBatchBuilder();
    parents.forEach((eventParents, index) => {
      builder.appendInsert(`a:${index}`, eventParents, 0, "a", index);
    });

    expect(isExactCausalChain(builder.finish())).toBe(exactChain);
  });

  it("judges the chain by accepted events only", () => {
    const builder = createCausalEventBatchBuilder();
    builder.appendInsert("a:0", [], 0, "a", 0);
    expect(() =>
      builder.appendInsert("rejected:0", ["a:0"], -1, "b", 1),
    ).toThrow(/index/);
    builder.appendInsert("a:1", ["a:0"], 1, "b", 1);

    expect(isExactCausalChain(builder.finish())).toBe(true);
  });

  it("supports empty batches and capacity under- or over-estimates", () => {
    const empty = createCausalEventBatchBuilder(3).finish();
    const growing = createCausalEventBatchBuilder(1);
    growing
      .appendInsert("a:0", [], 0, "a", 0)
      .appendInsert("a:1", ["a:0"], 1, "b", 1);

    expect(empty.eventCount).toBe(0);
    expect(inspectCausalEventBatch(empty)).toEqual([]);
    expect(inspectCausalEventBatch(growing.finish())).toHaveLength(2);
  });

  it("closes permanently after finish", () => {
    const builder = createCausalEventBatchBuilder();
    builder.appendInsert("a:0", [], 0, "a", 0);

    builder.finish();

    expect(() => builder.finish()).toThrow(/already finished/);
    expect(() => builder.appendDelete("a:1", ["a:0"], 0, 1, 1)).toThrow(
      /already finished/,
    );
  });

  it("rejects finish reentrancy from a parent iterable", () => {
    const builder = createCausalEventBatchBuilder();
    const parents = {
      *[Symbol.iterator](): IterableIterator<string> {
        builder.finish();
        yield "unreachable:0";
      },
    };

    expect(() => builder.appendInsert("a:0", parents, 0, "a", 0)).toThrow(
      /reentrantly/,
    );
    expect(builder.eventCount).toBe(0);

    const batch = builder.appendInsert("a:0", [], 0, "a", 0).finish();
    expect(batch.eventCount).toBe(1);
  });

  it("rejects recursive append from a parent iterable", () => {
    const builder = createCausalEventBatchBuilder();
    const parents = {
      *[Symbol.iterator](): IterableIterator<string> {
        builder.appendDelete("nested:0", [], 0, 0, 0);
        yield "unreachable:0";
      },
    };

    expect(() => builder.appendInsert("a:0", parents, 0, "a", 0)).toThrow(
      /reentrantly/,
    );
    expect(builder.eventCount).toBe(0);
  });

  it("leaves the batch reusable until a committed caller consumes it", () => {
    const builder = createCausalEventBatchBuilder();
    const batch = builder.appendInsert("a:0", [], 0, "a", 0).finish();

    const failedApplyAttempt = (): void => {
      inspectCausalEventBatch(batch);
      throw new Error("simulated transaction failure");
    };
    expect(failedApplyAttempt).toThrow(/simulated transaction failure/);
    expect(inspectCausalEventBatch(batch)).toHaveLength(1);

    consumeCausalEventBatch(batch);

    expect(() => inspectCausalEventBatch(batch)).toThrow(/already consumed/);
    expect(() => consumeCausalEventBatch(batch)).toThrow(/already consumed/);
  });

  it("recognizes only batches owned by this module", () => {
    const batch = createCausalEventBatchBuilder().finish();
    const foreign = { eventCount: 0 } as CausalEventBatch;

    expect(isOwnedCausalEventBatch(batch)).toBe(true);
    expect(isOwnedCausalEventBatch(foreign)).toBe(false);
    expect(isOwnedCausalEventBatch(null)).toBe(false);
    expect(() => inspectCausalEventBatch(foreign)).toThrow(/not owned/);
    expect(() => consumeCausalEventBatch(foreign)).toThrow(/not owned/);
  });

  it.each([
    {
      name: "capacity",
      run: () => createCausalEventBatchBuilder(-1),
      error: /capacity/,
    },
    {
      name: "event id",
      run: () =>
        createCausalEventBatchBuilder().appendInsert("", [], 0, "a", 0),
      error: /event id/,
    },
    {
      name: "insert index",
      run: () =>
        createCausalEventBatchBuilder().appendInsert(
          "a:0",
          [],
          Number.NaN,
          "a",
          0,
        ),
      error: /index/,
    },
    {
      name: "insert text type",
      run: () =>
        createCausalEventBatchBuilder().appendInsert(
          "a:0",
          [],
          0,
          1 as unknown as string,
          0,
        ),
      error: /text must be a string/,
    },
    {
      name: "insert UTF-16",
      run: () =>
        createCausalEventBatchBuilder().appendInsert("a:0", [], 0, "\uD800", 0),
      error: /lone high surrogate/,
    },
    {
      name: "delete length",
      run: () =>
        createCausalEventBatchBuilder().appendDelete("a:0", [], 0, -1, 0),
      error: /delete length/,
    },
    {
      name: "timestamp",
      run: () =>
        createCausalEventBatchBuilder().appendInsert(
          "a:0",
          [],
          0,
          "a",
          Number.POSITIVE_INFINITY,
        ),
      error: /timestamp/,
    },
    {
      name: "parent iterable",
      run: () =>
        createCausalEventBatchBuilder().appendInsert(
          "a:0",
          null as unknown as Iterable<string>,
          0,
          "a",
          0,
        ),
      error: /parentVersion/,
    },
    {
      name: "parent id",
      run: () =>
        createCausalEventBatchBuilder().appendInsert(
          "a:0",
          [1 as unknown as string],
          0,
          "a",
          0,
        ),
      error: /parent event ID/,
    },
    {
      name: "self parent",
      run: () =>
        createCausalEventBatchBuilder().appendInsert("a:0", ["a:0"], 0, "a", 0),
      error: /parent itself/,
    },
  ])("rejects an invalid $name without appending", ({ run, error }) => {
    expect(run).toThrow(error);
  });
});
