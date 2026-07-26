import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import type { GraphEvent } from "../types";

describe("EventGraph ownership boundary", () => {
  it("copies accepted events, parent sets, operations, and returned views", () => {
    const graph = new EventGraph();
    const root: GraphEvent = {
      id: "root",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 1,
    };
    graph.addEvent(root);
    const child: GraphEvent = {
      id: "child",
      parentVersion: new Set([root.id]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
      timestamp: 2,
    };
    graph.addEvent(child);
    const expected = graph.serialize();

    (child.parentVersion as Set<string>).clear();
    (child.operation as { text: string }).text = "mutated input";
    const returned = graph.getEvent("child")!;
    (returned.parentVersion as Set<string>).add("mutated output");
    (returned.operation as { text: string }).text = "mutated output";
    const ordered = graph.getTopologicalOrder();
    expect(() => (ordered[1]!.parentVersion as Set<string>).clear()).toThrow(
      /read-only event graph view/,
    );
    (graph.getChildren("root") as Set<string>).clear();
    (graph.getParents("child") as Set<string>).clear();

    expect(graph.serialize()).toEqual(expected);
    expect(graph.getEvent("child")).toMatchObject({
      parentVersion: new Set(["root"]),
      operation: { text: "B" },
    });
  });
});
