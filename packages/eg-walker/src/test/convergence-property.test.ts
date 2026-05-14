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

describe("EgWalkerReplica overlapping concurrent deletes", () => {
  /**
   * Two replicas delete partially overlapping ranges of the same
   * shared text. The strong list-spec says the union of deletions
   * survives in either traversal order; the engine's tombstone
   * tracking must therefore make `everDeleted` idempotent across
   * concurrent overlapping deletes.
   */
  const makeOverlappingDeleteEvents = (params: {
    readonly base: string;
    readonly aRange: readonly [number, number];
    readonly bRange: readonly [number, number];
  }): GraphEvent[] => {
    const { base, aRange, bRange } = params;
    return [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: base },
        timestamp: 0,
      },
      {
        id: "alice:0",
        parentVersion: new Set<EventId>(["root:0"]),
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: aRange[0],
          length: aRange[1],
        },
        timestamp: 1,
      },
      {
        id: "bob:0",
        parentVersion: new Set<EventId>(["root:0"]),
        operation: {
          type: OPERATION_TYPE.DELETE,
          index: bRange[0],
          length: bRange[1],
        },
        timestamp: 2,
      },
    ];
  };

  it("collapses fully-overlapping concurrent deletes to a single deletion", () => {
    // Alice and Bob both delete the exact same 3-character range.
    // The expected text is the survivor characters either side.
    const events = makeOverlappingDeleteEvents({
      base: "abcdefghij",
      aRange: [2, 3],
      bRange: [2, 3],
    });
    const text = canonicalText(events);
    expect(text).toBe("abfghij");

    // Either delivery order yields the same text.
    const rand = createPrng(0x1010_1010);
    for (let trial = 0; trial < 10; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      expect(replica.getText()).toBe(text);
    }
  });

  it("merges partially-overlapping concurrent deletes (union of ranges)", () => {
    // Alice deletes "cd" at index 2; Bob deletes "de" at index 3.
    // Their union is "cde" — the resulting text is "abfghij".
    const events = makeOverlappingDeleteEvents({
      base: "abcdefghij",
      aRange: [2, 2],
      bRange: [3, 2],
    });
    const text = canonicalText(events);
    expect(text).toBe("abfghij");

    const rand = createPrng(0x2020_2020);
    for (let trial = 0; trial < 10; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      expect(replica.getText()).toBe(text);
    }
  });

  it("converges on randomized overlapping delete swarms", () => {
    // Eight replicas, each repeatedly deleting random slices of a
    // shared base string. The delete ranges drift over time as the
    // local text shrinks, so concurrent deletes overlap in messy
    // ways. The convergence guarantee says every replica still
    // ends with the same text.
    const REPLICA_COUNT = 6;
    const baseText = "the quick brown fox jumps over the lazy dog";
    const rootEvent: GraphEvent = {
      id: "root:0",
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: baseText },
      timestamp: 0,
    };

    const allEvents: GraphEvent[] = [rootEvent];
    const rand = createPrng(0xc0de_d00d);
    // Each replica issues a few independent deletes against the
    // *initial* base string (everyone forks off root:0), so all the
    // deletes are pairwise concurrent.
    for (let r = 0; r < REPLICA_COUNT; r++) {
      const replicaId = `r${r}`;
      for (let i = 0; i < 4; i++) {
        const start = Math.floor(rand() * baseText.length);
        const len = 1 + Math.floor(rand() * 6);
        const safeLen = Math.min(baseText.length - start, len);
        if (safeLen <= 0) {
          continue;
        }
        // Manually craft the event so every delete forks off root:0
        // (rather than off the replica's own previous delete) —
        // that's what makes them pairwise concurrent.
        const event: GraphEvent = {
          id: `${replicaId}:${i}`,
          parentVersion: new Set<EventId>(["root:0"]),
          operation: {
            type: OPERATION_TYPE.DELETE,
            index: start,
            length: safeLen,
          },
          timestamp: 1 + i,
        };
        allEvents.push(event);
      }
    }

    const text = canonicalText(allEvents);
    for (let trial = 0; trial < 12; trial++) {
      const replica = applyInRandomDeliveryOrder(
        `verify-${trial}`,
        allEvents,
        rand,
      );
      expect(replica.getText(), `trial=${trial}`).toBe(text);
    }
  });
});

