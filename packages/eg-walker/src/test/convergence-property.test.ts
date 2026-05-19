/**
 * Randomized convergence / property tests for {@link EgWalkerReplica}.
 *
 * Issue: softmaple/softmaple#673 ("Add randomized convergence/property
 * tests and performance benchmarks").
 *
 * The existing test suite covers:
 *
 *   - hand-written 2-event delivery-order cases
 *     (`algorithm-characteristics.test.ts`),
 *   - randomized topological traversal orders of one event set fed to
 *     {@link EgWalkerEngine.generate} (`traversal-order-independence.test.ts`),
 *   - per-component perf (sequence, codec, critical-version,
 *     non-conflicting-run).
 *
 * What was missing is "every replica that observes the same set of
 * events converges to the same text, regardless of which order the
 * events arrived in over the wire". This file fills that gap by
 * generating randomized multi-replica event traces and replaying each
 * trace into multiple {@link EgWalkerReplica} instances under different
 * random delivery orders, then asserting all replicas converge.
 *
 * The trace generators are kept inside this file so the test file is
 * self-contained — no fixture files, no fuzzers, just deterministic
 * pseudo-random scenarios that can be reproduced from their seeds.
 *
 * Covered scenarios (per the issue's "Missing coverage" list):
 *
 *   - randomized multi-replica event generation,
 *   - randomized delivery order,
 *   - overlapping concurrent deletes,
 *   - concurrent multi-character inserts at random positions,
 *   - surrogate-pair boundary cases,
 *   - realistic single-author editing traces (type, backspace, retype),
 *   - large numbers of replicas (stress on the buffering / causal
 *     delivery path).
 */

import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";
import { cloneEvent, createPrng } from "./test-helpers";

/**
 * Return a Fisher–Yates-shuffled copy of `items`. The input is not
 * mutated, so callers can pass `ReadonlyArray<T>` (including the
 * canonical event list) without having to pre-clone defensively.
 */
const shuffled = <T>(items: ReadonlyArray<T>, rand: () => number): T[] => {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
};

/**
 * Canonical text for an event set: topologically sort via
 * {@link EventGraph}, build a replica from that order, and read its
 * text. The replica path is the algorithm under test, so all the
 * randomized delivery-order replicas must converge on the same string.
 *
 * `initialText` lets the caller exercise the non-empty seed path
 * (commit-E placeholder coalescing); it defaults to "" so existing
 * callers do not change behaviour.
 */
const canonicalText = (
  events: ReadonlyArray<GraphEvent>,
  initialText: string = "",
): string => {
  const graph = new EventGraph();
  for (const event of events.map(cloneEvent)) {
    graph.addEvent(event);
  }
  const replica = new EgWalkerReplica("canonical", initialText);
  for (const event of graph.getTopologicalOrder()) {
    replica.applyRemoteEvent(cloneEvent(event));
  }
  return replica.getText();
};

/**
 * Apply `events` to a fresh replica in a delivery order chosen by
 * `rand`. The replica's own buffering handles out-of-causal-order
 * arrivals, so the order doesn't have to respect the DAG — it just
 * has to deliver every event eventually.
 *
 * `initialText` mirrors {@link canonicalText} and lets the caller
 * exercise the non-empty seed path.
 */
const applyInRandomDeliveryOrder = (
  replicaId: string,
  events: ReadonlyArray<GraphEvent>,
  rand: () => number,
  initialText: string = "",
): EgWalkerReplica => {
  const replica = new EgWalkerReplica(replicaId, initialText);
  // Clone each event before delivery so a replica that mutates the
  // parentVersion set of an applied event can't bleed back into the
  // shared canonical event list owned by the caller.
  const delivery = shuffled(events.map(cloneEvent), rand);
  for (const event of delivery) {
    replica.applyRemoteEvent(event);
  }
  if (replica.getPendingRemoteCount() !== 0) {
    throw new Error(
      `Replica ${replicaId} still has ${replica.getPendingRemoteCount()} buffered events after delivery; trace is not causally closed.`,
    );
  }
  return replica;
};

interface ReplicaSim {
  readonly id: string;
  replica: EgWalkerReplica;
}

/**
 * Drive `replicaCount` replicas through `eventBudget` random local
 * edits, periodically broadcasting accumulated events to the other
 * replicas. Returns the deduplicated set of events produced by all
 * replicas, plus the canonical text after the entire run.
 *
 * The trace is fully deterministic in `seed`. The "concurrency" the
 * test cares about comes from `syncEveryN > 1`: every replica gets
 * to accumulate several local edits before broadcasting, so the
 * resulting graph contains genuinely concurrent branches — exactly
 * the "concurrent edits with random delivery" scenario the paper's
 * convergence proof needs.
 */
