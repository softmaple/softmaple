import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "@softmaple/eg-walker";
import {
  ColumnarEventGraphCodec,
  encodeTopologicallyOrderedEventsBinary,
} from "@softmaple/eg-walker/internal";
import {
  measureSamePosition,
  SAME_POSITION_SHAPE,
  samePositionEvents,
  samePositionText,
  type SamePositionApi,
} from "../bench/same-position";
import { textDigest } from "../bench/wide-frontier";

const api: SamePositionApi = {
  EgWalkerReplica,
  ColumnarEventGraphCodec,
  encodeTopologicallyOrderedEventsBinary,
};

describe("same-position cold replay", () => {
  it("builds concurrent inserts at one position in each shape", () => {
    const root = samePositionEvents(30, SAME_POSITION_SHAPE.Root);
    expect(root).toHaveLength(30);
    expect(root[0]).toEqual({
      id: "peer-000000:0",
      parentVersion: new Set(),
      operation: { type: "insert", index: 0, text: "a" },
      timestamp: 1,
    });

    const after = samePositionEvents(30, SAME_POSITION_SHAPE.After);
    expect(after).toHaveLength(31);
    expect(after[0]).toMatchObject({
      id: "base:0",
      parentVersion: new Set(),
      operation: { type: "insert", index: 0, text: "|" },
    });
    expect(after[28]).toMatchObject({
      id: "peer-000027:0",
      parentVersion: new Set(["base:0"]),
      operation: { type: "insert", index: 1, text: "b" },
    });

    const before = samePositionEvents(30, SAME_POSITION_SHAPE.Before);
    expect(before[1]).toMatchObject({
      parentVersion: new Set(["base:0"]),
      operation: { type: "insert", index: 0, text: "a" },
    });

    expect(samePositionText(3, SAME_POSITION_SHAPE.Root)).toBe("abc");
    expect(samePositionText(3, SAME_POSITION_SHAPE.After)).toBe("|abc");
    expect(samePositionText(3, SAME_POSITION_SHAPE.Before)).toBe("abc|");
  });

  it("replays every shape to the text the insert order predicts", () => {
    for (const shape of Object.values(SAME_POSITION_SHAPE)) {
      const result = measureSamePosition(api, {
        events: 300,
        shape,
        warmupEvents: 20,
      });

      expect(result).toMatchObject({
        events: 300,
        shape,
        textLength: shape === SAME_POSITION_SHAPE.Root ? 300 : 301,
        textDigest: textDigest(samePositionText(300, shape)),
      });
      expect(result.totalMs).toBeGreaterThanOrEqual(0);
      expect(result.perEventUs).toBeCloseTo((result.totalMs * 1_000) / 300);
      for (const counter of [
        result.integrationProbes,
        result.fugueRebuilds,
        result.fugueComparisons,
        result.fugueMarkerOperations,
        result.sequenceTreeOperations,
      ]) {
        expect(Number.isSafeInteger(counter)).toBe(true);
      }
    }
  });

  it("rejects invalid counts and shapes", () => {
    expect(() =>
      measureSamePosition(api, {
        events: 0,
        shape: SAME_POSITION_SHAPE.Root,
        warmupEvents: 0,
      }),
    ).toThrow("event count must be an integer of at least 1");
    expect(() =>
      measureSamePosition(api, {
        events: 10,
        shape: SAME_POSITION_SHAPE.After,
        warmupEvents: -1,
      }),
    ).toThrow("warm-up event count must be an integer of at least 0");
    expect(() =>
      measureSamePosition(api, {
        events: 10,
        // @ts-expect-error -- a shape the harness does not know
        shape: "middle",
        warmupEvents: 0,
      }),
    ).toThrow("unknown shape middle");
  });
});
