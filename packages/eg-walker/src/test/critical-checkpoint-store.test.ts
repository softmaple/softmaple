import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { CriticalCheckpointStore } from "../core/internals/critical-checkpoint-store";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

const insertEvent = (
  id: EventId,
  parentVersion: ReadonlySet<EventId>,
  index: number,
): GraphEvent => ({
  id,
  parentVersion,
  operation: { type: OPERATION_TYPE.INSERT, index, text: "x" },
  timestamp: index,
});

const appendLinearSuffix = (
  graph: EventGraph,
  parentId: EventId,
  start: number,
  count: number,
): EventId => {
  let parent = parentId;
  for (let offset = 0; offset < count; offset++) {
    const sequence = start + offset;
    const id = `alice:${sequence}`;
    graph.addEvent(insertEvent(id, new Set([parent]), sequence));
    parent = id;
  }
  return parent;
};

describe("CriticalCheckpointStore incremental validation", () => {
  it("checks each descendant suffix without a graph-wide child BFS", () => {
    const graph = new EventGraph();
    graph.addEvent(insertEvent("alice:0", new Set(), 0));
    const checkpoints = new CriticalCheckpointStore(
      new CriticalVersionAnalyzer(),
    );
    const checkpoint = checkpoints.record(
      new Set(["alice:0"]),
      "x",
      graph.getEventCount(),
    );
    const firstTip = appendLinearSuffix(graph, "alice:0", 1, 1_024);
    const iterateChildren = vi.spyOn(graph, "iterateChildren");
    const validateSuffix = vi.spyOn(graph, "isInsertionSuffixDominatedBy");

    expect(checkpoints.pickFor(graph)).toBe(checkpoint);
    expect(iterateChildren).not.toHaveBeenCalled();
    expect(validateSuffix).toHaveBeenLastCalledWith(new Set(["alice:0"]), 1, 1);
    expect(
      checkpoints.snapshotForTransaction().checkpoints[0]
        ?.criticalityValidation,
    ).toEqual({
      validatedEventCount: graph.getEventCount(),
      invalid: false,
      requiresFullValidation: false,
    });

    appendLinearSuffix(graph, firstTip, 1_025, 256);
    expect(checkpoints.pickFor(graph)).toBe(checkpoint);
    expect(iterateChildren).not.toHaveBeenCalled();
    expect(validateSuffix).toHaveBeenLastCalledWith(
      new Set(["alice:0"]),
      1,
      1_025,
    );
    expect(
      checkpoints.snapshotForTransaction().checkpoints[0]?.criticalityValidation
        ?.validatedEventCount,
    ).toBe(graph.getEventCount());
  });

  it("permanently rejects a checkpoint after the first concurrent root", () => {
    const graph = new EventGraph();
    graph.addEvent(insertEvent("alice:0", new Set(), 0));
    const checkpoints = new CriticalCheckpointStore(
      new CriticalVersionAnalyzer(),
    );
    checkpoints.record(new Set(["alice:0"]), "x", 1);
    graph.addEvent(insertEvent("bob:0", new Set(), 0));
    graph.addEvent(insertEvent("merge:0", new Set(["alice:0", "bob:0"]), 2));
    const iterateChildren = vi.spyOn(graph, "iterateChildren");
    const validateSuffix = vi.spyOn(graph, "isInsertionSuffixDominatedBy");

    expect(checkpoints.pickFor(graph)).toBeNull();
    expect(
      checkpoints.snapshotForTransaction().checkpoints[0]?.criticalityValidation
        ?.invalid,
    ).toBe(true);

    appendLinearSuffix(graph, "merge:0", 3, 128);
    expect(checkpoints.pickFor(graph)).toBeNull();
    expect(iterateChildren).not.toHaveBeenCalled();
    expect(validateSuffix).toHaveBeenCalledTimes(1);
  });

  it("restores validation state together with a rolled-back graph append", () => {
    const graph = new EventGraph();
    graph.addEvent(insertEvent("alice:0", new Set(), 0));
    const checkpoints = new CriticalCheckpointStore(
      new CriticalVersionAnalyzer(),
    );
    checkpoints.record(new Set(["alice:0"]), "x", 1);
    const checkpointSnapshot = checkpoints.snapshotForTransaction();
    const graphTransaction = graph.beginAppendTransaction();

    graph.addEvent(insertEvent("bob:0", new Set(), 0));
    expect(checkpoints.pickFor(graph)).toBeNull();
    graphTransaction.rollback();
    checkpoints.restoreTransaction(checkpointSnapshot);

    graph.addEvent(insertEvent("alice:1", new Set(["alice:0"]), 1));
    expect(checkpoints.pickFor(graph)?.version).toEqual(new Set(["alice:0"]));
    expect(
      checkpoints.snapshotForTransaction().checkpoints[0]
        ?.criticalityValidation,
    ).toEqual({
      validatedEventCount: 2,
      invalid: false,
      requiresFullValidation: false,
    });
  });

  it("accepts redundant multi-parent links when one parent is dominated", () => {
    const graph = new EventGraph();
    graph.addEvent(insertEvent("root:0", new Set(), 0));
    graph.addEvent(insertEvent("alice:0", new Set(["root:0"]), 1));
    const checkpoints = new CriticalCheckpointStore(
      new CriticalVersionAnalyzer(),
    );
    const checkpoint = checkpoints.record(new Set(["alice:0"]), "xx", 2);

    graph.addEvent(insertEvent("alice:1", new Set(["root:0", "alice:0"]), 2));
    graph.addEvent(insertEvent("alice:2", new Set(["root:0", "alice:1"]), 3));

    expect(checkpoints.pickFor(graph)).toBe(checkpoint);
  });

  it("validates restored checkpoints directly over packed parent offsets", () => {
    const source = new EventGraph();
    source.addEvent(insertEvent("alice:0", new Set(), 0));
    appendLinearSuffix(source, "alice:0", 1, 63);
    const codec = new ColumnarEventGraphCodec();
    const packed = codec.decodeBinary(codec.encodeBinary(source));
    const checkpoints = new CriticalCheckpointStore(
      new CriticalVersionAnalyzer(),
    );
    checkpoints.restore([
      {
        version: ["alice:31"],
        text: "x".repeat(32),
        eventCount: 32,
      },
    ]);
    const iterateChildren = vi.spyOn(packed, "iterateChildren");
    const analyzer = vi.spyOn(CriticalVersionAnalyzer.prototype, "isCritical");

    expect(checkpoints.pickFor(packed)?.version).toEqual(new Set(["alice:31"]));
    expect(analyzer).not.toHaveBeenCalled();
    expect(iterateChildren).not.toHaveBeenCalled();
    expect(checkpoints.pickFor(packed)?.version).toEqual(new Set(["alice:31"]));
    expect(analyzer).not.toHaveBeenCalled();
    expect(iterateChildren).not.toHaveBeenCalled();
    expect(
      checkpoints.snapshotForTransaction().checkpoints[0]?.criticalityValidation
        ?.validatedEventCount,
    ).toBe(64);
    expect(checkpoints.toSnapshot()[0]).not.toHaveProperty(
      "criticalityValidation",
    );
  });

  it("validates a canonical multi-frontier cut incrementally", () => {
    const graph = new EventGraph();
    graph.addEvent(insertEvent("root:0", new Set(), 0));
    graph.addEvent(insertEvent("left:0", new Set(["root:0"]), 1));
    graph.addEvent(insertEvent("right:0", new Set(["root:0"]), 1));
    const checkpoints = new CriticalCheckpointStore(
      new CriticalVersionAnalyzer(),
    );
    const version = new Set(["left:0", "right:0"]);
    const checkpoint = checkpoints.record(version, "xxx", 3);

    graph.addEvent(insertEvent("merge:0", new Set(["left:0", "right:0"]), 3));
    graph.addEvent(insertEvent("merge:1", new Set(["merge:0"]), 4));
    expect(checkpoints.pickFor(graph)).toBe(checkpoint);

    graph.addEvent(insertEvent("left:1", new Set(["left:0"]), 5));
    expect(checkpoints.pickFor(graph)).toBeNull();
    graph.addEvent(insertEvent("merge:2", new Set(["merge:1", "left:1"]), 6));
    expect(checkpoints.pickFor(graph)).toBeNull();
  });

  it("rejects a restored checkpoint whose cut is not its ancestor closure", () => {
    const graph = new EventGraph();
    graph.addEvent(insertEvent("alice:0", new Set(), 0));
    graph.addEvent(insertEvent("bob:0", new Set(), 0));
    graph.addEvent(insertEvent("bob:1", new Set(["bob:0"]), 1));
    const checkpoints = new CriticalCheckpointStore(
      new CriticalVersionAnalyzer(),
    );
    checkpoints.restore([
      {
        version: ["bob:0"],
        text: "x",
        eventCount: 2,
      },
    ]);

    expect(checkpoints.pickFor(graph)).toBeNull();
    expect(
      checkpoints.snapshotForTransaction().checkpoints[0]
        ?.criticalityValidation,
    ).toMatchObject({
      invalid: true,
      requiresFullValidation: true,
    });
  });

  it("starts planner-proven checkpoints at the validated graph cursor", () => {
    const graph = new EventGraph();
    graph.addEvent(insertEvent("alice:0", new Set(), 0));
    appendLinearSuffix(graph, "alice:0", 1, 255);
    const checkpoints = new CriticalCheckpointStore(
      new CriticalVersionAnalyzer(),
    );
    const validateSuffix = vi.spyOn(graph, "isInsertionSuffixDominatedBy");
    checkpoints.record(new Set(["alice:31"]), "x".repeat(32), 32, 256);

    expect(checkpoints.pickFor(graph)?.version).toEqual(new Set(["alice:31"]));
    expect(validateSuffix).toHaveBeenCalledWith(new Set(["alice:31"]), 32, 256);
  });
});
