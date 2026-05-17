/**
 * Property: events delivered before their causal parents are held in
 * the `RemoteEventBuffer` and flushed exactly once their parents
 * arrive. The terminal state must match the canonical replay over the
 * same event set.
 *
 * Uses `eventDagArb` so we control both the parent topology and the
 * delivery order, decoupled from the multi-replica trace runner.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { cloneEvent } from "../test-helpers";
import { eventDagArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { shuffleWithSeed } from "./shuffle";
import { canonicalReplay } from "./trace-runner";

describe("property: missing-parent buffering", () => {
  it("reverse-order delivery is buffered, then flushed to canonical text", () => {
    fc.assert(
      fc.property(eventDagArb({ minSize: 3, maxSize: 12 }), (events) => {
        const expected = canonicalReplay(events);

        // Reverse-topological delivery: every non-root event lands
        // before its parents and must be buffered.
        const replica = new EgWalkerReplica("reverse");
        let sawBuffering = false;
        for (let i = events.length - 1; i >= 0; i--) {
          replica.applyRemoteEvent(cloneEvent(events[i]!));
          if (replica.getPendingRemoteCount() > 0) {
            sawBuffering = true;
          }
        }
        expect(replica.getPendingRemoteCount()).toBe(0);
        expect(replica.getText()).toBe(expected);

        // We expect buffering to be exercised for any DAG with at
        // least one non-root event (i.e. every DAG of size ≥ 2,
        // because index 0 is a root and index 1 has it as a
        // parent). The single-event case has no parents to wait on.
        if (events.length >= 2) {
          expect(sawBuffering).toBe(true);
        }
      }),
      fcParams(),
    );
  });

  it("arbitrary delivery permutations flush completely", () => {
    fc.assert(
      fc.property(
        eventDagArb({ minSize: 2, maxSize: 10 }),
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        (events, seed) => {
          const expected = canonicalReplay(events);
          const delivery = shuffleWithSeed(events, seed);
          const replica = new EgWalkerReplica("shuffled");
          for (const event of delivery) {
            replica.applyRemoteEvent(cloneEvent(event));
          }
          expect(replica.getPendingRemoteCount()).toBe(0);
          expect(replica.getText()).toBe(expected);
        },
      ),
      fcParams(),
    );
  });
});
