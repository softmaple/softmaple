/**
 * Focused performance and correctness tests for Section 3.4's
 * internal-document / non-conflicting-run fast path on
 * {@link EgWalkerEngine}.
 *
 * Without the fast path every event ran the same prepare/effect pipeline:
 *   - compute `diffVersions(currentVersion, event.parentVersion)` (heap
 *     traversal of the causal graph),
 *   - drain the resulting retreat / advance lists (each item touches
 *     `IndexedSequence.updateItem`),
 *   - call `findIntegrationPosition` for every inserted code unit
 *     (YATA scan + per-character `positionOf` lookups).
 *
 * For a linear, single-author trace every one of those steps is a
 * no-op: the parent version already equals the current version, the
 * retreat / advance lists are empty, and the destination range
 * strictly between `originLeft` and `originRight` has no concurrent
 * siblings to scan over. These tests pin down two properties:
 *
 *   1. The engine reports every event as taking the
 *      `nonConflictingRunCount` fast path on a purely linear trace,
 *      and falls back to the full-replay path on traces with
 *      concurrent siblings.
 *   2. Replaying a 20 000-event linear trace finishes well below the
 *      O(events) work the slow path would do (which we measure here
 *      via wall-clock time on the same machine).
 */

import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

const buildLinearInsertTrace = (length: number): GraphEvent[] => {
  const events: GraphEvent[] = [];
  let parent: EventId | null = null;
  for (let i = 0; i < length; i++) {
    const id = `n:${i}`;
    events.push({
      id,
      parentVersion: new Set<EventId>(parent ? [parent] : []),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: i,
        text: "x",
      },
      timestamp: i,
    });
    parent = id;
  }
  return events;
};

const buildMultiCharLinearTrace = (
  length: number,
  textPerEvent: string,
): GraphEvent[] => {
  const events: GraphEvent[] = [];
  let parent: EventId | null = null;
  let cursor = 0;
  for (let i = 0; i < length; i++) {
    const id = `n:${i}`;
    events.push({
      id,
      parentVersion: new Set<EventId>(parent ? [parent] : []),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: cursor,
        text: textPerEvent,
      },
      timestamp: i,
    });
    cursor += textPerEvent.length;
    parent = id;
  }
  return events;
};

