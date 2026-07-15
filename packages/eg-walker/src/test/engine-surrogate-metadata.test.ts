import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent } from "../types";

describe("EgWalkerEngine surrogate metadata", () => {
  it("keeps boundary checks enabled for hidden records restored from a snapshot", () => {
    const insert: GraphEvent = {
      id: "alice:0",
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: "🙂",
      },
      timestamp: 0,
    };
    const remove: GraphEvent = {
      id: "alice:1",
      parentVersion: new Set([insert.id]),
      operation: {
        type: OPERATION_TYPE.DELETE,
        index: 0,
        length: 2,
      },
      timestamp: 1,
    };
    const graph = EventGraph.fromEvents([insert, remove]);
    const source = new EgWalkerEngine();
    source.generate([insert, remove], "", { eventGraph: graph });
    expect(source.getText()).toBe("");

    const splitScalar: GraphEvent = {
      id: "bob:0",
      parentVersion: new Set([insert.id]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 1,
        text: "x",
      },
      timestamp: 2,
    };
    graph.addEvent(splitScalar);
    const restored = EgWalkerEngine.fromSnapshotState({
      graph,
      currentVersion: new Set([remove.id]),
      text: "",
      sequenceRecords: source.getSequenceRecords(),
      deleteTargets: source.getDeleteTargetRecords(),
    });

    expect(() => restored.applyEvent(splitScalar, graph)).toThrow(
      /splits a Unicode scalar/,
    );
  });

  it("preserves hidden checkpoint surrogate boundaries through segmented restore", () => {
    const deletes: GraphEvent[] = Array.from({ length: 64 }, (_, index) => ({
      id: `delete:${index}`,
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.DELETE,
        index: 1,
        length: 2,
      },
      timestamp: index,
    }));
    const createPair = () => {
      const graph = EventGraph.fromEvents(deletes);
      const live = new EgWalkerEngine();
      live.generate(deletes, "A🙂B", {
        eventGraph: graph,
        eventOrder: deletes,
        collectTransformedOperations: false,
      });
      const restored = EgWalkerEngine.fromSnapshotState({
        graph,
        currentVersion: live.getCurrentVersion(),
        text: live.getText(),
        sequenceRecords: live.getSequenceRecords(),
        deleteTargets: live.getDeleteTargetRecords(),
      });
      return { graph, live, restored };
    };

    const invalid = createPair();
    const splitScalar: GraphEvent = {
      id: "split-scalar",
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 2,
        text: "x",
      },
      timestamp: deletes.length,
    };
    invalid.graph.addEvent(splitScalar);
    expect(() => invalid.live.applyEvent(splitScalar, invalid.graph)).toThrow(
      /splits a Unicode scalar/,
    );
    expect(() =>
      invalid.restored.applyEvent(splitScalar, invalid.graph),
    ).toThrow(/splits a Unicode scalar/);

    const valid = createPair();
    const insertAfterScalar: GraphEvent = {
      id: "after-scalar",
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 3,
        text: "x",
      },
      timestamp: deletes.length,
    };
    valid.graph.addEvent(insertAfterScalar);
    const liveApplied = valid.live.applyEvent(insertAfterScalar, valid.graph);
    const restoredApplied = valid.restored.applyEvent(
      insertAfterScalar,
      valid.graph,
    );

    expect(liveApplied.text).toBe("AxB");
    expect(restoredApplied.text).toBe(liveApplied.text);
    expect(restoredApplied.transformedOperations).toEqual(
      liveApplied.transformedOperations,
    );
    expect(valid.restored.getSequenceRecords()).toEqual(
      valid.live.getSequenceRecords(),
    );
    expect(valid.restored.getDeleteTargetRecords()).toEqual(
      valid.live.getDeleteTargetRecords(),
    );
  });
});
