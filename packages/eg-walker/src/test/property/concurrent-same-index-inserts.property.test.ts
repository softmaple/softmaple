/**
 * Property: when multiple replicas all insert at the same index with the
 * same parent version (the "all-concurrent root inserts" worst case for
 * YATA tie-breaking), every delivery permutation converges to the same
 * text.
 *
 * All events share `parentVersion = new Set()` (empty), so every event is
 * concurrent with every other event. The YATA origin-left tie-breaking in
 * `engine/internals/yata-integration.ts` must impose a total deterministic
 * order to satisfy the convergence property.
 *
 * Two tests:
 *   1. Two independently-shuffled delivery orders produce the same text.
 *   2. A randomly-shuffled delivery matches the canonical topological replay
 *      (events sorted by ascending timestamp, then by id).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { EgWalkerReplica } from "../../core/replica";
import type { EventId, GraphEvent } from "../../types";
import { cloneEvent } from "../test-helpers";
import { fcParams } from "./run-config";
import { shuffleWithSeed } from "./shuffle";
import { canonicalReplay } from "./trace-runner";

const BASE_TIMESTAMP = 1_780_000_000_000;

/**
 * Generates `count` concurrent insert events: all target index 0, all have
 * an empty parentVersion, unique IDs, and strictly-ascending timestamps.
 *
 * Each event inserts a unique character derived from its index (`'a'` + i),
 * so any two distinct YATA orderings produce observably different text. If
 * characters were drawn with replacement (e.g. two events both inserting
 * `'a'`), a tie-breaking regression could swap their positions without
 * changing the final string.
 *
 * Strictly-ascending timestamps keep the canonical topological order stable
 * so convergence failures are attributable to YATA, not to ambiguous ordering.
 */
const concurrentRootInsertsArb = (opts: {
  readonly minCount?: number;
  readonly maxCount?: number;
}): fc.Arbitrary<ReadonlyArray<GraphEvent>> =>
  fc
    .integer({
      min: opts.minCount ?? 2,
      max: opts.maxCount ?? 8,
    })
    .map((count) =>
      Array.from(
        { length: count },
        (_, i): GraphEvent => ({
          id: `concurrent-r${i}:0`,
          parentVersion: new Set<EventId>(),
          operation: {
            type: OPERATION_TYPE.INSERT,
            index: 0,
            text: String.fromCharCode(0x61 + i),
          },
          timestamp: BASE_TIMESTAMP + i,
        }),
      ),
    );

describe("property: concurrent same-index inserts converge", () => {
  it("two independently-shuffled delivery orders produce the same text", () => {
    fc.assert(
      fc.property(
        concurrentRootInsertsArb({ minCount: 2, maxCount: 8 }),
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        (events, seedA, seedB) => {
          const orderA = shuffleWithSeed(events, seedA);
          const orderB = shuffleWithSeed(events, seedB);

          const replicaA = new EgWalkerReplica("order-a");
          for (const event of orderA) {
            replicaA.applyRemoteEvent(cloneEvent(event));
          }

          const replicaB = new EgWalkerReplica("order-b");
          for (const event of orderB) {
            replicaB.applyRemoteEvent(cloneEvent(event));
          }

          expect(replicaA.getPendingRemoteCount()).toBe(0);
          expect(replicaB.getPendingRemoteCount()).toBe(0);

          // Every event was an insert with no deletions, so both replicas
          // must have text with length equal to the number of events.
          expect(replicaA.getText().length).toBe(events.length);
          expect(replicaB.getText().length).toBe(events.length);

          // Convergence: both replicas must agree on the exact same text.
          expect(replicaA.getText()).toBe(replicaB.getText());
        },
      ),
      fcParams(),
    );
  });

  it("any delivery permutation matches the canonical topological replay", () => {
    fc.assert(
      fc.property(
        concurrentRootInsertsArb({ minCount: 2, maxCount: 6 }),
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        (events, seed) => {
          const canonical = canonicalReplay(events);

          const shuffled = shuffleWithSeed(events, seed);
          const replica = new EgWalkerReplica("delivery");
          for (const event of shuffled) {
            replica.applyRemoteEvent(cloneEvent(event));
          }

          expect(replica.getPendingRemoteCount()).toBe(0);
          expect(replica.getText().length).toBe(events.length);
          expect(replica.getText()).toBe(canonical);
        },
      ),
      fcParams(),
    );
  });
});
