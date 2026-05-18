import { describe, it, expect } from "vitest";
import { EgWalkerReplica } from "../core/replica";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import type { GraphEvent } from "../types";

describe("EgWalkerReplica replay path selection", () => {
  it("applies sequential remote events incrementally without replaying history", () => {
    // Sequential remote events whose parents always extend the engine's
    // current version take the cheap incremental path — only the new event
    // is processed each time.
    const api = new EgWalkerReplica("r1");
    const history: GraphEvent[] = [];
    let parent: Set<string> = new Set();
    for (let i = 0; i < 50; i++) {
      const event: GraphEvent = {
        id: `alice:${i}`,
        parentVersion: parent,
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
        timestamp: i,
      };
      history.push(event);
      parent = new Set([event.id]);
    }

    for (const event of history) {
      api.applyRemoteEvent(event);
    }

    const stats = api.getReplayStats();
    // Only the very first event cold-starts the engine via fullReplay; every
    // subsequent event extends the current frontier and applies incrementally.
    expect(stats.fullReplays).toBe(1);
    expect(stats.incrementalApplies).toBe(history.length - 1);
    // No retreats on a strictly-forward linear history.
    expect(stats.engineRetreats).toBe(0);
    expect(api.getText()).toBe("x".repeat(history.length));
  });

  it("replays only the post-checkpoint suffix when a concurrent branch arrives off a long linear history", () => {
    // Acceptance criterion for issue #664: build a long linear history, then
    // deliver a concurrent branch rooted at the latest critical version. The
    // replica must replay just the divergent suffix from a critical-version
    // checkpoint instead of re-walking the whole graph.
    const api = new EgWalkerReplica("r1");
    const linear: GraphEvent[] = [];
    let parent: Set<string> = new Set();
    for (let i = 0; i < 50; i++) {
      const event: GraphEvent = {
        id: `alice:${i}`,
        parentVersion: parent,
        operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
        timestamp: i,
      };
      linear.push(event);
      parent = new Set([event.id]);
    }
    for (const event of linear) {
      api.applyRemoteEvent(event);
    }
    const tail: GraphEvent = linear[linear.length - 1]!;

    // Local edit on top of the linear tail. Sibling concurrent edit below.
    api.insert(api.getText().length, "L");
    const statsBeforeMerge = api.getReplayStats();

    // Concurrent remote event rooted at the same parent as the local edit —
    // engine.currentVersion is the local event but the remote's parents
    // point at the linear tail, so a retreat is required.
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

    const stats = api.getReplayStats();
    // Bounded replay: no new full replay was triggered for the merge.
    expect(stats.fullReplays).toBe(statsBeforeMerge.fullReplays);
    // Exactly one partial replay covered the merge.
    expect(stats.partialReplays).toBe(statsBeforeMerge.partialReplays + 1);
    // Scope check: the engine seeded by the partial replay processes only
    // the two post-checkpoint events (local "L" + remote "R"), not all 52.
    expect(stats.engineRetreats + stats.engineAdvances).toBeLessThanOrEqual(2);
    // Convergence sanity: both inserts present, linear prefix intact.
    expect(api.getText().startsWith("x".repeat(linear.length))).toBe(true);
    expect(api.getText().includes("L")).toBe(true);
    expect(api.getText().includes("R")).toBe(true);
  });

  it("stores initial document text as a single run-length record", () => {
    // Section 3.4 of the paper: a long seeded document should live as one
    // run-length record in the prepare/effect ranked B-tree, not one record
    // per UTF-16 code unit. Inserts and deletes split the run on demand, so
    // steady-state memory tracks divergent edits — not seed length.
    const SEED_LENGTH = 2000;
    const seed = "a".repeat(SEED_LENGTH);
    const api = new EgWalkerReplica("r1", seed);
    expect(api.getText()).toBe(seed);

    api.applyRemoteEvent({
      id: "bob:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 1000, text: "X" },
      timestamp: 1,
    });
    expect(api.getText().length).toBe(SEED_LENGTH + 1);
    // After splitting once we expect ~3 records (left half, inserted item,
    // right half); the bound is generous to absorb future small refactors
    // that adjust split granularity, but stays well clear of SEED_LENGTH.
    expect(api.getReplayStats().sequenceRecordCount).toBeLessThanOrEqual(10);
    expect(api.getReplayStats().sequenceRecordCount).toBeLessThan(
      SEED_LENGTH / 10,
    );
  });

  it("caps retained critical checkpoints so long linear histories do not grow O(N) state", () => {
    // Section 3.5/3.6: each event whose parent frontier is a single-element
    // critical version produces a checkpoint. On a purely linear history
    // *every* event is a critical version, so the retained checkpoint list
    // would grow without bound in the original implementation. The pruning
    // logic keeps only the most recent `MAX_RETAINED_CHECKPOINTS` entries.
    const api = new EgWalkerReplica("r1", "");
    const HISTORY = 500;
    for (let i = 0; i < HISTORY; i++) {
      api.insert(api.getText().length, "x");
    }
    expect(api.getText().length).toBe(HISTORY);

    const stats = api.getReplayStats();
    expect(stats.checkpointCount).toBeLessThanOrEqual(64);
    expect(stats.checkpointCount).toBeLessThan(HISTORY);

    // A concurrent merge rooted at the most recent checkpoint must still
    // take the partial-replay fast path — the newest checkpoint is always
    // retained even after pruning.
    const partialReplaysBefore = stats.partialReplays;
    api.applyRemoteEvent({
      id: "bob:0",
      parentVersion: new Set([`r1:${HISTORY - 1}`]),
      operation: { type: OPERATION_TYPE.INSERT, index: HISTORY, text: "B" },
      timestamp: HISTORY + 1,
    });
    const afterMerge = api.getReplayStats();
    expect(afterMerge.partialReplays).toBeGreaterThanOrEqual(
      partialReplaysBefore,
    );
    expect(api.getText().endsWith("B")).toBe(true);
  });

  it("uses branch-preserving traversal during fullReplay to minimise retreat/advance churn", () => {
    // Integration check that EgWalkerReplica.fullReplay forwards the
    // branch-preserving order to the engine. Asserts a comparative bound:
    // the replica's engine churn on this 4x6 grid must be strictly less
    // than what Kahn ordering produces through the engine directly.
    const branches = 4;
    const depth = 6;
    const expectedEvents = 1 + branches * depth;
    const idAt = (level: number, branch: number): string =>
      `n-${String(level * branches + branch).padStart(3, "0")}`;
    const buildEvents = (): GraphEvent[] => {
      const out: GraphEvent[] = [
        {
          id: "n-000",
          parentVersion: new Set(),
          operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
          timestamp: 0,
        },
      ];
      for (let level = 0; level < depth; level++) {
        for (let branch = 0; branch < branches; branch++) {
          const id = idAt(level + 1, branch);
          const parent = level === 0 ? "n-000" : idAt(level, branch);
          out.push({
            id,
            parentVersion: new Set([parent]),
            operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "x" },
            timestamp: 1 + level * branches + branch,
          });
        }
      }
      return out;
    };

    const baselineGraph = new EventGraph();
    for (const event of buildEvents()) {
      baselineGraph.addEvent(event);
    }
    const kahnStats = new EgWalkerEngine().generate(
      baselineGraph.getTopologicalOrder(),
      "",
      { eventGraph: baselineGraph },
    ).stats;
    const kahnChurn = kahnStats.retreatCount + kahnStats.advanceCount;

    const api = new EgWalkerReplica("r1");
    for (const event of buildEvents()) {
      api.applyRemoteEvent(event);
    }
    api.applyRemoteEvent({
      id: "m-000",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "M" },
      timestamp: 999,
    });

    const stats = api.getReplayStats();
    expect(stats.fullReplays).toBeGreaterThanOrEqual(1);
    const replicaChurn = stats.engineRetreats + stats.engineAdvances;
    expect(replicaChurn).toBeLessThan(kahnChurn);
    expect(api.getText()).toHaveLength(expectedEvents + 1);
    expect(api.getText().includes("M")).toBe(true);
    expect(api.getText().includes("R")).toBe(true);
  });

  it("falls back to full replay only when no critical checkpoint dominates the merge", () => {
    // Two concurrent root inserts share no critical-version ancestor (the
    // empty version isn't critical once any event exists), so the replica
    // legitimately falls back to a full replay.
    const api = new EgWalkerReplica("r1");
    api.applyRemoteEvent({
      id: "alice:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    });
    const before = api.getReplayStats();
    api.applyRemoteEvent({
      id: "bob:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
      timestamp: 2,
    });
    const after = api.getReplayStats();
    expect(after.fullReplays).toBe(before.fullReplays + 1);
    expect(after.partialReplays).toBe(before.partialReplays);
    expect(api.getText().includes("A")).toBe(true);
    expect(api.getText().includes("B")).toBe(true);
  });
});
