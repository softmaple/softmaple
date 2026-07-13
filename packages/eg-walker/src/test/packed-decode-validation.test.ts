import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { buildPackedEventGraphBase } from "../graph/columnar-codec/packed-decode";

type PackedColumns = Parameters<typeof buildPackedEventGraphBase>[0];

const singleInsertColumns = (): PackedColumns => ({
  ids: ["a:0"],
  operationRuns: [
    { type: OPERATION_TYPE.INSERT, startEventOffset: 0, length: 1 },
  ],
  operationIndexes: new Float64Array([0]),
  operationLengths: new Float64Array([1]),
  insertedContent: "a",
  parentOverrides: [],
  timestamps: new Float64Array([0]),
});

const twoInsertColumns = (): PackedColumns => ({
  ids: ["a:0", "a:1"],
  operationRuns: [
    { type: OPERATION_TYPE.INSERT, startEventOffset: 0, length: 2 },
  ],
  operationIndexes: new Float64Array([0, 1]),
  operationLengths: new Float64Array([1, 1]),
  insertedContent: "ab",
  parentOverrides: [],
  timestamps: new Float64Array([0, 1]),
});

describe("packed EGW3 validation", () => {
  it("exposes safe out-of-range packed access", () => {
    const { base } = buildPackedEventGraphBase(singleInsertColumns());

    expect(base.eventAt(99)).toBeUndefined();
  });

  it.each([
    {
      name: "column length mismatch",
      columns: () => ({
        ...singleInsertColumns(),
        operationIndexes: new Float64Array(),
      }),
      error: /column length mismatch/,
    },
    {
      name: "empty event ID",
      columns: () => ({ ...singleInsertColumns(), ids: [""] }),
      error: /Invalid event ID/,
    },
    {
      name: "duplicate event ID",
      columns: () => ({ ...twoInsertColumns(), ids: ["a:0", "a:0"] }),
      error: /Duplicate event ID/,
    },
    {
      name: "zero operation-run length",
      columns: () => ({
        ...singleInsertColumns(),
        operationRuns: [
          { type: OPERATION_TYPE.INSERT, startEventOffset: 0, length: 0 },
        ],
      }),
      error: /positive safe length/,
    },
    {
      name: "operation-run coverage gap",
      columns: () => ({
        ...singleInsertColumns(),
        operationRuns: [
          { type: OPERATION_TYPE.INSERT, startEventOffset: 1, length: 1 },
        ],
      }),
      error: /does not exactly cover/,
    },
    {
      name: "operation index",
      columns: () => ({
        ...singleInsertColumns(),
        operationIndexes: new Float64Array([Number.NaN]),
      }),
      error: /Invalid operation index/,
    },
    {
      name: "operation length",
      columns: () => ({
        ...singleInsertColumns(),
        operationLengths: new Float64Array([-1]),
      }),
      error: /Invalid operation length/,
    },
    {
      name: "timestamp",
      columns: () => ({
        ...singleInsertColumns(),
        timestamps: new Float64Array([Number.NaN]),
      }),
      error: /Invalid timestamp/,
    },
    {
      name: "insert range",
      columns: () => ({
        ...singleInsertColumns(),
        operationLengths: new Float64Array([2]),
      }),
      error: /exceeds content column/,
    },
    {
      name: "missing operation runs",
      columns: () => ({ ...singleInsertColumns(), operationRuns: [] }),
      error: /Operation runs cover 0 events/,
    },
    {
      name: "extra inserted content",
      columns: () => ({ ...singleInsertColumns(), insertedContent: "ab" }),
      error: /Inserted-content size mismatch/,
    },
    {
      name: "parent override offset",
      columns: () => ({
        ...singleInsertColumns(),
        parentOverrides: [{ eventOffset: 1, parents: [] }],
      }),
      error: /Invalid parent override offset/,
    },
    {
      name: "parent type",
      columns: () => ({
        ...twoInsertColumns(),
        parentOverrides: [
          { eventOffset: 1, parents: [1 as unknown as string] },
        ],
      }),
      error: /non-string parent/,
    },
    {
      name: "duplicate parents",
      columns: () => ({
        ...twoInsertColumns(),
        parentOverrides: [{ eventOffset: 1, parents: ["a:0", "a:0"] }],
      }),
      error: /duplicate parent/,
    },
    {
      name: "missing parent",
      columns: () => ({
        ...twoInsertColumns(),
        parentOverrides: [{ eventOffset: 1, parents: ["missing:0"] }],
      }),
      error: /Missing parent event/,
    },
    {
      name: "forward parent",
      columns: () => ({
        ...twoInsertColumns(),
        parentOverrides: [{ eventOffset: 0, parents: ["a:1"] }],
      }),
      error: /is not before child/,
    },
    {
      name: "lone high surrogate",
      columns: () => ({
        ...singleInsertColumns(),
        insertedContent: "\uD800",
      }),
      error: /not well-formed UTF-16/,
    },
    {
      name: "lone low surrogate",
      columns: () => ({
        ...singleInsertColumns(),
        insertedContent: "\uDC00",
      }),
      error: /not well-formed UTF-16/,
    },
  ])("rejects invalid $name", ({ columns, error }) => {
    expect(() => buildPackedEventGraphBase(columns())).toThrow(error);
  });
});
