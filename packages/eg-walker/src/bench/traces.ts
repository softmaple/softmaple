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
 * Trace designed to exercise the checkpoint store: a long linear history
 * with `forkEveryN` periodic forks that each diverge by `forkDepth` events
 * then re-merge. This primarily exercises cold-start replay through
 * periodic fan-in structure and is paired with the incremental-per-event
 * benchmark path for comparison.
 */
export const buildCheckpointTrace = (params: {
  readonly mainEvents: number;
  readonly forkEveryN: number;
  readonly forkDepth: number;
}): GraphEvent[] => {
  const { mainEvents, forkEveryN, forkDepth } = params;
  const events: GraphEvent[] = [];
  let parent: EventId | null = null;
  let length = 0;
  for (let i = 0; i < mainEvents; i++) {
    const id: EventId = `main:${i}`;
    events.push({
      id,
      parentVersion: new Set<EventId>(parent ? [parent] : []),
      operation: { type: OPERATION_TYPE.INSERT, index: length, text: "m" },
      timestamp: BASE_TIMESTAMP + i,
    });
    parent = id;
    length += 1;

    if ((i + 1) % forkEveryN === 0) {
      // Fork off a short side branch that re-merges with the main chain.
      let forkTip: EventId = parent;
      for (let f = 0; f < forkDepth; f++) {
        const fid: EventId = `fork:${i}:${f}`;
        events.push({
          id: fid,
          parentVersion: new Set<EventId>([forkTip]),
          operation: { type: OPERATION_TYPE.INSERT, index: length, text: "f" },
          timestamp: BASE_TIMESTAMP + i + 1 + f,
        });
        forkTip = fid;
      }
      // Merge fork tip back into the main chain.
      const mergeId: EventId = `merge:${i}`;
      events.push({
        id: mergeId,
        parentVersion: new Set<EventId>([parent, forkTip]),
        operation: { type: OPERATION_TYPE.INSERT, index: length, text: "M" },
        timestamp: BASE_TIMESTAMP + i + 1 + forkDepth,
      });
      parent = mergeId;
      length += forkDepth + 1;
    }
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
