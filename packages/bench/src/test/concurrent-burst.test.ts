import { describe, expect, it } from "vitest";

import {
  EgWalkerReplica,
  OPERATION_TYPE,
  PortableSnapshotCodec,
  type EventId,
  type GraphEvent,
} from "@softmaple/eg-walker";
import { ColumnarEventGraphCodec } from "@softmaple/eg-walker/internal";

import {
  assertBurstText,
  burstEvents,
  burstMarker,
  measureConcurrentBurst,
  parseConcurrentBurstOpen,
  warmUpConcurrentBurst,
} from "../bench/concurrent-burst";
import { buildSnapshotFirstEditFixture } from "../bench/snapshot-first-edit-fixture";

const api = { EgWalkerReplica, PortableSnapshotCodec, ColumnarEventGraphCodec };

/** Two authors typing concurrently after a shared root, then one merge. */
const history = (): GraphEvent[] => {
  const events: GraphEvent[] = [
    {
      id: "root:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "|" },
      timestamp: 0,
    },
  ];
  for (const [replicaId, index] of [
    ["alice", 0],
    ["bob", 1],
  ] as const) {
    let parent: EventId = "root:0";
    for (let sequence = 0; sequence < 20; sequence++) {
      const id = `${replicaId}:${sequence}`;
      events.push({
        id,
        parentVersion: new Set([parent]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: index + sequence,
          text: replicaId[0]!,
        },
        timestamp: events.length,
      });
      parent = id;
    }
  }
  events.push({
    id: "carol:0",
    parentVersion: new Set(["alice:19", "bob:19"]),
    operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
    timestamp: events.length,
  });
  return events;
};

const memorySamples = () => {
  let sample = 0;
  return () => {
    sample++;
    return {
      heapUsed: 1_000 * sample,
      arrayBuffers: 10 * sample,
      rss: 100_000 * sample,
    };
  };
};

describe("concurrent burst after opening a snapshot", () => {
  const fixture = buildSnapshotFirstEditFixture("small", history(), [1, 12]);

  it.each([
    ["native", 1],
    ["native", 12],
    ["portable", 1],
    ["portable", 12],
  ] as const)("times and validates a %s burst at depth %i", (open, depth) => {
    let collections = 0;
    const result = measureConcurrentBurst(
      api,
      fixture.bytes,
      fixture.manifest,
      {
        open,
        depth,
        edits: 6,
        collectGarbage: () => {
          collections++;
        },
        memoryUsage: memorySamples(),
      },
    );

    expect(collections).toBe(8);
    expect(result).toMatchObject({
      open,
      depth,
      finalTextLength: fixture.text.length + 6,
      finalTextValidated: true,
      heapAfterOpenBytes: 3_000,
      arrayBuffersAfterOpenBytes: 30,
      heapAfterEditsBytes: 4_000,
      arrayBuffersAfterEditsBytes: 40,
      rssAfterEditsBytes: 400_000,
    });
    expect(result.openMs).toBeGreaterThanOrEqual(0);
    expect(result.edits).toHaveLength(6);
    // The first edit merges the divergence; this small cache is kept, so the
    // rest of the burst extends it without replaying.
    const [first, ...rest] = result.edits;
    expect(first!.partialReplays + first!.fullReplays).toBe(1);
    for (const edit of rest) {
      expect(edit).toMatchObject({
        fullReplays: 0,
        partialReplays: 0,
        incrementalApplies: 1,
        lastReplaySource: "incremental",
        cacheReleased: false,
      });
    }
    for (const edit of result.edits) {
      expect(edit.ms).toBeGreaterThanOrEqual(0);
      expect(edit.replayCacheEvents).toBeGreaterThan(0);
      expect(edit.replayCacheBytes).toBeGreaterThan(0);
    }
  });

  it("warms up both open modes on a history built by the implementation", () => {
    expect(() => warmUpConcurrentBurst(api, 2, 1)).not.toThrow();
  });

  it("rejects a depth the fixture was not prepared for, and bad edit counts", () => {
    const measure = (depth: number, edits: number) => () =>
      measureConcurrentBurst(api, fixture.bytes, fixture.manifest, {
        open: "native",
        depth,
        edits,
      });
    expect(measure(5, 6)).toThrow(/no ancestor prepared for depth 5/);
    expect(measure(1, 0)).toThrow(/edits must be an integer from 1 to 64/);
    expect(() => parseConcurrentBurstOpen("lazy")).toThrow(/Unknown open mode/);
  });

  it("builds a chain of inserts, each in front of the last", () => {
    const events = burstEvents("base:7", 3);
    expect(events.map(({ id }) => id)).toEqual([
      "bench-burst-peer:0",
      "bench-burst-peer:1",
      "bench-burst-peer:2",
    ]);
    expect(events.map(({ parentVersion }) => [...parentVersion])).toEqual([
      ["base:7"],
      ["bench-burst-peer:0"],
      ["bench-burst-peer:1"],
    ]);
    expect(events.map(({ operation }) => operation)).toEqual(
      [0, 1, 2].map((edit) => ({
        type: "insert",
        index: 0,
        text: burstMarker(edit),
      })),
    );
  });

  it("checks the merged text marker by marker", () => {
    const [m0, m1, m2] = [0, 1, 2].map(burstMarker);
    expect(() => assertBurstText(`ab${m2}${m1}${m0}c`, "abc", 3)).not.toThrow();
    expect(() => assertBurstText(`${m2}a${m1}b${m0}c`, "abc", 3)).not.toThrow();
    expect(() => assertBurstText(`ab${m1}${m2}${m0}c`, "abc", 3)).toThrow(
      /marker 2 is behind an earlier marker/,
    );
    expect(() => assertBurstText(`ab${m2}${m0}c`, "abc", 3)).toThrow(
      /marker 1 is missing or duplicated/,
    );
    expect(() => assertBurstText(`ab${m1}${m0}${m0}c`, "abc", 2)).toThrow(
      /marker 0 is missing or duplicated/,
    );
    expect(() => assertBurstText(`a${m1}${m0}bc!`, "abc", 2)).toThrow(
      /differs from the snapshot/,
    );
  });
});
