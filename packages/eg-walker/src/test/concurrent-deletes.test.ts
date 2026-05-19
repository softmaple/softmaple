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
