import { afterEach, describe, expect, it, vi } from "vitest";

import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import type { GraphEvent } from "../types";

const MiB = 1024 * 1024;
const BASE_BUDGET = 32 * MiB;
const CEILING = 8 * BASE_BUDGET;

// Two bytes per code unit put any cache over the base budget, while a replay
// over it stays cheap: the engine seeds the checkpoint text as a placeholder.
const LARGE_TEXT = "x".repeat(16 * MiB);

const insert = (
  id: string,
  parents: string[],
  index: number,
  text: string,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: "insert", index, text },
  timestamp: 0,
});

const replayCacheBudget = (replica: EgWalkerReplica): number =>
  (replica as unknown as { replayCacheBudgetBytes: number })
    .replayCacheBudgetBytes;

/**
 * A shared root, then the receiver's own event `a:0`. Every `b:*` event
 * branches off the root, so the root checkpoint dominates it and the
 * receiver replays partially from there.
 */
const divergedReceiver = (initialText: string): EgWalkerReplica => {
  const replica = new EgWalkerReplica("receiver", initialText);
  replica.applyRemoteEvent(insert("root:0", [], 0, "r"));
  replica.applyRemoteEvent(insert("a:0", ["root:0"], 1, "a"));
  return replica;
};

const branch = [
  insert("b:0", ["root:0"], 1, "b"),
  insert("b:1", ["b:0"], 2, "c"),
  insert("b:2", ["b:1"], 3, "d"),
];

/**
 * Every edit lands in front of the initial text, so the text must be the
 * edits a fresh receiver of the same events makes, followed by that text.
 */
const expectEditsBeforeInitialText = (
  replica: EgWalkerReplica,
  initialTextLength: number,
): void => {
  const reference = EgWalkerReplica.fromEventGraph(
    "reference",
    replica.exportEventGraph(),
    "x",
  );
  const edits = reference.getText().slice(0, -1);
  const text = replica.getText();
  expect(text.slice(0, edits.length)).toBe(edits);
  expect(text).toHaveLength(edits.length + initialTextLength);
};