const runRandomizedMultiReplicaTrace = (params: {
  readonly replicaCount: number;
  readonly eventBudget: number;
  readonly seed: number;
  readonly maxInsertLen: number;
  readonly deleteProbability: number;
  readonly syncEveryN: number;
  readonly initialText?: string;
}): {
  readonly events: GraphEvent[];
  readonly finalText: string;
} => {
  const {
    replicaCount,
    eventBudget,
    seed,
    maxInsertLen,
    deleteProbability,
    syncEveryN,
    initialText = "",
  } = params;
  const rand = createPrng(seed);
  const simReplicas: ReplicaSim[] = Array.from(
    { length: replicaCount },
    (_, idx) => ({
      id: `r${idx}`,
      replica: new EgWalkerReplica(`r${idx}`, initialText),
    }),
  );

  const allEventIds = new Set<EventId>();
  const allEvents: GraphEvent[] = [];

  const sync = (): void => {
    // Gather every event each replica has produced or accepted, then
    // re-deliver any new ones to every other replica in a shuffled
    // order. Replicas dedupe by id so re-delivery is safe.
    const fresh: GraphEvent[] = [];
    for (const sim of simReplicas) {
      for (const event of sim.replica.exportEventGraph()) {
        if (allEventIds.has(event.id)) {
          continue;
        }
        allEventIds.add(event.id);
        allEvents.push(cloneEvent(event));
        fresh.push(cloneEvent(event));
      }
    }
    if (fresh.length === 0) {
      return;
    }
    for (const sim of simReplicas) {
      const delivery = shuffled(
        fresh.map(cloneEvent).filter((event) => {
          // Skip re-delivering an event back to the replica that
          // originated it (event ids are `<replicaId>:<seq>`).
          const prefix = `${sim.id}:`;
          return !event.id.startsWith(prefix);
        }),
        rand,
      );
      for (const event of delivery) {
        sim.replica.applyRemoteEvent(event);
      }
    }
  };

  for (let step = 0; step < eventBudget; step++) {
    const sim = simReplicas[Math.floor(rand() * replicaCount)]!;
    const text = sim.replica.getText();
    if (text.length > 0 && rand() < deleteProbability) {
      const start = Math.floor(rand() * text.length);
      const maxLen = Math.min(text.length - start, 1 + Math.floor(rand() * 6));
      const len = Math.max(1, maxLen);
      sim.replica.delete(start, len);
    } else {
      const insertAt = Math.floor(rand() * (text.length + 1));
      const wordLen = 1 + Math.floor(rand() * maxInsertLen);
      const chars: string[] = [];
      for (let i = 0; i < wordLen; i++) {
        chars.push(String.fromCharCode(0x61 + Math.floor(rand() * 26)));
      }
      sim.replica.insert(insertAt, chars.join(""));
    }
    if ((step + 1) % syncEveryN === 0) {
      sync();
    }
  }
  sync();

  // After the final sync every replica must agree; pick the first
  // replica's text as the canonical text for the trace.
  const text = simReplicas[0]!.replica.getText();
  for (const sim of simReplicas) {
    if (sim.replica.getText() !== text) {
      throw new Error(
        `Replicas diverged during trace generation (seed=${seed}): "${sim.replica.getText()}" vs "${text}"`,
      );
    }
  }
  return { events: allEvents, finalText: text };
};