describe("EgWalkerReplica concurrent multi-character inserts", () => {
  it("never interleaves concurrent multi-character inserts", () => {
    // Four authors all insert a 4-character word concurrently at the
    // start of the same root text. The result must be the four words
    // in some YATA-tie-broken order, none of them split across each
    // other.
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "_" },
        timestamp: 0,
      },
    ];
    const words = ["alpha", "bravo", "delta", "gamma"];
    for (let i = 0; i < words.length; i++) {
      events.push({
        id: `r${i}:0`,
        parentVersion: new Set<EventId>(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: words[i]! },
        timestamp: 1 + i,
      });
    }
    const text = canonicalText(events);

    // Every word must survive contiguously.
    for (const word of words) {
      expect(text.includes(word), `word=${word}`).toBe(true);
    }
    // Anchor character is at the end (every concurrent insert lands
    // at index 0 of the root text).
    expect(text.endsWith("_")).toBe(true);

    // Convergence across delivery orders.
    const rand = createPrng(0x4040_4040);
    for (let trial = 0; trial < 10; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      expect(replica.getText()).toBe(text);
    }
  });

  it("preserves multi-character inserts as contiguous runs under random delivery", () => {
    // Three replicas concurrently insert a 5-character word at
    // random positions in a shared base text. The merged result
    // must preserve each word as a contiguous substring.
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: "0123456789",
        },
        timestamp: 0,
      },
    ];
    const inserts: ReadonlyArray<{ id: string; at: number; text: string }> = [
      { id: "alice:0", at: 0, text: "ALICE" },
      { id: "bob:0", at: 5, text: "BOBOB" },
      { id: "carol:0", at: 10, text: "CAROL" },
    ];
    for (let i = 0; i < inserts.length; i++) {
      const { id, at, text } = inserts[i]!;
      events.push({
        id,
        parentVersion: new Set<EventId>(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: at, text },
        timestamp: 1 + i,
      });
    }
    const text = canonicalText(events);
    for (const { text: word } of inserts) {
      expect(text.includes(word), `word=${word}`).toBe(true);
    }

    const rand = createPrng(0x5050_5050);
    for (let trial = 0; trial < 8; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      expect(replica.getText()).toBe(text);
    }
  });
});

