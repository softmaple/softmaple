/**
 * Trace builders and stats helpers shared by `*.bench.ts` files.
 *
 * Each builder produces a causally-closed `GraphEvent[]` so the bench can
 * feed it into a single `EgWalkerReplica` via `applyRemoteEvent` and
 * measure end-to-end throughput. Traces are deterministic in their
 * parameters: PRNG seeds are fixed so a regression run is comparable to
 * the previous run.
 */

import { OPERATION_TYPE } from "../constants/operation-types";
import type { EgWalkerReplica } from "../core/replica";
import type { EventId, GraphEvent } from "../types";

const BASE_TIMESTAMP = 1_778_000_000_000;

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

/**
 * Single-author append-only chain of `count` inserts. Every event extends
 * the previous one in strict order, so the engine should take the
 * non-conflicting-run fast path on every event after the first.
 */
export const buildLongLinearHistory = (count: number): GraphEvent[] => {
  const events: GraphEvent[] = [];
  let parent: EventId | null = null;
  const pickChar = createPrng(0x9e3779b9 | 0);
  for (let i = 0; i < count; i++) {
    const id = `linear:${i}`;
    const ch = String.fromCharCode(0x61 + Math.floor(pickChar() * 26));
    events.push({
      id,
      parentVersion: new Set<EventId>(parent ? [parent] : []),
      operation: { type: OPERATION_TYPE.INSERT, index: i, text: ch },
      timestamp: BASE_TIMESTAMP + i,
    });
    parent = id;
  }
  return events;
};

/**
 * `count` independent inserts at index 0, each from a distinct replica
 * with no shared parent. Stresses YATA origin-left tie-breaking because
 * every event is concurrent with every other event.
 */
export const buildConcurrentSameIndexInserts = (
  count: number,
): GraphEvent[] => {
  const events: GraphEvent[] = [];
  for (let i = 0; i < count; i++) {
    events.push({
      id: `replica${i}:0`,
      parentVersion: new Set<EventId>(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: String.fromCharCode(0x61 + (i % 26)),
      },
      timestamp: BASE_TIMESTAMP + i,
    });
  }
  return events;
};

/**
 * Two replicas diverge from a root for `depth` events each, then a
 * merging event combines the tips. Exercises the partial-replay path
 * and checkpoint selection on the fan-in.
 */
export const buildLongOfflineBranchMerge = (depth: number): GraphEvent[] => {
  const events: GraphEvent[] = [];
  events.push({
    id: "root:0",
    parentVersion: new Set<EventId>(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "*" },
    timestamp: BASE_TIMESTAMP,
  });
  // Branch A: appends to the front of the document.
  let parentA: EventId = "root:0";
  for (let i = 0; i < depth; i++) {
    const id: EventId = `a:${i}`;
    events.push({
      id,
      parentVersion: new Set<EventId>([parentA]),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
      timestamp: BASE_TIMESTAMP + 1 + i,
    });
    parentA = id;
  }
  // Branch B: appends to the end of the document. Both branches grow
  // monotonically against their own view of the text, so each branch's
  // chain stays in the non-conflicting-run fast path until the merge.
  let parentB: EventId = "root:0";
  for (let i = 0; i < depth; i++) {
    const id: EventId = `b:${i}`;
    events.push({
      id,
      parentVersion: new Set<EventId>([parentB]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1 + i, text: "b" },
      timestamp: BASE_TIMESTAMP + 1 + depth + i,
    });
    parentB = id;
  }
  events.push({
    id: "merge:0",
    parentVersion: new Set<EventId>([parentA, parentB]),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "!" },
    timestamp: BASE_TIMESTAMP + 1 + depth * 2,
  });
  return events;
};

/**
 * Insert-then-delete heavy workload. ~70% of operations after the warm-up
 * are deletes that target previously-inserted characters. Stresses the
 * delete-target-index and prepare-visible filtering paths.
 */
export const buildDeleteHeavyWorkload = (count: number): GraphEvent[] => {
  const events: GraphEvent[] = [];
  const prng = createPrng(0xfeedface | 0);
  let parent: EventId | null = null;
  let length = 0;
  const minTextLength = 8;
  for (let i = 0; i < count; i++) {
    const id = `dh:${i}`;
    const wantDelete = length > minTextLength && prng() < 0.7;
    if (wantDelete) {
      const index = Math.floor(prng() * length);
      const deleteLen = Math.max(
        1,
        Math.min(length - index, 1 + Math.floor(prng() * 3)),
      );
      events.push({
        id,
        parentVersion: new Set<EventId>(parent ? [parent] : []),
        operation: {
          type: OPERATION_TYPE.DELETE,
          index,
          length: deleteLen,
        },
        timestamp: BASE_TIMESTAMP + i,
      });
      length -= deleteLen;
    } else {
      const text = String.fromCharCode(0x61 + Math.floor(prng() * 26));
      const index = Math.floor(prng() * (length + 1));
      events.push({
        id,
        parentVersion: new Set<EventId>(parent ? [parent] : []),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index,
          text,
        },
        timestamp: BASE_TIMESTAMP + i,
      });
      length += 1;
    }
    parent = id;
  }
  return events;
};

