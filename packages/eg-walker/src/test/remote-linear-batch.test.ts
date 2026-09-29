import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { readRemoteLinearBatch } from "../core/internals/remote-linear-batch";
import type { GraphEvent } from "../types";

const root: GraphEvent = {
  id: "a:0",
  parentVersion: new Set(["seed:0"]),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
  timestamp: 0,
};
const child: GraphEvent = {
  id: "a:1",
  parentVersion: new Set(["a:0"]),
  operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
  timestamp: 1,
};
const version = new Set(["seed:0"]);

const withChild = (overrides: Record<string, unknown>): GraphEvent[] => [
  root,
  { ...child, ...overrides } as GraphEvent,
];

describe("readRemoteLinearBatch", () => {
  it("reads a valid chain into columns", () => {
    const batch = readRemoteLinearBatch([root, child], version)!;

    expect(batch.count).toBe(2);
    expect(batch.firstParents).toEqual(version);
    expect(batch.firstParents).not.toBe(root.parentVersion);
    expect(batch.operationAt(1)).toEqual(child.operation);
  });

  it.each([
    { name: "a non-object event", events: [root, null] },
    { name: "an empty ID", events: withChild({ id: "" }) },
    { name: "a parent array", events: withChild({ parentVersion: ["a:0"] }) },
    {
      name: "a sibling",
      events: withChild({ parentVersion: new Set(["seed:0"]) }),
    },
    {
      name: "a second parent",
      events: withChild({ parentVersion: new Set(["a:0", "seed:0"]) }),
    },
    { name: "no parent", events: withChild({ parentVersion: new Set() }) },
    { name: "a NaN timestamp", events: withChild({ timestamp: Number.NaN }) },
    { name: "a missing operation", events: withChild({ operation: null }) },
    {
      name: "a negative index",
      events: withChild({
        operation: { type: "delete", index: -1, length: 1 },
      }),
    },
    {
      name: "a fractional length",
      events: withChild({
        operation: { type: "delete", index: 0, length: 0.5 },
      }),
    },
    {
      name: "a non-string insert",
      events: withChild({ operation: { type: "insert", index: 0, text: 1 } }),
    },
    {
      name: "a lone surrogate",
      events: withChild({
        operation: { type: "insert", index: 0, text: "\uDC00" },
      }),
    },
    {
      name: "an unknown operation type",
      events: withChild({ operation: { type: "move", index: 0 } }),
    },
    {
      name: "a root that is not the current version",
      events: [{ ...root, parentVersion: new Set(["other:0"]) }, child],
    },
    {
      name: "a root that omits part of the current version",
      events: [{ ...root, parentVersion: new Set() }, child],
    },
    {
      name: "a root that parents itself",
      events: [{ ...root, id: "seed:0" }],
    },
    {
      name: "a non-string root parent",
      events: [{ ...root, parentVersion: new Set([1]) }],
    },
  ])("returns null for $name", ({ events }) => {
    expect(
      readRemoteLinearBatch(events as unknown as GraphEvent[], version),
    ).toBeNull();
  });

  it("returns null for an empty batch", () => {
    expect(readRemoteLinearBatch([], new Set())).toBeNull();
  });
});
