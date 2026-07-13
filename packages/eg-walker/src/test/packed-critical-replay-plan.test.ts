import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { planCriticalReplaySections } from "../engine/critical-section-replay-plan";
import { planPackedCriticalReplaySections } from "../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import type { EventId, ExternalOperation, GraphEvent, Version } from "../types";

const event = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  timestamp: number,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: id },
  parentVersion: new Set(parents),
  timestamp,
});

const editingEvent = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  operation: ExternalOperation,
  timestamp: number,
): GraphEvent => ({
  id,
  operation,
  parentVersion: new Set(parents),
  timestamp,
});

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

const versionsEqual = (
  left: ReadonlySet<EventId>,
  right: ReadonlySet<EventId>,
): boolean =>
  left.size === right.size && Array.from(left).every((id) => right.has(id));

const isLinear = (
  events: ReadonlyArray<GraphEvent>,
  base: Version,
): boolean => {
  const first = events[0];
  if (first === undefined) return true;
  if (!versionsEqual(first.parentVersion, base)) return false;
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (
      current.parentVersion.size !== 1 ||
      !current.parentVersion.has(previous.id)
    ) {
      return false;
    }
  }
  return true;
};

describe("packed critical-section replay planning", () => {
  it("matches the general planner without materialising a full event order", () => {
    const graph = pack([
      event("root", [], 0),
      event("a:0", ["root"], 1),
      event("a:1", ["a:0"], 2),
      event("b:0", ["root"], 3),
      event("b:1", ["b:0"], 4),
      event("merge", ["a:1", "b:1"], 5),
      event("tail", ["merge"], 6),
    ]);
    const materializedOrder = vi.spyOn(
      graph,
      "getBranchPreservingTopologicalOrder",
    );

    const compact = planPackedCriticalReplaySections(graph);

    expect(compact).not.toBeNull();
    expect(materializedOrder).not.toHaveBeenCalled();

    const expected = planCriticalReplaySections(graph);
    expect(compact!.sectionCount).toBe(expected.length);
    for (let sectionIndex = 0; sectionIndex < expected.length; sectionIndex++) {
      const actualEvents = compact!.materializeSection(sectionIndex);
      expect(actualEvents.map(({ id }) => id)).toEqual(
        expected[sectionIndex]!.events.map(({ id }) => id),
      );
      expect(compact!.isLinearSection(sectionIndex)).toBe(
        isLinear(
          expected[sectionIndex]!.events,
          expected[sectionIndex]!.baseFrontier,
        ),
      );
    }
  });

  it("stores a long post-merge tail as numeric singleton cuts", () => {
    const events: GraphEvent[] = [
      event("root", [], 0),
      event("a", ["root"], 1),
      event("b", ["root"], 2),
      event("merge", ["a", "b"], 3),
    ];
    let parent = "merge";
    for (let index = 0; index < 2_000; index++) {
      const id = `tail:${index}`;
      events.push(event(id, [parent], index + 4));
      parent = id;
    }

    const compact = planPackedCriticalReplaySections(pack(events));

    expect(compact).not.toBeNull();
    expect(compact!.eventCount).toBe(events.length);
    expect(compact!.sectionCount).toBe(2_003);
    expect(compact!.isLinearSection(0)).toBe(true);
    expect(compact!.isLinearSection(1)).toBe(false);
    expect(compact!.isLinearSection(compact!.sectionCount - 1)).toBe(true);
    expect(
      compact!
        .materializeSection(compact!.sectionCount - 1)
        .map(({ id }) => id),
    ).toEqual(["tail:1999"]);
  });

  it("preserves document, frontier, checkpoints, and engine stats in cold replay", () => {
    const events = [
      editingEvent(
        "replica:0",
        [],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "abcd" },
        0,
      ),
      editingEvent(
        "custom-a",
        ["replica:0"],
        { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
        1,
      ),
      editingEvent(
        "replica:1",
        ["custom-a"],
        { type: OPERATION_TYPE.INSERT, index: 1, text: "Y" },
        2,
      ),
      editingEvent(
        "other:0",
        ["replica:0"],
        { type: OPERATION_TYPE.INSERT, index: 4, text: "X" },
        3,
      ),
      editingEvent(
        "merge-id",
        ["replica:1", "other:0"],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "M" },
        4,
      ),
      editingEvent(
        "tail-id",
        ["merge-id"],
        { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
        5,
      ),
    ];
    const packedGraph = pack(events);
    const materializedOrder = vi.spyOn(
      packedGraph,
      "getBranchPreservingTopologicalOrder",
    );
    const objectReplica = new EgWalkerReplica(
      "object",
      "",
      EventGraph.fromEvents(events),
    );
    const packedReplica = new EgWalkerReplica("packed", "", packedGraph);

    expect(materializedOrder).not.toHaveBeenCalled();
    expect(packedReplica.getText()).toBe(objectReplica.getText());
    expect([...packedReplica.serialize().eventGraph.version].sort()).toEqual(
      [...objectReplica.serialize().eventGraph.version].sort(),
    );
    expect(packedReplica.getReplayStats()).toEqual(
      objectReplica.getReplayStats(),
    );
  });

  it("streams obsolete linear cuts from packed operation columns", () => {
    const events: GraphEvent[] = [
      editingEvent(
        "root:0",
        [],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "abcd" },
        0,
      ),
      editingEvent(
        "left:0",
        ["root:0"],
        { type: OPERATION_TYPE.INSERT, index: 4, text: "L" },
        1,
      ),
      editingEvent(
        "right:0",
        ["root:0"],
        { type: OPERATION_TYPE.INSERT, index: 4, text: "R" },
        2,
      ),
      editingEvent(
        "merge:0",
        ["left:0", "right:0"],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "M" },
        3,
      ),
    ];

    let parent = "merge:0";
    let documentLength = 7;
    const tailOperations: ExternalOperation[] = [
      { type: OPERATION_TYPE.INSERT, index: 7, text: "x" },
      { type: OPERATION_TYPE.INSERT, index: 8, text: "y" },
      { type: OPERATION_TYPE.DELETE, index: 7, length: 1 },
      { type: OPERATION_TYPE.DELETE, index: 7, length: 1 },
    ];
    for (let index = tailOperations.length; index < 50; index++) {
      tailOperations.push({
        type: OPERATION_TYPE.INSERT,
        index: documentLength,
        text: String.fromCharCode(97 + (index % 26)),
      });
      documentLength++;
    }

    for (let index = 0; index < tailOperations.length; index++) {
      const id = `tail:${index}`;
      events.push(
        editingEvent(id, [parent], tailOperations[index]!, index + 4),
      );
      parent = id;
    }

    const packedGraph = pack(events);
    const materializedOrder = vi.spyOn(
      packedGraph,
      "getBranchPreservingTopologicalOrder",
    );
    const objectReplica = new EgWalkerReplica(
      "object-tail",
      "",
      EventGraph.fromEvents(events),
    );
    const packedReplica = new EgWalkerReplica("packed-tail", "", packedGraph);

    expect(materializedOrder).not.toHaveBeenCalled();
    expect(packedReplica.getText()).toBe(objectReplica.getText());
    expect(packedReplica.getReplayStats()).toEqual(
      objectReplica.getReplayStats(),
    );
  });

  it("collapses exact packed chains and handles empty packed graphs", () => {
    const linear = planPackedCriticalReplaySections(
      pack([
        event("r:0", [], 0),
        event("r:1", ["r:0"], 1),
        event("r:2", ["r:1"], 2),
      ]),
    );
    expect(linear?.sectionCount).toBe(1);
    expect(linear?.sectionEventCountAt(0)).toBe(3);
    expect(linear?.isLinearSection(0)).toBe(true);

    const empty = planPackedCriticalReplaySections(pack([]));
    expect(empty?.eventCount).toBe(0);
    expect(empty?.sectionCount).toBe(0);
  });
});
