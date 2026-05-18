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
