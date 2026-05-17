/**
 * Property: applying every event to a replica twice is a no-op. The
 * second application must not throw, must not corrupt state, and the
 * final text must match the single-delivery replica.
 *
 * Verifies the `EventAlreadyExistsError` swallow in
 * `RemoteEventBuffer.tryAccept` and the project's "graceful duplicate
 * handling" pattern documented in `.claude/CLAUDE.md`.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { cloneEvent } from "../test-helpers";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { shuffleWithSeed } from "./shuffle";
import { runTrace } from "./trace-runner";

describe("property: duplicate event delivery is idempotent", () => {
  it("re-applying every event leaves the replica state unchanged", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 5,
        }),
        // Two integer seeds: one picks the duplicate ordering, the
        // other picks the single-delivery baseline ordering. Using
        // fast-check integers keeps the permutations shrinkable.
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        (params, baselineSeed, duplicateSeed) => {
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);

          const baseline = new EgWalkerReplica("baseline", params.initialText);
          for (const event of shuffleWithSeed(trace.events, baselineSeed)) {
            baseline.applyRemoteEvent(cloneEvent(event));
          }
          expect(baseline.getPendingRemoteCount()).toBe(0);
          expect(baseline.getText()).toBe(trace.canonicalText);

          // Now build a duplicate-laden delivery: every event appears
          // twice, interleaved by the duplicate seed.
          const doubled = [...trace.events, ...trace.events];
          const dupReplica = new EgWalkerReplica(
            "duplicates",
            params.initialText,
          );
          for (const event of shuffleWithSeed(doubled, duplicateSeed)) {
            // Must not throw, even for the second arrival.
            dupReplica.applyRemoteEvent(cloneEvent(event));
          }

          expect(dupReplica.getPendingRemoteCount()).toBe(0);
          expect(dupReplica.getText()).toBe(trace.canonicalText);

          // The graph must still contain exactly one record per event
          // id.
          const dupIds = new Set(
            dupReplica.exportEventGraph().map((event) => event.id),
          );
          expect(dupIds.size).toBe(trace.events.length);

          // Sanity: duplicate deliveries should not have inflated the
          // event graph relative to the baseline.
          expect(dupReplica.exportEventGraph().length).toBe(
            baseline.exportEventGraph().length,
          );
        },
      ),
      fcParams(),
    );
  });
});
