/**
 * Property: when `EgWalkerReplica.applyRemoteEvent` can attribute a single
 * position operation to an integrated event, that operation must describe
 * the visible text change from the pre-event document to the post-event
 * document.
 *
 * The public result intentionally reports insert length rather than inserted
 * text, because awareness consumers remap selections by position. These
 * assertions therefore check the structural splice contract instead of
 * reconstructing inserted content.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { EgWalkerReplica } from "../../core/replica";
import { EventGraph } from "../../graph/event-graph";
import { APPLY_REMOTE_EVENT_STATUS, type PositionOperation } from "../../types";
import { cloneEvent } from "../test-helpers";
import { traceParamsArb } from "./arbitraries";
import { fcParams } from "./run-config";
import { runTrace } from "./trace-runner";

describe("property: applyRemoteEvent position operation contract", () => {
  it("describes the visible splice whenever a single operation is reported", () => {
    fc.assert(
      fc.property(
        traceParamsArb({
          minReplicas: 2,
          maxReplicas: 3,
          minStepsPerReplica: 2,
          maxStepsPerReplica: 6,
          deleteWeight: 5,
        }),
        (params) => {
          const trace = runTrace(params);
          fc.pre(trace.appliedEdits > 0);

          const graph = new EventGraph();
          for (const event of trace.events.map(cloneEvent)) {
            graph.addEvent(event);
          }

          const replica = new EgWalkerReplica("contract", params.initialText);
          for (const event of graph.getTopologicalOrder()) {
            const before = replica.getText();
            const result = replica.applyRemoteEvent(cloneEvent(event));
            const after = replica.getText();

            expect(result.status).toBe(APPLY_REMOTE_EVENT_STATUS.Integrated);
            if (result.status !== APPLY_REMOTE_EVENT_STATUS.Integrated) {
              continue;
            }
            if (result.operation === null) {
              continue;
            }
            expectPositionOperationToDescribeChange(
              result.operation,
              before,
              after,
            );
          }

          expect(replica.getText()).toBe(trace.canonicalText);
        },
      ),
      fcParams(),
    );
  });
});

// Helpers

const expectPositionOperationToDescribeChange = (
  operation: PositionOperation,
  before: string,
  after: string,
): void => {
  if (operation.type === OPERATION_TYPE.INSERT) {
    expect(operation.index).toBeGreaterThanOrEqual(0);
    expect(operation.index).toBeLessThanOrEqual(before.length);
    expect(operation.length).toBeGreaterThan(0);
    expect(after.length).toBe(before.length + operation.length);
    expect(after.slice(0, operation.index)).toBe(
      before.slice(0, operation.index),
    );
    expect(after.slice(operation.index + operation.length)).toBe(
      before.slice(operation.index),
    );
    return;
  }

  expect(operation.index).toBeGreaterThanOrEqual(0);
  expect(operation.index + operation.length).toBeLessThanOrEqual(before.length);
  expect(operation.length).toBeGreaterThan(0);
  expect(after).toBe(
    before.slice(0, operation.index) +
      before.slice(operation.index + operation.length),
  );
};
