import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  isClosedReadyBatch,
  isLinearBatchFromVersion,
  isOrderedLinearBatchFromVersion,
  isTopologicallyReadyBatch,
  type KnownEventSource,
} from "../core/internals/batch-replay-shape";
import type { GraphEvent } from "../types";

const insertEvent = (
  id: string,
  parents: ReadonlyArray<string>,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: id },
  timestamp: 0,
});

const graphWith = (...eventIds: ReadonlyArray<string>): KnownEventSource => {
  const known = new Set(eventIds);
  return { hasEvent: (eventId) => known.has(eventId) };
};

describe("batch replay shape", () => {
  it("recognizes an unordered closed batch as one linear extension", () => {
    const first = insertEvent("alice:1", ["base:0"]);
    const second = insertEvent("alice:2", [first.id]);
    const third = insertEvent("alice:3", [second.id]);
    const unordered = [third, first, second];

    expect(isClosedReadyBatch(unordered, graphWith("base:0"), 0)).toBe(true);
    expect(isLinearBatchFromVersion(unordered, new Set(["base:0"]))).toBe(true);
    expect(isTopologicallyReadyBatch(unordered, graphWith("base:0"), 0)).toBe(
      false,
    );
    expect(
      isTopologicallyReadyBatch([first, second, third], graphWith("base:0"), 0),
    ).toBe(true);
    expect(
      isOrderedLinearBatchFromVersion(
        [first, second, third],
        new Set(["base:0"]),
      ),
    ).toBe(true);
  });

  it("rejects a batch with a missing parent or existing pending events", () => {
    const missing = insertEvent("alice:2", ["alice:1"]);

    expect(isClosedReadyBatch([missing], graphWith("base:0"), 0)).toBe(false);
    expect(isClosedReadyBatch([missing], graphWith("alice:1"), 1)).toBe(false);
    expect(isTopologicallyReadyBatch([missing], graphWith("alice:1"), 1)).toBe(
      false,
    );
    expect(isLinearBatchFromVersion([missing], new Set(["base:0"]))).toBe(
      false,
    );
  });

  it("distinguishes a causally closed concurrent batch from a linear one", () => {
    const left = insertEvent("alice:1", ["base:0"]);
    const right = insertEvent("bob:1", ["base:0"]);

    expect(isClosedReadyBatch([right, left], graphWith("base:0"), 0)).toBe(
      true,
    );
    expect(isLinearBatchFromVersion([right, left], new Set(["base:0"]))).toBe(
      false,
    );
    expect(
      isOrderedLinearBatchFromVersion([right, left], new Set(["base:0"])),
    ).toBe(false);
  });

  it("rejects duplicates from the topological fast path", () => {
    const first = insertEvent("alice:1", ["base:0"]);

    expect(
      isTopologicallyReadyBatch([first, first], graphWith("base:0"), 0),
    ).toBe(false);
    expect(
      isTopologicallyReadyBatch([first], graphWith("base:0", first.id), 0),
    ).toBe(false);
  });

  it("allows a linear chain to start from a multi-event frontier", () => {
    const merge = insertEvent("alice:3", ["alice:1", "bob:1"]);
    const child = insertEvent("alice:4", [merge.id]);

    expect(
      isLinearBatchFromVersion([child, merge], new Set(["bob:1", "alice:1"])),
    ).toBe(true);
  });
});