/** Pretend every engine holds `extraRecords` more sequence records. */
const inflateSequenceRecords = (extraRecords: number): void => {
  const getStats = EgWalkerEngine.prototype.getStats;
  vi.spyOn(EgWalkerEngine.prototype, "getStats").mockImplementation(function (
    this: EgWalkerEngine,
  ) {
    const stats = getStats.call(this);
    return {
      ...stats,
      sequenceRecordCount: stats.sequenceRecordCount + extraRecords,
    };
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adaptive replay-cache budget", () => {
  it("keeps a cache that a partial replay rebuilds after a budget refusal", () => {
    const replica = divergedReceiver(LARGE_TEXT);

    // A two-event rebuild is cheap, so its first refusal releases it.
    replica.applyRemoteEvent(branch[0]!);
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      replayCacheBytes: 0,
    });
    expect(replayCacheBudget(replica)).toBe(BASE_BUDGET);

    // The next event on the branch rebuilds the refused cache: thrash.
    replica.applyRemoteEvent(branch[1]!);
    const rebuilt = replica.getReplayStats();
    expect(rebuilt.partialReplays).toBe(2);
    expect(rebuilt.replayCacheEvents).toBe(3);
    expect(rebuilt.replayCacheBytes).toBeGreaterThan(BASE_BUDGET);
    expect(replayCacheBudget(replica)).toBe(2 * BASE_BUDGET);

    replica.applyRemoteEvent(branch[2]!);
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 2,
      incrementalApplies: rebuilt.incrementalApplies + 1,
    });
    expectEditsBeforeInitialText(replica, LARGE_TEXT.length);
  });

  it.each([
    { localEvents: 4_095, firstEditKeepsCache: false },
    { localEvents: 4_096, firstEditKeepsCache: true },
  ])("keeps a rebuild of more than 4,096 events at its first refusal ($localEvents local events)", ({
    localEvents,
    firstEditKeepsCache,
  }) => {
    const replica = new EgWalkerReplica("receiver", LARGE_TEXT);
    replica.applyRemoteEvent(insert("root:0", [], 0, "r"));
    for (let index = 0; index < localEvents; index++) {
      replica.insert(1 + index, "a");
    }

    // The peer branches off the root, so the engine replays every local
    // event after it plus the peer's own.
    replica.applyRemoteEvent(insert("peer:0", ["root:0"], 1, "p"));
    const first = replica.getReplayStats();
    expect(first.partialReplays).toBe(1);
    expect(first.replayCacheEvents).toBe(
      firstEditKeepsCache ? localEvents + 1 : 0,
    );
    expect(replayCacheBudget(replica)).toBe(
      firstEditKeepsCache ? 2 * BASE_BUDGET : BASE_BUDGET,
    );

    replica.applyRemoteEvent(insert("peer:1", ["peer:0"], 2, "q"));
    const second = replica.getReplayStats();
    expect(second.partialReplays).toBe(firstEditKeepsCache ? 1 : 2);
    expect(second.replayCacheEvents).toBe(localEvents + 2);
    expect(replayCacheBudget(replica)).toBe(2 * BASE_BUDGET);

    // A local edit merges both heads: the large cache is released at that
    // critical cut, whatever the budget.
    replica.insert(0, "!");
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: second.partialReplays,
      replayCacheEvents: 0,
      replayCacheBytes: 0,
    });
    expectEditsBeforeInitialText(replica, LARGE_TEXT.length);
  }, 30_000);

  it("grows the budget in one step to fit the rebuilt cache", () => {
    // About 73 MiB of estimated records: one doubling would refuse it again.
    inflateSequenceRecords(300_000);
    const replica = divergedReceiver("");

    replica.applyRemoteEvent(branch[0]!);
    expect(replica.getReplayStats().replayCacheBytes).toBe(0);

    replica.applyRemoteEvent(branch[1]!);
    expect(replayCacheBudget(replica)).toBe(4 * BASE_BUDGET);
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 2,
      replayCacheEvents: 3,
    });

    replica.applyRemoteEvent(branch[2]!);
    expect(replica.getReplayStats().partialReplays).toBe(2);
    expectEditsBeforeInitialText(replica, 0);
  });

  it("still releases a cache above the budget ceiling", () => {
    // About 293 MiB of estimated records: more than the ceiling allows.
    inflateSequenceRecords(1_200_000);
    const replica = divergedReceiver("");

    for (const [index, event] of branch.entries()) {
      replica.applyRemoteEvent(event);
      expect(replica.getReplayStats()).toMatchObject({
        partialReplays: index + 1,
        replayCacheBytes: 0,
        sequenceRecordCount: 0,
      });
    }
    expect(replayCacheBudget(replica)).toBe(CEILING);
    expectEditsBeforeInitialText(replica, 0);
  });

  it("does not grow the budget for a rebuild that closes the divergence", () => {
    const replica = divergedReceiver(LARGE_TEXT);
    replica.applyRemoteEvent(branch[0]!);

    // The rebuild ends on a merge of both heads: no concurrent branch is
    // left to need the cache, so it is released and the budget stays.
    replica.applyRemoteEvents([
      branch[1]!,
      insert("merge:0", ["a:0", "b:1"], 0, "!"),
    ]);
    expect(replica.getFrontier()).toEqual(new Set(["merge:0"]));
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 2,
      replayCacheBytes: 0,
    });
    expect(replayCacheBudget(replica)).toBe(BASE_BUDGET);
    expectEditsBeforeInitialText(replica, LARGE_TEXT.length);
  });

  it("restores the budget and the pending refusal when a rebuild rolls back", () => {
    const replica = divergedReceiver(LARGE_TEXT);
    replica.applyRemoteEvent(branch[0]!);
    const stats = replica.getReplayStats();

    expect(() =>
      replica.applyRemoteEvents([
        branch[1]!,
        insert("invalid:0", ["b:1"], 64 * MiB, "!"),
      ]),
    ).toThrow();
    expect(replica.getReplayStats()).toEqual(stats);
    expect(replayCacheBudget(replica)).toBe(BASE_BUDGET);

    // The refusal is still pending, so the rebuild keeps the cache.
    replica.applyRemoteEvent(branch[1]!);
    expect(replayCacheBudget(replica)).toBe(2 * BASE_BUDGET);
    expect(replica.getReplayStats().replayCacheEvents).toBe(3);
  });
});
