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
import { runTrace } from "./trace-runner";

describe("property: convergence under randomized delivery", () => {
  it("every shuffled delivery order matches the canonical replay text", () => {
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
  });
});

/**
 * Fisher–Yates shuffle keyed on a 32-bit seed via the same LCG used in
 * `test-helpers.ts`. We do not reuse `createPrng` directly because the
 * inputs here come from fast-check's shrinkable integers, and binding
 * the helper inline keeps the shuffle reproducible from the shrunk
 * inputs alone.
 */
const shuffleWithSeed = <T>(items: ReadonlyArray<T>, seed: number): T[] => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
};
