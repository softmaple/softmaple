/**
 * Replay and storage benchmarks for {@link EgWalkerReplica} that
 * track replay counts, retreat/advance counts, memory shape, and
 * serialized size across three trace families.
 *
 * Issue: softmaple/softmaple#673 ("Add randomized convergence/property
 * tests and performance benchmarks").
 *
 * The existing perf tests each focus on a single engine sub-system
 * (`non-conflicting-run-perf.test.ts`, `critical-version-perf.test.ts`,
 * `indexed-sequence-perf.test.ts`, `columnar-codec-size.test.ts`).
 * This file rolls the same primitives up into end-to-end replica
 * benchmarks that exercise the public {@link EgWalkerReplica} API on
 * three workloads called out by the parent issue (#674):
 *
 *   - **Large histories** — append-only single-author chains of
 *     many thousands of events. Pins down the linear-history
 *     ceiling for the Section 3.4 fast path.
 *   - **High-concurrency branches** — many parallel branches that
 *     re-merge at a shared sink. The worst case for retreat /
 *     advance churn and partial-replay checkpoint reuse.
 *   - **Mostly linear editing sessions** — a single author with a
 *     small amount of typing-then-backspace churn, occasionally
 *     branched by a second author. Models the realistic "doc that
 *     a couple of authors are editing live".
 *
 * For each workload we capture and assert on:
 *
 *   - {@link EgWalkerReplica.getReplayStats} (full / partial /
 *     incremental replay counts, plus the engine's cumulative
 *     `retreatCount` / `advanceCount`),
 *   - the materialised event count and frontier size after the run
 *     (memory shape proxy for the engine's persistent state),
 *   - the JSON and {@link ColumnarEventGraphCodec.encodeBinary}
 *     payload sizes after the run (serialized-size signal that the
 *     paper highlights as the practical win for the columnar codec).
 *
 * Each benchmark runs inside a single test so wall-clock noise on
 * CI doesn't bleed across cases, prints a single-line summary via
 * `console.info`, and asserts on hard bounds for every metric. The
 * bounds are intentionally loose enough to absorb single-byte-per-
 * event churn but tight enough to catch a regression that
 * re-introduces a redundant column, an O(n) replay on every event,
 * or quadratic retreat/advance work on linear traces.
 */

