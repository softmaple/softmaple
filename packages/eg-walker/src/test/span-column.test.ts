import { describe, expect, it } from "vitest";
import { SpanColumn } from "../graph/internals/span-column";

describe("SpanColumn", () => {
  const values = Array.from({ length: 5_123 }, (_, index) => {
    if (index < 1_024) return index;
    if (index < 2_048) return 1;
    if (index < 3_072) return 10_000 - index;
    if (index < 4_096) return (index * 104_729) % 65_521;
    return 1_800_000_000_000 + Math.floor(index / 7);
  });

  it.each([
    false,
    true,
  ])("preserves mixed spans and literals (sealed=%s)", (sealed) => {
    const column = sealed ? SpanColumn.from(values) : new SpanColumn();
    if (!sealed) for (const value of values) column.append(value);
    // A permutation exercises random access across all block boundaries.
    for (let i = 0; i < values.length; i++) {
      const index = (i * 17) % values.length;
      expect(column.at(index)).toBe(values[index]);
    }
    expect(Array.from(column.toArray())).toEqual(values);
  });

  it.each([
    0, 1, 1_023, 1_024, 1_025, 4_096, 5_000,
  ])("can truncate to %i and append over discarded spans", (count) => {
    for (const sealed of [false, true]) {
      const column = sealed ? SpanColumn.from(values) : new SpanColumn();
      if (!sealed) for (const value of values) column.append(value);
      column.truncate(count);
      const suffix = Array.from({ length: 2_049 }, (_, index) => -index * 3);
      for (const value of suffix) column.append(value);
      expect(Array.from(column.toArray())).toEqual([
        ...values.slice(0, count),
        ...suffix,
      ]);
    }
  });

  it("preserves exceptional numbers and safe-integer extremes exactly", () => {
    const special = [
      NaN,
      Infinity,
      -Infinity,
      -0,
      0.125,
      -0.25,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      2 ** 32,
    ];
    const input = Array.from(
      { length: 2_100 },
      (_, index) => special[index % special.length]!,
    );
    const column = SpanColumn.from(input);
    expect(Array.from(column.toArray())).toEqual(input);
  });

  it.each([
    [0, 256],
    [1_800_000_000_000, 65_536],
    [-5_000, -257],
    [Number.MAX_SAFE_INTEGER, -1],
    [Number.MIN_SAFE_INTEGER, 1],
  ])("preserves arithmetic spans from %i with step %i", (start, step) => {
    const input = Array.from(
      { length: 2_049 },
      (_, index) => start + index * step,
    );
    for (const sealed of [false, true]) {
      const column = sealed ? SpanColumn.from(input) : new SpanColumn();
      if (!sealed) for (const value of input) column.append(value);
      for (let index = input.length - 1; index >= 0; index--)
        expect(column.at(index)).toBe(input[index]);
    }
  });

  it("owns its source and validates truncation", () => {
    const source = new Float64Array(values);
    const column = SpanColumn.from(source);
    source.fill(99);
    expect(Array.from(column.toArray())).toEqual(values);
    for (const count of [-1, 1.5, NaN, values.length + 1])
      expect(() => column.truncate(count)).toThrow(RangeError);
  });
});