/**
 * Trace designed to force `CriticalCheckpointStore` reuse so the bench
 * actually exercises the partial-replay path rather than just the
 * incremental apply path.
 *
 * Recipe (mirrors `replica.test.ts` "replays only the post-checkpoint
 * suffix when a concurrent branch arrives off a long linear history"):
 *
 * - Phase 1: long linear single-author chain. Every event collapses the
 *   frontier to one tip and is recorded by the checkpoint store as a
 *   critical version (capped at `MAX_RETAINED_CHECKPOINTS = 32` via LRU).
 * - Phase 2: many concurrent siblings each parented at the linear tail.
 *   The first sibling applies incrementally (engine state `{tail}` is a
 *   causal ancestor of `tail`). Every subsequent sibling has engine
 *   state that includes prior siblings — concurrent with the new event —
 *   so `canIncrementallyAdvance` returns false (`core/replica.ts`) and
 *   the replica falls back to `partialReplayFromCheckpoint` using the
 *   tail checkpoint as the anchor.
 *
 * Result: `partialReplays ≈ siblingCount - 1`, with each partial replay
 * scoped to the divergent suffix (the post-tail siblings).
 */
export const buildCheckpointTrace = (params: {
  readonly linearHistory: number;
  readonly siblingCount: number;
}): GraphEvent[] => {
  const { linearHistory, siblingCount } = params;
  const events: GraphEvent[] = [];
  let timestamp = BASE_TIMESTAMP;

  let parent: EventId | null = null;
  for (let i = 0; i < linearHistory; i++) {
    const id: EventId = `linear:${i}`;
    events.push({
      id,
      parentVersion: new Set<EventId>(parent ? [parent] : []),
      operation: { type: OPERATION_TYPE.INSERT, index: i, text: "x" },
      timestamp: timestamp++,
    });
    parent = id;
  }
  if (parent === null) {
    return events;
  }
  const tail: EventId = parent;

  for (let i = 0; i < siblingCount; i++) {
    events.push({
      id: `sibling:${i}`,
      parentVersion: new Set<EventId>([tail]),
      // Every sibling inserts at the tail's end-of-doc position. They are
      // concurrent with each other, so YATA breaks ties on origin-left;
      // the exact merge order is not what the bench measures.
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: linearHistory,
        text: String.fromCharCode(0x41 + (i % 26)),
      },
      timestamp: timestamp++,
    });
  }

  return events;
};

export interface BenchStatsSummary {
  readonly scenario: string;
  readonly events: number;
  readonly textLength: number;
  readonly fullReplays: number;
  readonly partialReplays: number;
  readonly incrementalApplies: number;
  readonly engineRetreats: number;
  readonly engineAdvances: number;
  readonly checkpointCount: number;
  readonly sequenceRecordCount: number;
}

/**
 * Capture replay-stats from a fully-applied replica and format a
 * one-line summary suitable for bench output. Throws if the replica
 * still has buffered remote events, which would mean the trace was
 * not causally closed.
 */
export const summariseReplica = (
  scenario: string,
  events: number,
  replica: EgWalkerReplica,
): BenchStatsSummary => {
  if (replica.getPendingRemoteCount() !== 0) {
    throw new Error(
      `bench:${scenario} left ${replica.getPendingRemoteCount()} buffered events; trace is not causally closed`,
    );
  }
  const stats = replica.getReplayStats();
  return {
    scenario,
    events,
    textLength: replica.getText().length,
    fullReplays: stats.fullReplays,
    partialReplays: stats.partialReplays,
    incrementalApplies: stats.incrementalApplies,
    engineRetreats: stats.engineRetreats,
    engineAdvances: stats.engineAdvances,
    checkpointCount: stats.checkpointCount,
    sequenceRecordCount: stats.sequenceRecordCount,
  };
};

export const formatStatsLine = (summary: BenchStatsSummary): string =>
  `[bench:${summary.scenario}]` +
  ` events=${summary.events}` +
  ` text=${summary.textLength}` +
  ` fullReplays=${summary.fullReplays}` +
  ` partialReplays=${summary.partialReplays}` +
  ` incrementalApplies=${summary.incrementalApplies}` +
  ` retreats=${summary.engineRetreats}` +
  ` advances=${summary.engineAdvances}` +
  ` checkpoints=${summary.checkpointCount}` +
  ` sequenceRecords=${summary.sequenceRecordCount}`;