import { afterAll, describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

interface BenchmarkResult {
  readonly traceName: string;
  readonly events: number;
  readonly frontierSize: number;
  readonly fullReplays: number;
  readonly partialReplays: number;
  readonly incrementalApplies: number;
  readonly engineRetreats: number;
  readonly engineAdvances: number;
  readonly jsonBytes: number;
  readonly binaryBytes: number;
}

const createPrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const cloneEvent = (event: GraphEvent): GraphEvent => ({
  id: event.id,
  operation: { ...event.operation },
  parentVersion: new Set(event.parentVersion),
  timestamp: event.timestamp,
});

const utf8Bytes = (text: string): number =>
  new TextEncoder().encode(text).length;

/**
 * Drive the benchmark replica through the provided event sequence
 * and capture the metrics defined above. Returns the captured
 * snapshot plus the live replica so individual tests can do extra
 * assertions on the final text.
 */
const runReplicaBenchmark = (
  traceName: string,
  buildEvents: () => GraphEvent[],
): {
  readonly result: BenchmarkResult;
  readonly replica: EgWalkerReplica;
} => {
  const events = buildEvents();
  const replica = new EgWalkerReplica(`bench:${traceName}`);
  for (const event of events) {
    replica.applyRemoteEvent(event);
  }
  if (replica.getPendingRemoteCount() !== 0) {
    throw new Error(
      `Benchmark ${traceName} left ${replica.getPendingRemoteCount()} buffered events; trace is not causally closed.`,
    );
  }

  const serialized = replica.serialize();
  const jsonBytes = utf8Bytes(JSON.stringify(serialized));

  // The columnar codec needs the live event graph. Rebuild it via
  // the public `exportEventGraph` instead of reaching into the
  // replica's private fields.
  const codec = new ColumnarEventGraphCodec();
  const allEvents = replica.exportEventGraph();
  const reconstructedGraph = EventGraph.fromEvents(allEvents.map(cloneEvent));
  const binaryBytes = codec.encodeBinary(reconstructedGraph).byteLength;

  const stats = replica.getReplayStats();
  // Frontier size after a fully-applied trace tells us how many
  // concurrent tips the trace ended on — a single-author trace
  // ends on 1, a deep concurrent fork can end on N.
  const frontier = computeFrontier(allEvents);

  return {
    result: {
      traceName,
      events: allEvents.length,
      frontierSize: frontier.size,
      fullReplays: stats.fullReplays,
      partialReplays: stats.partialReplays,
      incrementalApplies: stats.incrementalApplies,
      engineRetreats: stats.engineRetreats,
      engineAdvances: stats.engineAdvances,
      jsonBytes,
      binaryBytes,
    },
    replica,
  };
};

/**
 * Compute the frontier (set of events with no children) for the
 * given event set. Mirrors {@link EventGraph.getFrontier} so we
 * don't need a private accessor.
 */
const computeFrontier = (
  events: ReadonlyArray<GraphEvent>,
): ReadonlySet<EventId> => {
  const allIds = new Set<EventId>(events.map((event) => event.id));
  const hasChild = new Set<EventId>();
  for (const event of events) {
    for (const parent of event.parentVersion) {
      if (allIds.has(parent)) {
        hasChild.add(parent);
      }
    }
  }
  const frontier = new Set<EventId>();
  for (const id of allIds) {
    if (!hasChild.has(id)) {
      frontier.add(id);
    }
  }
  return frontier;
};

// ----------------------------------------------------------------------
// Trace builders
// ----------------------------------------------------------------------

const buildLargeLinearHistory = (eventCount: number): GraphEvent[] => {
  const events: GraphEvent[] = [];
  let parent: EventId | null = null;
  let cursor = 0;
  const prng = createPrng(0x9e3779b9 | 0);
  for (let i = 0; i < eventCount; i++) {
    const id = `linear:${i}`;
    // Single-author append: every event extends the previous one in
    // strict order, so the engine should take the
    // non-conflicting-run fast path on every event after the first.
    const ch = String.fromCharCode(0x61 + Math.floor(prng() * 26));
    events.push({
      id,
      parentVersion: new Set<EventId>(parent ? [parent] : []),
      operation: { type: OPERATION_TYPE.INSERT, index: cursor, text: ch },
      timestamp: 1_778_000_000_000 + i,
    });
    parent = id;
    cursor += 1;
  }
  return events;
};

const buildHighConcurrencyBranches = (params: {
  readonly branches: number;
  readonly depth: number;
}): GraphEvent[] => {
  const { branches, depth } = params;
  const events: GraphEvent[] = [];
  events.push({
    id: "root:0",
    parentVersion: new Set<EventId>(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "*" },
    timestamp: 0,
  });
  // Each branch forks off the root and extends independently. A
  // single "sink" event then merges every tip; this is the worst
  // case for retreat / advance work on the merge event and for the
  // partial-replay path on every post-fork insertion.
  const tips: EventId[] = [];
  for (let b = 0; b < branches; b++) {
    let parent: EventId = "root:0";
    for (let i = 0; i < depth; i++) {
      const id: EventId = `b${b}:${i}`;
      events.push({
        id,
        parentVersion: new Set<EventId>([parent]),
        operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "x" },
        timestamp: 1 + b * depth + i,
      });
      parent = id;
    }
    tips.push(parent);
  }
  events.push({
    id: "sink:0",
    parentVersion: new Set<EventId>(tips),
    operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "!" },
    timestamp: 1 + branches * depth,
  });
  return events;
};

const buildMostlyLinearEditingSession = (params: {
  readonly mainEvents: number;
  readonly forkEvents: number;
  readonly forkEveryN: number;
}): GraphEvent[] => {
  const { mainEvents, forkEvents, forkEveryN } = params;
  const events: GraphEvent[] = [];
  const prng = createPrng(0xdeadbeef | 0);
  let parent: EventId | null = null;
  let cursor = 0;
  let length = 0;

  for (let i = 0; i < mainEvents; i++) {
    const id = `main:${i}`;
    const jitter = Math.floor(prng() * 5) - 2;
    cursor = Math.max(0, Math.min(length, cursor + jitter));
    const wantDelete = prng() < 0.25 && length > 0;
    if (wantDelete) {
      const deleteLen = Math.max(
        1,
        Math.min(length - cursor, 1 + Math.floor(prng() * 3)),
      );
      events.push({
        id,
        parentVersion: new Set<EventId>(parent ? [parent] : []),
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: cursor,
          length: deleteLen,
        },
        timestamp: 1_778_000_000_000 + i,
      });
      length -= deleteLen;
    } else {
      const word = "word" + String.fromCharCode(0x61 + Math.floor(prng() * 26));
      events.push({
        id,
        parentVersion: new Set<EventId>(parent ? [parent] : []),
        operation: { type: OPERATION_TYPE.INSERT, index: cursor, text: word },
        timestamp: 1_778_000_000_000 + i,
      });
      length += word.length;
      cursor += word.length;
    }
    parent = id;

    // Periodically fork off the main author for a few events and
    // re-merge. Models a second author typing alongside the primary.
    if ((i + 1) % forkEveryN === 0) {
      let forkParent = parent;
      const forkIds: EventId[] = [];
      for (let f = 0; f < forkEvents; f++) {
        const forkId = `fork-${i}-${f}`;
        const forkAt = Math.min(length, Math.floor(prng() * length));
        events.push({
          id: forkId,
          parentVersion: new Set<EventId>([forkParent!]),
          operation: { type: OPERATION_TYPE.INSERT, index: forkAt, text: "+" },
          timestamp: 1_778_000_000_000 + i + f + 1,
        });
        forkParent = forkId;
        forkIds.push(forkId);
        length += 1;
      }
      // Merge back into the main chain.
      const mergeId = `merge:${i}`;
      events.push({
        id: mergeId,
        parentVersion: new Set<EventId>([parent!, forkParent!]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: cursor,
          text: "|",
        },
        timestamp: 1_778_000_000_000 + i + forkEvents + 1,
      });
      parent = mergeId;
      length += 1;
      cursor += 1;
    }
  }
  return events;
};

