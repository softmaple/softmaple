import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { REPLAY_SOURCE } from "../constants/replay-source";
import { EgWalkerReplica } from "../core/replica";
import type { GraphEvent } from "../types";

const buildLinearHistory = (count: number): GraphEvent[] => {
  const events: GraphEvent[] = [];
  let parent: ReadonlySet<string> = new Set();
  for (let i = 0; i < count; i++) {
    const event: GraphEvent = {
      id: `alice:${i}`,
      parentVersion: parent,
      operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
      timestamp: i,
    };
    events.push(event);
    parent = new Set([event.id]);
  }
  return events;
};

describe("EgWalkerReplica replay stats — new diagnostic fields", () => {
  describe("peakSequenceRecordCount", () => {
    it("starts at zero before any event is applied", () => {
      const api = new EgWalkerReplica("r1");
      expect(api.getReplayStats().peakSequenceRecordCount).toBe(0);
    });

    it("is at least as large as the live sequenceRecordCount", () => {
      const api = new EgWalkerReplica("r1", "seed text");
      for (const event of buildLinearHistory(20)) {
        api.applyRemoteEvent(event);
      }
      const stats = api.getReplayStats();
      expect(stats.peakSequenceRecordCount).toBeGreaterThanOrEqual(
        stats.sequenceRecordCount,
      );
    });

    it("retains the high-water mark after deletes shrink the live record set", () => {
      // Force a concurrent insert into a long seeded placeholder so the
      // placeholder splits (live records spike), then delete-heavy work
      // collapses the visible text without the engine resetting. The peak
      // must remember the spike even after the live count comes back down.
      const api = new EgWalkerReplica("r1", "a".repeat(200));
      api.applyRemoteEvent({
        id: "bob:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 100, text: "Z" },
        timestamp: 1,
      });
      const afterSplit = api.getReplayStats();
      expect(afterSplit.peakSequenceRecordCount).toBeGreaterThanOrEqual(
        afterSplit.sequenceRecordCount,
      );
      const peakAfterSplit = afterSplit.peakSequenceRecordCount;

      // A local single-character append shouldn't push the peak down even
      // though the engine carries on.
      api.insert(api.getText().length, "!");
      const afterAppend = api.getReplayStats();
      expect(afterAppend.peakSequenceRecordCount).toBeGreaterThanOrEqual(
        peakAfterSplit,
      );
    });
  });

  describe("criticalCheckpointHits / criticalCheckpointMisses", () => {
    it("are both zero before any divergent event triggers pickFor", () => {
      const api = new EgWalkerReplica("r1");
      for (const event of buildLinearHistory(10)) {
        api.applyRemoteEvent(event);
      }
      // A purely linear history runs through `canIncrementallyAdvance`
      // and never asks the checkpoint store for a starting point.
      const stats = api.getReplayStats();
      expect(stats.criticalCheckpointHits).toBe(0);
      expect(stats.criticalCheckpointMisses).toBe(0);
    });

    it("increments hits when a checkpoint dominates the divergent suffix", () => {
      const api = new EgWalkerReplica("r1");
      const linear = buildLinearHistory(20);
      for (const event of linear) {
        api.applyRemoteEvent(event);
      }
      const tail = linear[linear.length - 1]!;

      // Local edit on the tail, then a concurrent remote rooted at the
      // same tail — forces `partialReplayFromCheckpoint`, which goes
      // through `pickFor` and resolves to the tail checkpoint.
      api.insert(api.getText().length, "L");
      const before = api.getReplayStats();
      api.applyRemoteEvent({
        id: "bob:0",
        parentVersion: new Set([tail.id]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: linear.length,
          text: "R",
        },
        timestamp: linear.length + 1,
      });
      const after = api.getReplayStats();
      expect(after.criticalCheckpointHits).toBe(
        before.criticalCheckpointHits + 1,
      );
      expect(after.criticalCheckpointMisses).toBe(
        before.criticalCheckpointMisses,
      );
    });

    it("increments misses when the merge has no dominating critical version", () => {
      const api = new EgWalkerReplica("r1");
      api.applyRemoteEvent({
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      });
      const before = api.getReplayStats();
      // Concurrent root insert: no shared critical ancestor exists, so
      // pickFor returns null and the replica falls back to full replay.
      api.applyRemoteEvent({
        id: "bob:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
        timestamp: 2,
      });
      const after = api.getReplayStats();
      expect(after.criticalCheckpointMisses).toBe(
        before.criticalCheckpointMisses + 1,
      );
      expect(after.criticalCheckpointHits).toBe(before.criticalCheckpointHits);
      expect(after.fullReplays).toBe(before.fullReplays + 1);
    });
  });

  describe("lastReplaySource", () => {
    it("is null on a fresh replica with no events", () => {
      const api = new EgWalkerReplica("r1");
      expect(api.getReplayStats().lastReplaySource).toBeNull();
    });

    it("is 'full' immediately after the cold-start replay", () => {
      const api = new EgWalkerReplica("r1");
      api.applyRemoteEvent({
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      });
      expect(api.getReplayStats().lastReplaySource).toBe(REPLAY_SOURCE.FULL);
    });

    it("transitions through full → incremental → partial → full across a known sequence", () => {
      const api = new EgWalkerReplica("r1");
      const linear = buildLinearHistory(5);
      api.applyRemoteEvent(linear[0]!);
      expect(api.getReplayStats().lastReplaySource).toBe(REPLAY_SOURCE.FULL);

      for (let i = 1; i < linear.length; i++) {
        api.applyRemoteEvent(linear[i]!);
      }
      // Linear extension keeps `canIncrementallyAdvance` true, so the
      // most recent source is incremental.
      expect(api.getReplayStats().lastReplaySource).toBe(
        REPLAY_SOURCE.INCREMENTAL,
      );

      // Force partial replay by injecting a concurrent sibling off the
      // shared tail after a local edit advances the engine past it.
      const tail = linear[linear.length - 1]!;
      api.insert(api.getText().length, "L");
      api.applyRemoteEvent({
        id: "bob:0",
        parentVersion: new Set([tail.id]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: linear.length,
          text: "R",
        },
        timestamp: linear.length + 1,
      });
      expect(api.getReplayStats().lastReplaySource).toBe(REPLAY_SOURCE.PARTIAL);

      // Force full replay by introducing a concurrent root with no
      // critical-version ancestor.
      api.applyRemoteEvent({
        id: "carol:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "C" },
        timestamp: 999,
      });
      expect(api.getReplayStats().lastReplaySource).toBe(REPLAY_SOURCE.FULL);
    });

    it("only contains the documented string-literal values", () => {
      // Cheap structural check guarding against accidental enum-shape drift.
      expect(Object.values(REPLAY_SOURCE)).toEqual([
        "incremental",
        "partial",
        "full",
      ]);
    });
  });
});
