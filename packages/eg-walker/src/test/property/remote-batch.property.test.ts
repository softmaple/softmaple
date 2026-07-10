import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerReplica } from "../../core/replica";
import { cloneEvent } from "../test-helpers";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { shuffleWithSeed } from "./shuffle";
import { runTrace } from "./trace-runner";

describe("property: atomic remote batches", () => {
  it("matches successful single-event causal delivery", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          traceParamsArb({
            minReplicas: 2,
            maxReplicas: 3,
            minStepsPerReplica: 1,
            maxStepsPerReplica: 4,
          }),
          fc.integer({ min: 0, max: 0x7fff_ffff }),
        ),
        ([params, seed]) => {
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);
          const delivery = shuffleWithSeed(trace.events, seed).map(cloneEvent);
          const sequential = new EgWalkerReplica(
            "sequential",
            params.initialText,
          );
          for (const event of delivery) {
            sequential.applyRemoteEvent(cloneEvent(event));
          }
          const batched = new EgWalkerReplica("batched", params.initialText);

          const result = batched.applyRemoteEvents(delivery);

          expect(result.results).toHaveLength(delivery.length);
          expect(batched.getPendingRemoteCount()).toBe(0);
          expect(batched.getText()).toBe(sequential.getText());
          expect(batched.exportEventGraph()).toHaveLength(
            sequential.exportEventGraph().length,
          );
        },
      ),
      fcParams(),
    );
  });
});