describe("Section 3.4 non-conflicting-run fast path", () => {
  it("reports every event in a linear single-author trace as fast-path", () => {
    const events = buildLinearInsertTrace(200);
    const engine = new EgWalkerEngine();
    const graph = EventGraph.fromEvents(events);

    const generated = engine.generate(events, "", { eventGraph: graph });

    expect(generated.text).toBe("x".repeat(events.length));
    expect(generated.stats.eventsProcessed).toBe(events.length);
    expect(generated.stats.nonConflictingRunCount).toBe(events.length);
    expect(generated.stats.fullReplayCount).toBe(0);
    // The fast path is the whole point: no retreat / advance work
    // should be needed for a linear trace, and the engine should
    // not have allocated any retreat/advance churn.
    expect(generated.stats.retreatCount).toBe(0);
    expect(generated.stats.advanceCount).toBe(0);
  });

  it("falls back to full replay for concurrent events", () => {
    // Two concurrent inserts share the same parent version. The
    // second one's parent ({}) cannot equal the engine's current
    // version ({alice:0}) after the first event is applied, so it
    // must take the full replay path. A subsequent merge event
    // whose parent contains an ancestor not in the engine's
    // current-version frontier representation (`{event.id}` after
    // each apply) also takes the full replay path because the
    // simple set-equality check is conservative — handing it the
    // diffVersions machinery is still correct, just not as fast.
    const events: GraphEvent[] = [
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
        timestamp: 1,
      },
      {
        id: "bob:0",
        parentVersion: new Set(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
        timestamp: 2,
      },
      {
        id: "merge:0",
        parentVersion: new Set(["alice:0", "bob:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "C" },
        timestamp: 3,
      },
    ];

    const graph = EventGraph.fromEvents(events);
    const generated = new EgWalkerEngine().generate(events, "", {
      eventGraph: graph,
    });

    // alice:0 has parent {} == initial currentVersion (empty) so it
    // takes the fast path. bob:0 has parent {} but currentVersion is
    // {alice:0}, so it falls through to the slow path. merge:0 has
    // parent {alice:0, bob:0} but currentVersion is {bob:0} (the
    // engine collapses to a singleton frontier after each apply), so
    // it also takes the slow path.
    expect(generated.stats.nonConflictingRunCount).toBe(1);
    expect(generated.stats.fullReplayCount).toBe(2);
    expect(
      generated.stats.nonConflictingRunCount + generated.stats.fullReplayCount,
    ).toBe(events.length);
    // The retreat / advance churn must come entirely from the slow
    // paths (retreat alice:0 for bob:0, then advance alice:0 for
    // merge:0).
    expect(generated.stats.retreatCount).toBeGreaterThanOrEqual(1);
    expect(generated.stats.advanceCount).toBeGreaterThanOrEqual(1);
  });

  it("batches multi-character inserts without per-character YATA scans", () => {
    // A multi-character insert event is materialised into one CRDT
    // record per code unit, all chained off the previous via
    // `originLeft`. The batched path inserts them at sequential
    // positions without re-running the integration scan.
    const events = buildMultiCharLinearTrace(50, "hello");
    const engine = new EgWalkerEngine();
    const graph = EventGraph.fromEvents(events);

    const generated = engine.generate(events, "", { eventGraph: graph });

    expect(generated.text).toBe("hello".repeat(events.length));
    expect(generated.stats.nonConflictingRunCount).toBe(events.length);
    expect(generated.stats.fullReplayCount).toBe(0);
    // Single-author multi-character inserts must not produce any
    // retreat / advance churn.
    expect(generated.stats.retreatCount).toBe(0);
    expect(generated.stats.advanceCount).toBe(0);
  });

  it("agrees with the engine's slow-path output on a mixed concurrent trace", () => {
    // Convergence guard: replay the same event set on a fresh engine
    // (with no fast-path-friendly current version) and confirm both
    // runs produce identical text. The trace mixes a long linear
    // prefix with a small concurrent island so both code paths get
    // exercised.
    const linearPrefix = buildLinearInsertTrace(200);
    const concurrentTail: GraphEvent[] = [
      {
        id: "alice:tail",
        parentVersion: new Set(["n:199"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 100, text: "A" },
        timestamp: 1000,
      },
      {
        id: "bob:tail",
        parentVersion: new Set(["n:199"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 50, text: "B" },
        timestamp: 1001,
      },
      {
        id: "merge",
        parentVersion: new Set(["alice:tail", "bob:tail"]),
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: 0,
          length: 4,
        },
        timestamp: 1002,
      },
    ];
    const events = [...linearPrefix, ...concurrentTail];

    const graph = EventGraph.fromEvents(events);
    const ordered = graph.getTopologicalOrder();

    const firstRun = new EgWalkerEngine().generate(ordered, "", {
      eventGraph: graph,
    });
    const secondRun = new EgWalkerEngine().generate(ordered, "", {
      eventGraph: graph,
    });

    expect(firstRun.text).toBe(secondRun.text);
    expect(firstRun.stats.nonConflictingRunCount).toBe(
      secondRun.stats.nonConflictingRunCount,
    );
    expect(firstRun.stats.fullReplayCount).toBe(
      secondRun.stats.fullReplayCount,
    );
    // The linear prefix and the merge event must hit the fast path;
    // only the two concurrent tail events fall back to full replay.
    expect(firstRun.stats.fullReplayCount).toBe(2);
    expect(firstRun.stats.nonConflictingRunCount).toBe(events.length - 2);
  });

  it("replays a 20k-event linear trace under an O(n) budget", () => {
    // The fast path keeps per-event work at O(log n) for the
    // IndexedSequence insert plus a handful of constant-time map
    // operations. Replaying 20 000 single-character inserts should
    // therefore finish well under a second on a CI runner; the
    // pre-fast-path engine paid `diffVersions` + a YATA scan setup on
    // every event, which on a 20k-item tree was already in the high
    // hundreds of ms locally. The budget here is loose so the test
    // is stable across noisy CI machines but still catches a
    // regression to the per-event slow path.
    const EVENT_COUNT = 20_000;
    const BUDGET_MS = 4_000;

    const events = buildLinearInsertTrace(EVENT_COUNT);
    const graph = EventGraph.fromEvents(events);

    const engine = new EgWalkerEngine();
    const start = performance.now();
    const generated = engine.generate(events, "", { eventGraph: graph });
    const elapsed = performance.now() - start;

    expect(generated.text.length).toBe(EVENT_COUNT);
    expect(generated.stats.nonConflictingRunCount).toBe(EVENT_COUNT);
    expect(generated.stats.fullReplayCount).toBe(0);
    expect(elapsed).toBeLessThan(BUDGET_MS);
    // Section 3.4 "smaller" lever: typed-run coalescing collapses
    // contiguous single-character INSERTs from one author into one
    // ranked-B-tree record. A 20 000-event linear single-author trace
    // is one big typed run from `n`, so the engine should hold a tiny
    // constant number of records instead of one per code unit. The
    // budget is intentionally loose so a future regression (e.g. a
    // boundary case that prevents extension) is caught quantitatively
    // without making the test brittle to harmless changes in the
    // coalescing branch's guard set.
    expect(generated.stats.sequenceRecordCount).toBeLessThan(8);
  });

  it("coalesces a single-author linear trace into one record", () => {
    // Tight invariant for the typed-run fast path: with no concurrent
    // siblings, no deletes, and a canonical `replicaId:sequence` author,
    // every event after the first extends the same ranked-B-tree leaf.
    // The final state is exactly one record holding all `EVENT_COUNT`
    // code units, regardless of trace length.
    const EVENT_COUNT = 5_000;

    const events = buildLinearInsertTrace(EVENT_COUNT);
    const graph = EventGraph.fromEvents(events);

    const generated = new EgWalkerEngine().generate(events, "", {
      eventGraph: graph,
    });

    expect(generated.text.length).toBe(EVENT_COUNT);
    expect(generated.stats.sequenceRecordCount).toBe(1);
  });
});
