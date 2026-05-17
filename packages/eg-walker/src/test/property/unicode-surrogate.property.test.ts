/**
 * Property: inserts and deletes that span UTF-16 surrogate pairs
 * respect the invariants enforced by `core/invariants.ts` —
 * specifically `assertWellFormedUtf16`. Every replica's text must
 * remain well-formed UTF-16, and every delivery permutation must
 * converge.
 *
 * The trace generator biases insert payloads toward non-BMP code
 * points so paired surrogates are exercised frequently.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { cloneEvent } from "../test-helpers";
import { surrogateBiasedTextArb, traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { shuffleWithSeed } from "./shuffle";
import { runTrace } from "./trace-runner";
import { wellFormedUtf16 } from "./utf16";

describe("property: UTF-16 surrogate well-formedness", () => {
  it("surrogate-biased traces stay well-formed across replicas", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 5,
          textArb: surrogateBiasedTextArb(),
          // Empty seed only: a surrogate-pair seed is exercised by
          // the dedicated `convergence-property.test.ts` cases.
          seedTextArb: fc.constant(""),
        }),
        fc.integer({ min: 0, max: 0x7fff_ffff }),
        (params, permutationSeed) => {
          const trace = runTrace(params);
          expect(wellFormedUtf16(trace.canonicalText)).toBe(true);
          for (const text of trace.finalTextPerReplica.values()) {
            expect(wellFormedUtf16(text)).toBe(true);
            expect(text).toBe(trace.canonicalText);
          }

          // Replay under a random delivery permutation — UTF-16
          // well-formedness must be preserved regardless of the order
          // events arrive.
          const shuffled = shuffleWithSeed(trace.events, permutationSeed);
          const replica = new EgWalkerReplica("surrogate");
          for (const event of shuffled) {
            replica.applyRemoteEvent(cloneEvent(event));
          }
          expect(replica.getPendingRemoteCount()).toBe(0);
          expect(replica.getText()).toBe(trace.canonicalText);
          expect(wellFormedUtf16(replica.getText())).toBe(true);
        },
      ),
      fcParams(),
    );
  });
});
