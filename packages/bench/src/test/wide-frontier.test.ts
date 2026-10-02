import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "@softmaple/eg-walker";
import {
  measureWideFrontier,
  textDigest,
  WIDE_FRONTIER_APPLY,
  wideFrontierEvents,
} from "../bench/wide-frontier";

describe("wide-frontier receive", () => {
  it("builds parentless one-letter inserts from distinct replicas", () => {
    const events = wideFrontierEvents(30);
    expect(new Set(events.map(({ id }) => id)).size).toBe(30);
    expect(events[0]).toEqual({
      id: "peer-000000:0",
      parentVersion: new Set(),
      operation: { type: "insert", index: 0, text: "a" },
      timestamp: 0,
    });
    expect(events[27]!.operation).toEqual({
      type: "insert",
      index: 0,
      text: "b",
    });
  });

  it("converges to the same text through either API", () => {
    const single = measureWideFrontier(
      { EgWalkerReplica },
      { events: 300, apply: WIDE_FRONTIER_APPLY.Single, warmupEvents: 20 },
    );
    const batch = measureWideFrontier(
      { EgWalkerReplica },
      { events: 300, apply: WIDE_FRONTIER_APPLY.Batch, warmupEvents: 0 },
    );

    for (const result of [single, batch]) {
      expect(result).toMatchObject({
        events: 300,
        frontierSize: 300,
        textLength: 300,
      });
      expect(result.totalMs).toBeGreaterThanOrEqual(0);
      expect(result.perEventUs).toBeCloseTo((result.totalMs * 1_000) / 300);
    }
    expect(single.apply).toBe("single");
    expect(batch.apply).toBe("batch");
    expect(single.textDigest).toBe(batch.textDigest);
  });

  it("digests text with 32-bit FNV-1a", () => {
    expect(textDigest("")).toBe("811c9dc5");
    expect(textDigest("a")).toBe("e40c292c");
  });

  it("rejects invalid counts and APIs", () => {
    expect(() =>
      measureWideFrontier(
        { EgWalkerReplica },
        { events: 0, apply: WIDE_FRONTIER_APPLY.Single, warmupEvents: 0 },
      ),
    ).toThrow("event count must be an integer of at least 1");
    expect(() =>
      measureWideFrontier(
        { EgWalkerReplica },
        { events: 10, apply: WIDE_FRONTIER_APPLY.Batch, warmupEvents: -1 },
      ),
    ).toThrow("warm-up event count must be an integer of at least 0");
    expect(() =>
      measureWideFrontier(
        { EgWalkerReplica },
        // @ts-expect-error -- an API the harness does not know
        { events: 10, apply: "stream", warmupEvents: 0 },
      ),
    ).toThrow("unknown apply API stream");
  });
});
