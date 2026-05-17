/**
 * Property: for a *fixed* event set, the final replica text is
 * invariant under every shuffled delivery permutation. Pins the trace
 * and varies only the delivery permutation, exercising the
 * `RemoteEventBuffer` flushing path in isolation from trace generation.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import type { GraphEvent } from "../../types";
import { cloneEvent } from "../test-helpers";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

const eventPermutationArb = (
  events: ReadonlyArray<GraphEvent>,
): fc.Arbitrary<ReadonlyArray<number>> =>
  fc
    .uniqueArray(fc.integer({ min: 0, max: events.length - 1 }), {
      minLength: events.length,
      maxLength: events.length,
    })
    .filter((indices) => indices.length === events.length);

describe("property: delivery-order invariance for a fixed event set", () => {
  it("every permutation of the same event set yields the same final text", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 5,
        }),
        (params) => {
          const trace = runTrace(params);
          if (trace.events.length === 0) {
            return;
          }
          // Inner property: across N permutations, every delivered
          // replica must end at the canonical text. Using an inner
          // `fc.assert` lets fast-check shrink the permutation
          // independently of the trace.
          fc.assert(
            fc.property(eventPermutationArb(trace.events), (perm) => {
              const replica = new EgWalkerReplica("perm", params.initialText);
              for (const idx of perm) {
                replica.applyRemoteEvent(cloneEvent(trace.events[idx]!));
              }
              expect(replica.getPendingRemoteCount()).toBe(0);
              expect(replica.getText()).toBe(trace.canonicalText);
            }),
            // Inner runs are cheap — every permutation just feeds the
            // existing event list through a fresh replica. Cap at 8
            // so the outer fast-check budget is not spent here.
            { numRuns: 8 },
          );
        },
      ),
      fcParams(),
    );
  });
});
