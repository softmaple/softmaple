/**
 * Property: for any randomly generated multi-replica trace, every
 * replica that observes the full event set converges to the same text
 * as the canonical (topological) replay — regardless of the order in
 * which the events arrive over the wire.
 *
 * Complements the seed-based `convergence-property.test.ts` with
 * fast-check shrinking: a failing case reduces to a minimal trace plus
 * a minimal delivery permutation, rather than landing as an opaque
 * seed.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { cloneEvent } from "../test-helpers";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { shuffleWithSeed } from "./shuffle";
import { runTrace } from "./trace-runner";

describe("property: convergence under randomized delivery", () => {
  it("every shuffled delivery order matches the canonical replay text", () => {
    // This performs 1,000 generated traces with three delivery permutations
    // each. V8 coverage and shared CI runners can exceed Vitest's default 5s
    // ceiling, so retain the full sweep with an explicit timeout backstop.
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 4,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 6,
        }),
        // Three independent permutations per generated trace so the
        // outer fast-check loop is not the only source of delivery
        // diversity.
        fc.array(fc.integer({ min: 0, max: 0x7fff_ffff }), {
          minLength: 3,
          maxLength: 3,
        }),
        (params, permutationSeeds) => {
          const trace = runTrace(params);
          // Every live replica must already agree with the canonical
          // text — this is the multi-replica convergence claim.
          for (const finalText of trace.finalTextPerReplica.values()) {
            expect(finalText).toBe(trace.canonicalText);
          }

          // Now replay the *same* event set into fresh replicas in
          // distinct random orders. Every replay must converge.
          for (let trial = 0; trial < permutationSeeds.length; trial++) {
            const seed = permutationSeeds[trial]!;
            const shuffled = shuffleWithSeed(trace.events, seed);
            const replica = new EgWalkerReplica(
              `verify-${trial}`,
              params.initialText,
            );
            for (const event of shuffled) {
              replica.applyRemoteEvent(cloneEvent(event));
            }
            expect(replica.getPendingRemoteCount()).toBe(0);
            expect(replica.getText()).toBe(trace.canonicalText);
          }
        },
      ),
      fcParams(),
    );
  }, 15_000);
});
