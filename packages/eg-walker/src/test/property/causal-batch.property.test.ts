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
});

// Helpers

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
