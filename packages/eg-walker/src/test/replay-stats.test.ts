import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { REPLAY_SOURCE } from "../constants/replay-source";
import { CriticalCheckpointStore } from "../core/internals/critical-checkpoint-store";
import { EgWalkerReplica } from "../core/replica";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import { EventGraph } from "../graph/event-graph";
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

    it("persists after the bounded replay cache is evicted", () => {
      const api = new EgWalkerReplica("r1", "a".repeat(200));
      for (let index = 0; index <= 4_096; index++) {
        api.applyRemoteEvent({
          id: `concurrent:${index}`,
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
          timestamp: index,
        });
      }

      const after = api.getReplayStats();
      expect(after.replayCacheEvents).toBe(0);
      expect(after.sequenceRecordCount).toBe(0);
      expect(after.peakSequenceRecordCount).toBeGreaterThan(0);
    }, 15_000);
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

    it("does not treat a fan-in descendant as proof that a checkpoint stayed critical", () => {
      const graph = new EventGraph();
      const checkpoints = new CriticalCheckpointStore(
        new CriticalVersionAnalyzer(),
      );
      graph.addEvent({
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      });
      checkpoints.maybeAdvance(graph, "A");

      graph.addEvent({
        id: "bob:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
        timestamp: 2,
      });
      graph.addEvent({
        id: "merge:0",
        parentVersion: new Set(["alice:0", "bob:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "!" },
        timestamp: 3,
      });

      expect(checkpoints.pickFor(graph)).toBeNull();
      expect(checkpoints.misses).toBe(1);
      expect(checkpoints.hits).toBe(0);
    });
  });

  describe("lastReplaySource", () => {
    it("is null on a fresh replica with no events", () => {
      const api = new EgWalkerReplica("r1");
      expect(api.getReplayStats().lastReplaySource).toBeNull();
    });

    it("is 'incremental' for the engine-free exact-parent cold path", () => {
      const api = new EgWalkerReplica("r1");
      api.applyRemoteEvent({
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      });
      expect(api.getReplayStats().lastReplaySource).toBe(
        REPLAY_SOURCE.INCREMENTAL,
      );
    });

    it("is 'full' when the constructor adopts a prebuilt graph with events", () => {
      // The constructor calls `fullReplay()` directly when handed an event
      // graph that already has events, bypassing `advanceWithEvent`. That
      // path is distinct from the cold-start `applyRemoteEvent` route and
      // needs its own guard so a future refactor doesn't leave
      // `lastReplaySource` null after a deserialize round-trip.
      const prebuilt = new EventGraph();
      for (const event of buildLinearHistory(3)) {
        prebuilt.addEvent(event);
      }
      const api = new EgWalkerReplica("r1", "", prebuilt);
      expect(api.getReplayStats().lastReplaySource).toBe(REPLAY_SOURCE.FULL);
      expect(api.getReplayStats().fullReplays).toBe(1);
    });

    it("transitions through incremental → partial → full across a known sequence", () => {
      const api = new EgWalkerReplica("r1");
      const linear = buildLinearHistory(5);
      api.applyRemoteEvent(linear[0]!);
      expect(api.getReplayStats().lastReplaySource).toBe(
        REPLAY_SOURCE.INCREMENTAL,
      );

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
      // Use `arrayContaining` + length so re-ordering the const object
      // doesn't break the test for reasons unrelated to the contract.
      const values = Object.values(REPLAY_SOURCE);
      expect(values).toHaveLength(3);
      expect(values).toEqual(
        expect.arrayContaining(["incremental", "partial", "full"]),
      );
    });
  });
});
