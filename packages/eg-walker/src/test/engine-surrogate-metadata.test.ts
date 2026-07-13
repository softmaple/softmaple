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
});