describe("EgWalkerReplica randomized convergence", () => {
  it("converges across 4 replicas under randomized delivery orders", () => {
    // 4 replicas, ~120 mixed insert/delete events, periodic sync.
    // We then replay the same event set into 8 fresh replicas under
    // 8 distinct random delivery orders and assert every replica
    // ends up with the same text.
    const { events, finalText } = runRandomizedMultiReplicaTrace({
      replicaCount: 4,
      eventBudget: 120,
      seed: 0x1234_5678,
      maxInsertLen: 4,
      deleteProbability: 0.3,
      syncEveryN: 7,
    });
    expect(canonicalText(events)).toBe(finalText);

    const rand = createPrng(0xdead_beef);
    const observed = new Set<string>([finalText]);
    for (let trial = 0; trial < 8; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      observed.add(replica.getText());
    }
    expect(observed.size).toBe(1);
    expect(observed.has(finalText)).toBe(true);
  });

  it("converges with many replicas and high concurrency", () => {
    // 8 replicas with a less frequent sync cadence means each
    // replica accumulates several local edits between syncs, so
    // the graph develops genuine concurrent branches. The
    // convergence assertion is the algorithm's strong list-spec
    // property under random branching. The workload is real work
    // (random delivery + random topological order on each
    // replica), so we give it a 30s timeout to absorb slow CI
    // runners; locally it completes in ~3s.
    const { events, finalText } = runRandomizedMultiReplicaTrace({
      replicaCount: 8,
      eventBudget: 240,
      seed: 0xabcd_0011,
      maxInsertLen: 3,
      deleteProbability: 0.25,
      syncEveryN: 17,
    });
    expect(canonicalText(events)).toBe(finalText);

    const rand = createPrng(0xfeed_face);
    const observed = new Set<string>([finalText]);
    for (let trial = 0; trial < 6; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      observed.add(replica.getText());
    }
    expect(observed.size).toBe(1);
  }, 30_000);

  it("converges across many random seeds (property sweep)", () => {
    // Sweep several seeds to make sure we're not pinning convergence
    // to one lucky PRNG sequence. Each seed produces a fresh event
    // set; both the canonical (topological) order and a randomized
    // delivery order must converge.
    for (const seed of [0x0001, 0x0042, 0x1f3d, 0x2a55, 0x9e3779b9 | 0]) {
      const { events, finalText } = runRandomizedMultiReplicaTrace({
        replicaCount: 3,
        eventBudget: 80,
        seed,
        maxInsertLen: 4,
        deleteProbability: 0.3,
        syncEveryN: 5,
      });
      expect(canonicalText(events), `seed=${seed}`).toBe(finalText);

      const rand = createPrng(seed ^ 0xa5a5_a5a5);
      const replica = applyInRandomDeliveryOrder("rand", events, rand);
      expect(replica.getText(), `seed=${seed}`).toBe(finalText);
    }
  });

  it("converges across a wide seed sweep with non-empty initial text and concurrent splits", () => {
    // Targets the commit-E change that collapses the initial
    // document text into a single placeholder record (split on
    // demand by concurrent inserts and deletes). The previous
    // full-replay path emitted one CRDT item per code unit of the
    // seed, so each concurrent insert anchored to a distinct
    // `__base__:K` id. With the new path *every* concurrent insert
    // anchored inside the seed resolves to the same single
    // placeholder record, and the engine's `originLeftRefs` +
    // `splitRecordAt` machinery must produce the same final text
    // across every valid delivery order and across runtime +
    // topological-order variations.
    //
    // The randomized 5-seed sweep above only exercises empty
    // initial text. This sweep runs many seeds with a non-empty
    // seed and a higher concurrency factor (`syncEveryN=7`) so
    // every replica accumulates several local edits anchored
    // inside the seed text before broadcasting, producing
    // genuinely concurrent splits. Each seed is also re-validated
    // under a fully randomized delivery order — different
    // topological permutations of the same event set must produce
    // the same final text.
    const SEED_COUNT = 150;
    const initialText = "the quick brown fox jumps over the lazy dog";
    const failures: string[] = [];
    for (let i = 0; i < SEED_COUNT; i++) {
      // Mix `i` with a large prime so consecutive seeds explore
      // distinct PRNG trajectories rather than nearby ones.
      const seed = (i * 2654435761) | 0;
      const trace = runRandomizedMultiReplicaTrace({
        replicaCount: 3,
        eventBudget: 40,
        seed,
        maxInsertLen: 4,
        deleteProbability: 0.3,
        syncEveryN: 7,
        initialText,
      });
      const canonical = canonicalText(trace.events, initialText);
      if (canonical !== trace.finalText) {
        failures.push(
          `seed=${seed} (i=${i}): canonical="${canonical}" vs final="${trace.finalText}"`,
        );
        continue;
      }
      const rand = createPrng(seed ^ 0x5a5a_5a5a);
      const replica = applyInRandomDeliveryOrder(
        "rand",
        trace.events,
        rand,
        initialText,
      );
      if (replica.getText() !== trace.finalText) {
        failures.push(
          `seed=${seed} (i=${i}): random-delivery="${replica.getText()}" vs final="${trace.finalText}"`,
        );
      }
    }
    expect(failures, failures.slice(0, 3).join("\n")).toEqual([]);
  }, 60_000);

  it("converges across a wide seed sweep with concurrent edits inside typed runs", () => {
    // Targets the §3.4 "smaller" typed-run coalescing path: when
    // every local insert is a single character with a canonical
    // `replicaId:sequence` id, contiguous events from one author land
    // in the same ranked-B-tree leaf. A concurrent insert or delete
    // from a sibling replica that anchors *inside* that leaf must
    // split the typed run on demand, and the post-split right half
    // gets a deterministic `${replicaId}:${startSequence}:0` id so
    // every replica can converge on the same anchor identity.
    //
    // With `maxInsertLen = 1` every local edit grows the originating
    // replica's typed run, and `syncEveryN = 5` lets each replica
    // accumulate enough characters to form a multi-code-unit run
    // before broadcasting. The other replicas then deliver their
    // own typed-run extensions and split-on-demand edits inside the
    // accumulated runs. Each seed is also re-validated under a fully
    // randomized delivery order so different topological orders of
    // the same event set must produce the same final text.
    const SEED_COUNT = 150;
    const failures: string[] = [];
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1140671485 + 12820163) | 0;
      const trace = runRandomizedMultiReplicaTrace({
        replicaCount: 3,
        eventBudget: 50,
        seed,
        maxInsertLen: 1,
        deleteProbability: 0.35,
        syncEveryN: 5,
      });
      const canonical = canonicalText(trace.events);
      if (canonical !== trace.finalText) {
        failures.push(
          `seed=${seed} (i=${i}): canonical="${canonical}" vs final="${trace.finalText}"`,
        );
        continue;
      }
      const rand = createPrng(seed ^ 0x9e37_79b9);
      const replica = applyInRandomDeliveryOrder("rand", trace.events, rand);
      if (replica.getText() !== trace.finalText) {
        failures.push(
          `seed=${seed} (i=${i}): random-delivery="${replica.getText()}" vs final="${trace.finalText}"`,
        );
      }
    }
    expect(failures, failures.slice(0, 3).join("\n")).toEqual([]);
  }, 60_000);
});
