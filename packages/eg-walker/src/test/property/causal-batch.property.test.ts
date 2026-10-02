import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { createCausalEventBatchBuilder } from "../../core/causal-event-batch";
import { EgWalkerReplica } from "../../core/replica";
import { EventGraph } from "../../graph/event-graph";
import type { GraphEvent } from "../../types";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

describe("property: strict causal batches", () => {
  it("should always match detailed delivery for a topological trace", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 1,
          maxStepsPerReplica: 4,
        }),
        (params) => {
          // Arrange
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);
          const events = EventGraph.fromEvents(
            trace.events,
          ).getTopologicalOrder();
          const detailed = new EgWalkerReplica("detailed", params.initialText);
          const causal = new EgWalkerReplica("causal", params.initialText);

          // Act
          detailed.applyRemoteEvents(events);
          causal.applyCausalBatch(toCausalBatch(events));

          // Assert
          expect(causal.getPendingRemoteCount()).toBe(0);
          expect(causal.getText()).toBe(detailed.getText());
          expect(canonicalGraph(causal)).toEqual(canonicalGraph(detailed));
        },
      ),
      fcParams(),
    );
  });

  it(
    "should always match one whole batch when the trace arrives in consecutive batches",
    {
      // Each run also replays every batch's prefix as one batch; under
      // coverage instrumentation the default run count needs longer than the
      // default per-test timeout.
      timeout: 60_000,
    },
    () => {
      fc.assert(
        fc.property(
          traceParamsArb({}),
          fc.array(fc.nat()),
          (params, cutSeeds) => {
            // Arrange
            const events = EventGraph.fromEvents(
              runTrace(params).events,
            ).getTopologicalOrder();
            const ends = batchEnds(cutSeeds, events.length);
            const batched = new EgWalkerReplica("batched", params.initialText);

            // Act
            const texts = ends.map((end, index) => {
              batched.applyCausalBatch(
                toCausalBatch(events.slice(ends[index - 1] ?? 0, end)),
              );
              return batched.getText();
            });

            // Assert
            expect(texts).toEqual(
              ends.map((end) =>
                wholeBatchText(params.initialText, events.slice(0, end)),
              ),
            );
          },
        ),
        fcParams(),
      );
    },
  );
});

// Helpers

/** Ascending ends of consecutive batches that cover `count` events. */
const batchEnds = (
  seeds: ReadonlyArray<number>,
  count: number,
): ReadonlyArray<number> =>
  count === 0
    ? []
    : [...new Set([...seeds.map((seed) => 1 + (seed % count)), count])].sort(
        (left, right) => left - right,
      );

const wholeBatchText = (
  initialText: string,
  events: ReadonlyArray<GraphEvent>,
): string => {
  const replica = new EgWalkerReplica("whole", initialText);
  replica.applyCausalBatch(toCausalBatch(events));
  return replica.getText();
};

const toCausalBatch = (events: ReadonlyArray<GraphEvent>) => {
  const builder = createCausalEventBatchBuilder(events.length);
  for (const event of events) {
    if (event.operation.type === OPERATION_TYPE.INSERT) {
      builder.appendInsert(
        event.id,
        event.parentVersion,
        event.operation.index,
        event.operation.text,
        event.timestamp,
      );
    } else {
      builder.appendDelete(
        event.id,
        event.parentVersion,
        event.operation.index,
        event.operation.length,
        event.timestamp,
      );
    }
  }
  return builder.finish();
};

const canonicalGraph = (
  replica: EgWalkerReplica,
): ReadonlyArray<{
  readonly id: string;
  readonly parents: ReadonlyArray<string>;
  readonly operation: GraphEvent["operation"];
}> =>
  replica
    .exportEventGraph()
    .map((event) => ({
      id: event.id,
      parents: [...event.parentVersion].sort(),
      operation: event.operation,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