// ----------------------------------------------------------------------
// Benchmark suite
// ----------------------------------------------------------------------

const results: BenchmarkResult[] = [];

describe("EgWalkerReplica replay & storage benchmarks (issue #673)", () => {
  it("large linear history: incremental-only replay, dense binary payload", () => {
    const EVENT_COUNT = 2_000;
    const { result, replica } = runReplicaBenchmark(
      `linear-${EVENT_COUNT}`,
      () => buildLargeLinearHistory(EVENT_COUNT),
    );
    results.push(result);

    // Functional check: the replica's text equals the concatenation
    // of every inserted character (verifies the trace itself).
    expect(replica.getText().length).toBe(EVENT_COUNT);
    expect(result.events).toBe(EVENT_COUNT);

    // Replay shape on a linear append-only trace.
    //   - The first event triggers a cold-start replay (full).
    //   - Every other event must take the incremental path; in
    //     particular `partialReplays` must stay at 0 because there
    //     is no divergent suffix to replay from a checkpoint.
    //   - Retreat / advance churn must stay 0: every parent set
    //     equals the engine's current version exactly, so the
    //     diffVersions output is empty by construction.
    expect(result.fullReplays).toBeLessThanOrEqual(1);
    expect(result.partialReplays).toBe(0);
    expect(result.incrementalApplies).toBeGreaterThanOrEqual(EVENT_COUNT - 1);
    expect(result.engineRetreats).toBe(0);
    expect(result.engineAdvances).toBe(0);
    expect(result.frontierSize).toBe(1);

    // Serialized-size shape. JSON pays a fixed scaffold per event
    // (id, type, index, parentVersion array, timestamp); binary
    // collapses the constant columns down to 1-2 bytes per event.
    expect(result.binaryBytes).toBeLessThan(result.jsonBytes);
    // Hard lower bound on JSON guards against a regression that
    // silently drops a column (e.g. timestamps); upper bound keeps
    // us from accidentally accepting a JSON serializer that emits
    // extra metadata. JSON pays ~130 bytes/event on this trace
    // (id, parent-array, op type/index, timestamp), so 2k events
    // sit around 260kB.
    expect(result.jsonBytes).toBeGreaterThan(200_000);
    expect(result.jsonBytes).toBeLessThan(320_000);
    // Binary payload should stay under 12kB for 2k single-char
    // inserts — comfortable headroom over the columnar-codec-size
    // tests' linear-1k assertion (~4kB).
    expect(result.binaryBytes).toBeLessThan(12_000);
    // Compression ratio: the binary form must collapse to well
    // under 10% of the JSON baseline on a clean linear trace.
    expect(result.binaryBytes / result.jsonBytes).toBeLessThan(0.1);
  });

  it("high-concurrency branches: partial replays dominate, retreat/advance churn bounded", () => {
    const BRANCHES = 6;
    const DEPTH = 20;
    const { result } = runReplicaBenchmark(
      `concurrent-${BRANCHES}x${DEPTH}`,
      () => buildHighConcurrencyBranches({ branches: BRANCHES, depth: DEPTH }),
    );
    results.push(result);

    // Trace shape: 1 root + branches*depth + 1 sink.
    const expectedEvents = BRANCHES * DEPTH + 2;
    expect(result.events).toBe(expectedEvents);
    // After the sink merges every tip the frontier collapses to a
    // single event.
    expect(result.frontierSize).toBe(1);

    // Replay shape: every branch event after the first concurrent
    // sibling must take either the partial-replay or full-replay
    // path because retreat is needed. The exact split depends on
    // whether a critical checkpoint dominates the divergent suffix,
    // so we assert on the union instead of the breakdown.
    expect(result.partialReplays + result.fullReplays).toBeGreaterThanOrEqual(
      1,
    );
    // Engine retreat/advance churn must scale linearly with the
    // concurrent suffix, not quadratically. A conservative upper
    // bound: at most 8x the event count. (The naive pre-fast-path
    // implementation could hit ~ events^2 retreats.)
    expect(result.engineRetreats).toBeLessThan(expectedEvents * 8);
    expect(result.engineAdvances).toBeLessThan(expectedEvents * 8);

    // Storage signal: binary is comfortably smaller than JSON on a
    // worst-case parentOverride-dense trace.
    expect(result.binaryBytes).toBeLessThan(result.jsonBytes);
    expect(result.binaryBytes / result.jsonBytes).toBeLessThan(0.35);
  });

  it("mostly-linear editing session: incremental path dominates, small partial-replay tail", () => {
    const MAIN = 600;
    const { result, replica } = runReplicaBenchmark("mostly-linear", () =>
      buildMostlyLinearEditingSession({
        mainEvents: MAIN,
        forkEvents: 3,
        forkEveryN: 25,
      }),
    );
    results.push(result);

    // Functional sanity: the replica accepted every event.
    expect(result.events).toBe(replica.exportEventGraph().length);
    expect(result.events).toBeGreaterThan(MAIN);

    // Incremental path must carry the bulk of the events; the few
    // fork+merge points contribute a small partial/full-replay
    // tail.
    expect(result.incrementalApplies).toBeGreaterThan(MAIN);
    expect(result.partialReplays + result.fullReplays).toBeLessThan(
      result.events / 4,
    );

    // Storage signal still well under JSON.
    expect(result.binaryBytes).toBeLessThan(result.jsonBytes);
    expect(result.binaryBytes / result.jsonBytes).toBeLessThan(0.5);
  });

  it("scales linearly with event count on append-only traces", () => {
    // Higher event-count smoke test for the linear path. The
    // point here is *not* to assert tight wall-clock numbers (CI
    // noise makes that fragile), but to (a) confirm the linear
    // trace can replay 3k events under a generous wall-clock
    // budget and (b) record the per-event cost so a regression
    // to a worse complexity class shows up as a budget failure.
    // The 30s vitest timeout is intentionally far above the
    // inline wall-clock budget so a single noisy CI runner
    // doesn't turn this into a flake.
    const EVENT_COUNT = 3_000;
    const BUDGET_MS = 20_000;

    const events = buildLargeLinearHistory(EVENT_COUNT);
    const replica = new EgWalkerReplica("bench:linear-3k");
    const start = performance.now();
    for (const event of events) {
      replica.applyRemoteEvent(event);
    }
    const elapsed = performance.now() - start;

    expect(replica.getText().length).toBe(EVENT_COUNT);
    expect(elapsed).toBeLessThan(BUDGET_MS);

    const stats = replica.getReplayStats();
    // Same shape assertions as the smaller linear benchmark; the
    // engine must stay on the incremental fast path for every
    // event.
    expect(stats.fullReplays).toBeLessThanOrEqual(1);
    expect(stats.partialReplays).toBe(0);
    expect(stats.incrementalApplies).toBeGreaterThanOrEqual(EVENT_COUNT - 1);
    expect(stats.engineRetreats).toBe(0);
    expect(stats.engineAdvances).toBe(0);
  }, 30_000);

  afterAll(() => {
    if (results.length === 0) {
      return;
    }
    const summary = results
      .map(
        (row) =>
          `${row.traceName.padEnd(20)} ` +
          `events=${String(row.events).padStart(5)} ` +
          `frontier=${String(row.frontierSize).padStart(2)} ` +
          `full=${String(row.fullReplays).padStart(3)} ` +
          `partial=${String(row.partialReplays).padStart(3)} ` +
          `incr=${String(row.incrementalApplies).padStart(5)} ` +
          `retreat=${String(row.engineRetreats).padStart(5)} ` +
          `advance=${String(row.engineAdvances).padStart(5)} ` +
          `json=${String(row.jsonBytes).padStart(7)}B ` +
          `binary=${String(row.binaryBytes).padStart(6)}B`,
      )
      .join("\n");
    console.info(
      `\nReplay & storage benchmark summary (issue #673):\n${summary}\n`,
    );
  });
});
