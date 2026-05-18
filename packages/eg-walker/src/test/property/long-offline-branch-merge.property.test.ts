/**
 * Property: two replicas that edit independently for many steps and then
 * exchange all events always converge to the same text.
 *
 * "Long offline" is modelled by setting `syncEveryN` large enough that no
 * intermediate sync fires — the trace runner's unconditional final `sync()`
 * is the only exchange point. Any permutation of the full event set must
 * converge to the canonical topological-replay text.
 *
 * Two assertions per run:
 *   1. Both live replicas (post-final-sync via the trace runner) agree with
 *      the canonical text.
 *   2. A fresh replica that receives the same complete event set in a random
 *      permutation also converges to the canonical text. This exercises the
 *      `RemoteEventBuffer` flush path and the partial/full replay selection
 *      logic under a large causal gap.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { cloneEvent } from "../test-helpers";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { shuffleWithSeed } from "./shuffle";
import { runTrace } from "./trace-runner";

describe("property: long offline branch merge converges", () => {
  it("two branches that diverge for many steps converge after full event exchange", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 2,
          minStepsPerReplica: 4,
          maxStepsPerReplica: 10,
          // Large syncEveryN forces no intermediate sync: each replica
          // stays offline for its entire edit sequence. The trace runner's
          // unconditional final sync() is the only exchange.
          syncEveryNArb: fc.constant(10_000),
        }),
        (params) => {
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);

          // Both live replicas must converge after the final sync.
          expect(trace.finalTextPerReplica.size).toBe(2);
          for (const finalText of trace.finalTextPerReplica.values()) {
            expect(finalText).toBe(trace.canonicalText);
          }
        },
      ),
      fcParams(),
    );
  });

  it("a fresh replica that receives the offline event set in random order converges", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 2,
          minStepsPerReplica: 4,
          maxStepsPerReplica: 8,
          syncEveryNArb: fc.constant(10_000),
        }),
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        (params, seed) => {
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);

          const shuffled = shuffleWithSeed(trace.events, seed);
          const replica = new EgWalkerReplica(
            "late-joiner",
            params.initialText,
          );
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
