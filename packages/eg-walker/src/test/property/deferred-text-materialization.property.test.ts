import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EgWalkerEngine } from "../../engine/eg-walker-engine";
import { EventGraph } from "../../graph/event-graph";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

describe("property: deferred cold-replay text materialization", () => {
  it("should keep a new origin-right boundary out of an existing typed run", () => {
    // Arrange
    const params = {
      initialText: "Hello, world!",
      scripts: [
        {
          replicaId: "dave",
          edits: [
            { kind: "insert" as const, offsetSeed: 0, text: " " },
            { kind: "delete" as const, offsetSeed: 0, lengthSeed: 0 },
          ],
        },
        {
          replicaId: "bob",
          edits: [
            { kind: "insert" as const, offsetSeed: 0, text: " " },
            { kind: "insert" as const, offsetSeed: 0, text: "\uE000" },
            // This seed places the insert beside the reserved-marker run,
            // exercising the non-null origin-right boundary.
            { kind: "insert" as const, offsetSeed: 0.0625, text: " " },
          ],
        },
      ],
      syncEveryN: 1,
    };
    const trace = runTrace(params);
    const graph = EventGraph.fromEvents(trace.events);
    const eventOrder = graph.getBranchPreservingTopologicalOrder();

    // Act
    const eagerEngine = new EgWalkerEngine();
    const eager = eagerEngine.generate(eventOrder, params.initialText, {
      eventGraph: graph,
      eventOrder,
    });
    const deferredEngine = new EgWalkerEngine();
    const deferred = deferredEngine.generate(eventOrder, params.initialText, {
      eventGraph: graph,
      eventOrder,
      collectTransformedOperations: false,
    });

    // Assert
    expect(deferred.text).toBe(eager.text);
    expect(deferred.text).toBe(trace.canonicalText);
    expect(deferredEngine.getSequenceRecords()).toEqual(
      eagerEngine.getSequenceRecords(),
    );
  });

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