describe("EgWalkerReplica surrogate-pair boundary cases", () => {
  // A handful of non-BMP code points that the engine should always
  // treat as 2-code-unit atomic units. The convergence property must
  // hold even when an insert sits next to a surrogate pair, and the
  // resulting text must remain well-formed UTF-16 (no lone
  // surrogates).
  const SURROGATE_EMOJI = "\u{1F600}"; // grinning face, UTF-16 length 2
  const HEART = "\u{1F49C}"; // purple heart
  const FLAG = "\u{1F1F8}\u{1F1EA}"; // regional indicator pair (Swedish flag)

  const wellFormedUtf16 = (text: string): boolean => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
        if (next < 0xdc00 || next > 0xdfff) {
          return false;
        }
        i++;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return false;
      }
    }
    return true;
  };

  it("rejects inserts that land between the halves of a surrogate pair", () => {
    const replica = new EgWalkerReplica("r1", SURROGATE_EMOJI);
    // Index 1 sits between the high and low surrogate of the emoji.
    expect(() => replica.insert(1, "x")).toThrow(/surrogate halves/);
    // Inserts at the BMP-aligned boundaries (0 and 2) are fine.
    expect(() => replica.insert(0, "x")).not.toThrow();
    expect(() => replica.insert(replica.getText().length, "y")).not.toThrow();
    expect(wellFormedUtf16(replica.getText())).toBe(true);
  });

  it("converges across concurrent inserts around a surrogate pair", () => {
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: `pre${SURROGATE_EMOJI}post`,
        },
        timestamp: 0,
      },
      {
        id: "alice:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Insert immediately before the emoji (code-unit index 3).
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "A" },
        timestamp: 1,
      },
      {
        id: "bob:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Insert immediately after the emoji (code-unit index 5).
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "B" },
        timestamp: 2,
      },
      {
        id: "carol:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Insert another surrogate pair right after the existing one.
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: HEART },
        timestamp: 3,
      },
    ];

    const text = canonicalText(events);
    // Both concurrent atomic inserts and the surrogate-pair-inside
    // edit must produce well-formed UTF-16.
    expect(wellFormedUtf16(text)).toBe(true);
    expect(text.includes(SURROGATE_EMOJI)).toBe(true);
    expect(text.includes(HEART)).toBe(true);
    expect(text.includes("A")).toBe(true);
    expect(text.includes("B")).toBe(true);

    const rand = createPrng(0x6060_6060);
    for (let trial = 0; trial < 8; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      expect(replica.getText(), `trial=${trial}`).toBe(text);
      expect(wellFormedUtf16(replica.getText())).toBe(true);
    }
  });

  it("converges across concurrent deletes that wrap a surrogate pair", () => {
    // Alice deletes a range that includes the whole emoji; Bob
    // deletes a smaller subset on the same side. Both must agree on
    // the result and never produce a lone surrogate.
    const baseText = `xy${FLAG}zw`;
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: baseText },
        timestamp: 0,
      },
      {
        id: "alice:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Delete "y" + the regional-indicator pair (code-unit length 5).
        operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 5 },
        timestamp: 1,
      },
      {
        id: "bob:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Delete just "y".
        operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
        timestamp: 2,
      },
    ];

    const text = canonicalText(events);
    expect(wellFormedUtf16(text)).toBe(true);
    // Alice's larger delete dominates: only the trailing "zw"
    // survives because the union of the two deletions removes the
    // whole prefix `y${FLAG}`.
    expect(text).toBe("xzw");

    const rand = createPrng(0x7070_7070);
    for (let trial = 0; trial < 6; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      expect(replica.getText(), `trial=${trial}`).toBe(text);
      expect(wellFormedUtf16(replica.getText())).toBe(true);
    }
  });
});

