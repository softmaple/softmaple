import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { planCriticalReplaySections } from "../engine/critical-section-replay-plan";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { IndexedSequence } from "../engine/indexed-sequence";
import { RecordSplitter } from "../engine/internals/record-splitter";
import { SegmentedPlaceholderState } from "../engine/internals/segmented-placeholder";
import {
  PackedCriticalReplayPlan,
  planPackedCriticalReplaySections,
} from "../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
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
    expect(
      compact!
        .materializeSectionRange(0, compact!.sectionCount)
        .map(({ id }) => id),
    ).toEqual(expected.flatMap(({ events }) => events.map(({ id }) => id)));
  });

  it("replays obsolete nonlinear cuts in bounded engine lifetimes", () => {
    const events: GraphEvent[] = [];
    let parents: EventId[] = [];
    for (let layer = 0; layer < 100; layer++) {
      const left = `left:${layer}`;
      const right = `right:${layer}`;
      events.push(
        editingEvent(
          left,
          parents,
          { type: OPERATION_TYPE.INSERT, index: 0, text: "L" },
          layer * 2,
        ),
        editingEvent(
          right,
          parents,
          { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
          layer * 2 + 1,
        ),
      );
      parents = [left, right];
    }

    const source = EventGraph.fromEvents(events);
    const order = source.getBranchPreservingTopologicalOrder();
    const expected = new EgWalkerEngine().generate(order, "", {
      eventGraph: source,
      eventOrder: order,
    }).text;
    const packedGraph = pack(events);
    const compact = planPackedCriticalReplaySections(packedGraph);
    expect(compact?.sectionCount).toBe(100);
    expect(
      Array.from({ length: compact!.sectionCount }, (_, sectionIndex) =>
        compact!.isLinearSection(sectionIndex),
      ),
    ).not.toContain(true);

    const generate = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRange",
    );
    const materialize = vi.spyOn(
      PackedCriticalReplayPlan.prototype,
      "materializeSectionRange",
    );
    const stringDiff = vi.spyOn(EventGraph.prototype, "diffVersions");
    const replica = new EgWalkerReplica("packed-layers", "", packedGraph);

    expect(replica.getText()).toBe(expected);
    // One bounded engine covers the 68 obsolete cuts; the trailing 32 cuts
    // remain independent so each can still seed a retained checkpoint.
    expect(generate).toHaveBeenCalledTimes(33);
    expect(materialize).not.toHaveBeenCalled();
    expect(stringDiff).not.toHaveBeenCalled();
  });

  it("bridges short linear gaps between obsolete nonlinear cuts", () => {
    const events: GraphEvent[] = [];
    let parents: EventId[] = [];
    for (let layer = 0; layer < 100; layer++) {
      const left = `left:${layer}`;
      const right = `right:${layer}`;
      const merge = `merge:${layer}`;
      events.push(
        editingEvent(
          left,
          parents,
          { type: OPERATION_TYPE.INSERT, index: layer * 2, text: "L" },
          layer * 3,
        ),
        editingEvent(
          right,
          parents,
          { type: OPERATION_TYPE.INSERT, index: layer * 2, text: "R" },
          layer * 3 + 1,
        ),
        editingEvent(
          merge,
          [left, right],
          {
            type: OPERATION_TYPE.INSERT,
            index: (layer + 1) * 2,
            text: "",
          },
          layer * 3 + 2,
        ),
      );
      parents = [merge];
    }

    const source = EventGraph.fromEvents(events);
    const order = source.getBranchPreservingTopologicalOrder();
    const expected = new EgWalkerEngine().generate(order, "", {
      eventGraph: source,
      eventOrder: order,
    }).text;
    const packedGraph = pack(events);
    const compact = planPackedCriticalReplaySections(packedGraph);
    expect(compact?.sectionCount).toBe(200);

    const generate = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRange",
    );
    generate.mockClear();
    const replica = new EgWalkerReplica(
      "packed-linear-bridges",
      "",
      packedGraph,
    );

    expect(replica.getText()).toBe(expected);
    // The 168 obsolete cuts become one N-(short L)-N range plus one direct
    // trailing L cut. Only the 16 nonlinear cuts in the retained 32-section
    // checkpoint window still need independent engines.
    expect(generate).toHaveBeenCalledTimes(17);
  });

  it("continues from a retained numeric replay engine", () => {
    const events: GraphEvent[] = [];
    let parents: EventId[] = [];
    for (let layer = 0; layer < 40; layer++) {
      const left = `left:${layer}`;
      const right = `right:${layer}`;
      events.push(
        editingEvent(
          left,
          parents,
          { type: OPERATION_TYPE.INSERT, index: 0, text: "L" },
          layer * 2,
        ),
        editingEvent(
          right,
          parents,
          { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
          layer * 2 + 1,
        ),
      );
      parents = [left, right];
    }

    const replica = new EgWalkerReplica("packed-retained", "", pack(events));
    const replayCount = replica.getReplayStats().fullReplays;
    const merge = editingEvent(
      "merge:40",
      parents,
      { type: OPERATION_TYPE.INSERT, index: 0, text: "M" },
      80,
    );
    const divergent = editingEvent(
      "divergent:40",
      [parents[0]!],
      { type: OPERATION_TYPE.INSERT, index: 0, text: "D" },
      81,
    );

    expect(replica.applyRemoteEvent(merge).status).toBe("integrated");
    expect(replica.applyRemoteEvent(divergent).status).toBe("integrated");

    const reference = new EgWalkerReplica(
      "object-retained",
      "",
      EventGraph.fromEvents([...events, merge, divergent]),
    );
    expect(replica.getText()).toBe(reference.getText());
    expect(replica.getReplayStats().fullReplays).toBe(replayCount);
    expect(replica.getReplayStats().incrementalApplies).toBe(2);
  });

  it("splits a packed middle-position typed run after a stale-version fork", () => {
    const events: GraphEvent[] = [
      editingEvent(
        "root",
        [],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "" },
        0,
      ),
    ];
    let leftParent = "root";
    let rightParent = "root";
    for (let sequence = 0; sequence < 80; sequence++) {
      const left = `left:${sequence}`;
      const right = `right:${sequence}`;
      events.push(
        editingEvent(
          left,
          [leftParent],
          { type: OPERATION_TYPE.INSERT, index: sequence, text: "L" },
          sequence * 2 + 1,
        ),
        editingEvent(
          right,
          [rightParent],
          { type: OPERATION_TYPE.INSERT, index: sequence, text: "R" },
          sequence * 2 + 2,
        ),
      );
      leftParent = left;
      rightParent = right;
    }

    const updateItem = vi.spyOn(IndexedSequence.prototype, "updateItem");
    const packed = new EgWalkerReplica("packed-runs", "", pack(events));
    const packedUpdateCount = updateItem.mock.calls.length;
    updateItem.mockClear();
    const object = new EgWalkerReplica(
      "object-runs",
      "",
      EventGraph.fromEvents(events),
    );
    const objectUpdateCount = updateItem.mock.calls.length;
    updateItem.mockRestore();
    expect(packed.getText()).toBe(object.getText());
    expect(packedUpdateCount).toBeLessThan(objectUpdateCount);
    expect(packed.getReplayStats().peakSequenceRecordCount).toBeLessThan(100);

    const divergent = editingEvent(
      "fork",
      ["left:20"],
      { type: OPERATION_TYPE.INSERT, index: 21, text: "X" },
      1_000,
    );
    expect(packed.applyRemoteEvent(divergent).status).toBe("integrated");

    const reference = new EgWalkerReplica(
      "reference-runs",
      "",
      EventGraph.fromEvents([...events, divergent]),
    );
    expect(packed.getText()).toBe(reference.getText());
    expect([...packed.serialize().eventGraph.version].sort()).toEqual(
      [...reference.serialize().eventGraph.version].sort(),
    );
  });

  it("batches typed-run prepare spans across retreat, advance, and delete membership", () => {
    const events: GraphEvent[] = [];
    let timestamp = 0;
    let aParent: EventId | null = null;
    for (let sequence = 0; sequence < 3; sequence++) {
      const id = `a:${sequence}`;
      events.push(
        editingEvent(
          id,
          aParent === null ? [] : [aParent],
          { type: OPERATION_TYPE.INSERT, index: sequence, text: "a" },
          timestamp++,
        ),
      );
      aParent = id;
    }
    events.push(
      editingEvent(
        "c:0",
        ["a:2"],
        { type: OPERATION_TYPE.INSERT, index: 3, text: "" },
        timestamp++,
      ),
    );
    for (let sequence = 3; sequence < 8; sequence++) {
      const id = `a:${sequence}`;
      events.push(
        editingEvent(
          id,
          [aParent!],
          { type: OPERATION_TYPE.INSERT, index: sequence, text: "a" },
          timestamp++,
        ),
      );
      aParent = id;
    }
    events.push(
      editingEvent(
        "delete:0",
        ["a:7"],
        { type: OPERATION_TYPE.DELETE, index: 2, length: 5 },
        timestamp++,
      ),
    );

    let bParent: EventId = "a:2";
    for (let sequence = 0; sequence < 10; sequence++) {
      const id = `b:${sequence}`;
      events.push(
        editingEvent(
          id,
          [bParent],
          { type: OPERATION_TYPE.INSERT, index: 3 + sequence, text: "b" },
          timestamp++,
        ),
      );
      bParent = id;
    }
    events.push(
      editingEvent(
        "merge:0",
        ["delete:0", "b:9"],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "" },
        timestamp++,
      ),
      editingEvent(
        "final:0",
        ["c:0", "merge:0"],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "" },
        timestamp,
      ),
    );

    const spanIsolation = vi.spyOn(
      RecordSplitter.prototype,
      "isolateRunSpanForEvents",
    );
    const scalarIsolation = vi.spyOn(
      RecordSplitter.prototype,
      "isolateRunSliceForEvent",
    );
    const packed = new EgWalkerReplica("packed-span", "", pack(events));
    const packedSpanCalls = spanIsolation.mock.calls.filter(
      ([eventId, eventCount]) => eventId === "a:3" && eventCount === 5,
    ).length;
    const packedScalarCalls = scalarIsolation.mock.calls.filter(([eventId]) =>
      /^a:[3-7]$/.test(eventId),
    ).length;

    spanIsolation.mockClear();
    scalarIsolation.mockClear();
    const object = new EgWalkerReplica(
      "object-span",
      "",
      EventGraph.fromEvents(events),
    );
    const objectScalarCalls = scalarIsolation.mock.calls.filter(([eventId]) =>
      /^a:[3-7]$/.test(eventId),
    ).length;
    spanIsolation.mockRestore();
    scalarIsolation.mockRestore();

    expect(packedSpanCalls).toBe(2);
    expect(packedScalarCalls).toBe(0);
    expect(objectScalarCalls).toBe(10);
    expect(packed.getText()).toBe(`aaa${"b".repeat(10)}`);
    expect(packed.getText()).toBe(object.getText());
    expect(packed.getReplayStats().engineRetreats).toBe(7);
    expect(packed.getReplayStats().engineAdvances).toBe(6);
    expect(packed.getReplayStats().engineRetreats).toBe(
      object.getReplayStats().engineRetreats,
    );
    expect(packed.getReplayStats().engineAdvances).toBe(
      object.getReplayStats().engineAdvances,
    );
    expect([...packed.serialize().eventGraph.version].sort()).toEqual(
      [...object.serialize().eventGraph.version].sort(),
    );
  });

  it("batches a causal scalar-delete run into one placeholder range mutation", () => {
    const initialText = "x".repeat(128);
    const events: GraphEvent[] = [];
    let parent: EventId | null = null;
    for (let sequence = 0; sequence < 64; sequence++) {
      const id = `delete:${sequence}`;
      events.push(
        editingEvent(
          id,
          parent === null ? [] : [parent],
          { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
          sequence,
        ),
      );
      parent = id;
    }
    events.push(
      editingEvent(
        "other:0",
        [],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "" },
        64,
      ),
      editingEvent(
        "merge:0",
        ["delete:63", "other:0"],
        { type: OPERATION_TYPE.INSERT, index: 0, text: "" },
        65,
      ),
    );

    const rangeDelete = vi.spyOn(
      SegmentedPlaceholderState.prototype,
      "deletePrepareVisibleUnitsInSlice",
    );
    const packed = new EgWalkerReplica(
      "packed-delete-run",
      initialText,
      pack(events),
    );
    const packedRangeDeletes = rangeDelete.mock.calls.filter(
      ([, localStart, maxLength]) => localStart === 1 && maxLength === 63,
    ).length;

    rangeDelete.mockClear();
    const object = new EgWalkerReplica(
      "object-delete-run",
      initialText,
      EventGraph.fromEvents(events),
    );
    const objectRangeDeletes = rangeDelete.mock.calls.length;
    rangeDelete.mockRestore();

    expect(packedRangeDeletes).toBe(1);
    expect(objectRangeDeletes).toBe(0);
    expect(packed.getText()).toBe("x".repeat(64));
    expect(packed.getText()).toBe(object.getText());
    expect(packed.getReplayStats().engineRetreats).toBe(
      object.getReplayStats().engineRetreats,
    );
    expect(packed.getReplayStats().engineAdvances).toBe(
      object.getReplayStats().engineAdvances,
    );
    expect(packed.getReplayStats().sequenceTreeOperations).toBeLessThan(
      object.getReplayStats().sequenceTreeOperations,
    );

    const packedGraph = pack(events);
    const packedPlan = planPackedCriticalReplaySections(packedGraph);
    expect(packedPlan).not.toBeNull();
    const packedEngine = new EgWalkerEngine();
    packedEngine.generatePackedSectionRange(
      packedPlan!,
      0,
      packedPlan!.sectionCount,
      packedGraph,
      new Set(),
      PersistentUtf16Rope.from(initialText),
    );
    packedEngine.preparePackedRetention(
      packedPlan!,
      0,
      packedPlan!.sectionCount,
    );

    const objectEngine = new EgWalkerEngine();
    const objectOrder = packedGraph.getBranchPreservingTopologicalOrder();
    objectEngine.generate(objectOrder, initialText, {
      eventGraph: packedGraph,
      eventOrder: objectOrder,
      collectTransformedOperations: false,
    });

    const packedTargets = packedEngine.getDeleteTargetRecords();
    expect(packedEngine.getSequenceRecords()).toEqual(
      objectEngine.getSequenceRecords(),
    );
    expect(packedTargets).toEqual(objectEngine.getDeleteTargetRecords());
    expect(
      new Set(packedTargets.flatMap(({ targetIds }) => targetIds)).size,
    ).toBe(64);

    const restoredEngine = EgWalkerEngine.fromRecoveryState(
      packedEngine.captureRecoveryState(),
      packedGraph,
    );
    const partialDeleteVersion = new Set<EventId>(["delete:62"]);
    packedEngine.transitionPrepareView(partialDeleteVersion, packedGraph);
    objectEngine.transitionPrepareView(partialDeleteVersion, packedGraph);
    restoredEngine.transitionPrepareView(partialDeleteVersion, packedGraph);

    expect(packedEngine.getPrepareLength()).toBe(65);
    expect(packedEngine.getPrepareLength()).toBe(
      objectEngine.getPrepareLength(),
    );
    expect(restoredEngine.getPrepareLength()).toBe(
      objectEngine.getPrepareLength(),
    );
  });

  it("retains numeric replay across a rope seed and overlapping deletes", () => {
    const initialText = "x".repeat(100);
    const events: GraphEvent[] = [];
    let parents: EventId[] = [];
    for (let layer = 0; layer < 40; layer++) {
      const left = `delete-left:${layer}`;
      const right = `delete-right:${layer}`;
      const operation: ExternalOperation = {
        type: OPERATION_TYPE.DELETE,
        index: 0,
        length: 1,
      };
      events.push(
        editingEvent(left, parents, operation, layer * 2),
        editingEvent(right, parents, operation, layer * 2 + 1),
      );
      parents = [left, right];
    }

    const replica = new EgWalkerReplica(
      "packed-delete-retained",
      initialText,
      pack(events),
    );
    const merge = editingEvent(
      "delete-merge:40",
      parents,
      { type: OPERATION_TYPE.INSERT, index: 0, text: "M" },
      80,
    );
    const divergent = editingEvent(
      "delete-divergent:40",
      [parents[0]!],
      { type: OPERATION_TYPE.DELETE, index: 0, length: 1 },
      81,
    );

    replica.applyRemoteEvent(merge);
    replica.applyRemoteEvent(divergent);
    const reference = new EgWalkerReplica(
      "object-delete-retained",
      initialText,
      EventGraph.fromEvents([...events, merge, divergent]),
    );

    expect(replica.getText()).toBe(reference.getText());
    expect(replica.getReplayStats().incrementalApplies).toBe(2);
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
