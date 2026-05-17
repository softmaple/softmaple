/**
 * Property: for a *fixed* event set, the final replica text is
 * invariant under every shuffled delivery permutation. Pins the trace
 * and varies only the delivery permutation, exercising the
 * `RemoteEventBuffer` flushing path in isolation from trace generation.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { cloneEvent } from "../test-helpers";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { shuffleWithSeed } from "./shuffle";
import { runTrace } from "./trace-runner";

describe("property: delivery-order invariance for a fixed event set", () => {
  it("every permutation of the same event set yields the same final text", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          traceParamsArb({
            minReplicas: 2,
            maxReplicas: 3,
            minStepsPerReplica: 2,
            maxStepsPerReplica: 5,
          }),
          fc.integer({ min: 0, max: 0x7fff_ffff }),
        ),
        ([params, permutationSeed]) => {
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);

          const shuffled = shuffleWithSeed(trace.events, permutationSeed);
          const replica = new EgWalkerReplica("perm", params.initialText);
          for (const event of shuffled) {
            replica.applyRemoteEvent(cloneEvent(event));
          }
          expect(replica.getPendingRemoteCount()).toBe(0);
          expect(replica.getText()).toBe(trace.canonicalText);
        },
      ),
      fcParams(),
    );
  });
});
