import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerEngine } from "../../engine/eg-walker-engine";
import { EventGraph } from "../../graph/event-graph";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

describe("property: deferred cold-replay text materialization", () => {
  it("should match eager replay for every generated concurrent trace", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 5,
        }),
        (params) => {
          // Arrange
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);
          const graph = EventGraph.fromEvents(trace.events);
          const eventOrder = graph.getBranchPreservingTopologicalOrder();

          // Act
          const eagerEngine = new EgWalkerEngine();
          const eager = eagerEngine.generate(eventOrder, params.initialText, {
            eventGraph: graph,
            eventOrder,
          });
          const deferredEngine = new EgWalkerEngine();
          const deferred = deferredEngine.generate(
            eventOrder,
            params.initialText,
            {
              eventGraph: graph,
              eventOrder,
              collectTransformedOperations: false,
            },
          );

          // Assert
          expect(deferred.text).toBe(eager.text);
          expect(deferred.text).toBe(trace.canonicalText);
          expect(deferredEngine.getCurrentVersion()).toEqual(
            eagerEngine.getCurrentVersion(),
          );
          expect(deferredEngine.getSequenceRecords()).toEqual(
            eagerEngine.getSequenceRecords(),
          );
          expect(deferredEngine.getDeleteTargetRecords()).toEqual(
            eagerEngine.getDeleteTargetRecords(),
          );
        },
      ),
      fcParams(),
    );
  });
});