describe("EgWalkerReplica realistic editing traces", () => {
  /**
   * Single-author trace that imitates "type a sentence, backspace,
   * retype the end". No concurrent branches, but exercises the
   * incremental-apply path repeatedly and round-trips through the
   * (un)serializer.
   */
  it("round-trips a realistic single-author editing session", () => {
    const replica = new EgWalkerReplica("solo");
    replica.insert(0, "the quik brown fox");
    // Realise we misspelled "quick".
    replica.delete(4, 4); // remove "quik"
    replica.insert(4, "quick"); // type it correctly
    // Add a clause to the end.
    replica.insert(replica.getText().length, " jumps");
    // Backspace + retype the verb.
    replica.delete(replica.getText().length - 6, 6);
    replica.insert(replica.getText().length, " leaps");
    expect(replica.getText()).toBe("the quick brown fox leaps");

    // Serialize + deserialize and confirm we can keep editing.
    const serialized = replica.serialize();
    const restored = EgWalkerReplica.deserialize(serialized, "solo");
    expect(restored.getText()).toBe("the quick brown fox leaps");
    restored.insert(restored.getText().length, "!");
    expect(restored.getText()).toBe("the quick brown fox leaps!");

    // Replay counters should reflect the incremental path: no full
    // replays after the cold start, every local edit advances the
    // engine in place.
    const stats = replica.getReplayStats();
    expect(stats.incrementalApplies).toBeGreaterThan(0);
    // The cold-start replay is the only full replay in a single-author
    // trace.
    expect(stats.fullReplays).toBeLessThanOrEqual(1);
  });

  /**
   * Two authors collaborate on a shared draft. Each takes turns
   * adding a sentence, with periodic syncs. The merged text must
   * preserve every sentence the authors contributed.
   */
  it("merges a two-author collaborative draft deterministically", () => {
    // Both replicas start blank; the shared `seed:0` event sets up
    // the initial "Start. " prefix so every subsequent event has a
    // common causal ancestor.
    const alice = new EgWalkerReplica("alice");
    const bob = new EgWalkerReplica("bob");
    const seed: GraphEvent = {
      id: "seed:0",
      parentVersion: new Set<EventId>(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "Start. " },
      timestamp: 0,
    };
    alice.applyRemoteEvent(cloneEvent(seed));
    bob.applyRemoteEvent(cloneEvent(seed));

    // Sync after every "turn" so we get a clean line of incremental
    // applies rather than divergent forks. Two sync rounds.
    const sync = (): void => {
      const events: GraphEvent[] = [
        ...alice.exportEventGraph().map(cloneEvent),
        ...bob.exportEventGraph().map(cloneEvent),
      ];
      // `createPrng` is intentionally re-seeded with the *same*
      // constant on every call so each sync round shuffles the
      // event list in the same order. We want this test to assert
      // that two authors converge under a specific (reproducible)
      // delivery order; the dedicated "randomized convergence"
      // tests above exercise the cross-seed delivery-order space.
      const rand = createPrng(0x9999_9999);
      for (const event of shuffled(events, rand)) {
        alice.applyRemoteEvent(cloneEvent(event));
        bob.applyRemoteEvent(cloneEvent(event));
      }
    };

    alice.insert(alice.getText().length, "Alice writes intro. ");
    bob.insert(bob.getText().length, "Bob outlines plan. ");
    sync();
    expect(alice.getText()).toBe(bob.getText());

    alice.insert(alice.getText().length, "Alice expands intro. ");
    bob.insert(bob.getText().length, "Bob adds detail. ");
    sync();
    expect(alice.getText()).toBe(bob.getText());

    const merged = alice.getText();
    expect(merged.includes("Alice writes intro.")).toBe(true);
    expect(merged.includes("Bob outlines plan.")).toBe(true);
    expect(merged.includes("Alice expands intro.")).toBe(true);
    expect(merged.includes("Bob adds detail.")).toBe(true);

    // Replay convergence: feeding both replicas' event graphs into a
    // fresh replica under any delivery order yields the same text.
    const allEvents: GraphEvent[] = [...alice.exportEventGraph()].map(
      cloneEvent,
    );
    const rand = createPrng(0xaaaa_bbbb);
    for (let trial = 0; trial < 8; trial++) {
      const replica = applyInRandomDeliveryOrder(
        `verify-${trial}`,
        allEvents,
        rand,
      );
      expect(replica.getText(), `trial=${trial}`).toBe(merged);
    }
  });

  it("converges replicas that observe disjoint subsets of events first", () => {
    // Three replicas, each seeing a *different* random ~60% subset
    // of the event set before the rest is delivered. This is the
    // canonical partition-then-heal pattern (network partition →
    // partial catch-up → full reconciliation): every replica
    // observes a distinct prefix, so during the first phase the
    // replicas are genuinely out of sync, and convergence is only
    // re-established after the second phase delivers the
    // complement.
    const { events, finalText } = runRandomizedMultiReplicaTrace({
      replicaCount: 3,
      eventBudget: 90,
      seed: 0xcafe_babe,
      maxInsertLen: 4,
      deleteProbability: 0.3,
      syncEveryN: 6,
    });

    const rand = createPrng(0xfafa_fafa);
    const replicaCount = 3;
    const replicas: EgWalkerReplica[] = [];
    // Each replica gets its OWN random partition so the "first
    // halves" the replicas observe really are disjoint subsets of
    // the trace, not the same subset under different delivery
    // orders.
    const firstHalves: GraphEvent[][] = [];
    const secondHalves: GraphEvent[][] = [];
    for (let i = 0; i < replicaCount; i++) {
      replicas.push(new EgWalkerReplica(`partition-${i}`));
      const perReplica = shuffled(events.map(cloneEvent), rand);
      const splitAt = Math.floor(perReplica.length * 0.6);
      firstHalves.push(perReplica.slice(0, splitAt));
      secondHalves.push(perReplica.slice(splitAt));
    }

    // Phase 1: each replica receives its own ~60% subset. After
    // this phase the replicas have observed different subsets and
    // may have buffered events whose causal predecessors are still
    // in their respective second halves.
    for (let i = 0; i < replicaCount; i++) {
      for (const event of firstHalves[i]!) {
        replicas[i]!.applyRemoteEvent(event);
      }
    }
    // Sanity: at least one replica must see a partition that
    // differs from at least one other replica's. If they were all
    // identical we would not actually be testing the partition
    // pattern — we would just be testing delivery-order variation,
    // which is already covered by other tests in this file.
    const firstHalfIdSets = firstHalves.map(
      (half) => new Set<EventId>(half.map((event) => event.id)),
    );
    let sawDisjointPair = false;
    for (let a = 0; a < replicaCount && !sawDisjointPair; a++) {
      for (let b = a + 1; b < replicaCount; b++) {
        const aSet = firstHalfIdSets[a]!;
        const bSet = firstHalfIdSets[b]!;
        for (const id of aSet) {
          if (!bSet.has(id)) {
            sawDisjointPair = true;
            break;
          }
        }
        if (sawDisjointPair) {
          break;
        }
      }
    }
    expect(sawDisjointPair).toBe(true);

    // Phase 2: deliver the complement. After this every replica
    // has observed every event (in some delivery order) and must
    // converge to the canonical text.
    for (let i = 0; i < replicaCount; i++) {
      for (const event of secondHalves[i]!) {
        replicas[i]!.applyRemoteEvent(event);
      }
      expect(replicas[i]!.getPendingRemoteCount()).toBe(0);
      expect(replicas[i]!.getText()).toBe(finalText);
    }
  });
});

describe("EgWalkerReplica causal-buffering under random delivery", () => {
  it("buffers and flushes out-of-order remote events without diverging", () => {
    // Build a forked DAG: root → A → C; root → B → D; D parents
    // include both A and B (deep merge). Then deliver the events to
    // a fresh replica in reverse order so every event lands before
    // its parents and gets buffered, exercising the
    // `pendingByMissingParent` path on every event except root.
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "ROOT" },
        timestamp: 0,
      },
      {
        id: "A:0",
        parentVersion: new Set<EventId>(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 4, text: "-A" },
        timestamp: 1,
      },
      {
        id: "B:0",
        parentVersion: new Set<EventId>(["root:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B-" },
        timestamp: 2,
      },
      {
        id: "C:0",
        parentVersion: new Set<EventId>(["A:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "C-" },
        timestamp: 3,
      },
      {
        id: "D:0",
        parentVersion: new Set<EventId>(["A:0", "B:0"]),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "D-" },
        timestamp: 4,
      },
    ];
    const expected = canonicalText(events);

    // Reverse delivery: every event arrives before its parents.
    const replica = new EgWalkerReplica("reverse");
    for (let i = events.length - 1; i >= 0; i--) {
      replica.applyRemoteEvent(cloneEvent(events[i]!));
    }
    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getText()).toBe(expected);
  });

  it("converges with replicas receiving completely shuffled deliveries", () => {
    // A larger sweep across random deliveries. Each trial picks a
    // random permutation, drops the events through a fresh replica,
    // and asserts the final text matches the canonical replay.
    const { events, finalText } = runRandomizedMultiReplicaTrace({
      replicaCount: 4,
      eventBudget: 60,
      seed: 0x5555_6666,
      maxInsertLen: 3,
      deleteProbability: 0.25,
      syncEveryN: 5,
    });

    const rand = createPrng(0x7777_8888);
    for (let trial = 0; trial < 20; trial++) {
      const replica = applyInRandomDeliveryOrder(
        `trial-${trial}`,
        events,
        rand,
      );
      expect(replica.getText(), `trial=${trial}`).toBe(finalText);
    }
  });
});
