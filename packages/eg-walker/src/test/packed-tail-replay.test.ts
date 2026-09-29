import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { coldReplayLadderEventCounts } from "../core/internals/critical-checkpoint-store";
import { PortableSnapshotCodec } from "../core/portable-snapshot-codec";
import { EgWalkerReplica } from "../core/replica";
import { planCriticalReplaySections } from "../engine/critical-section-replay-plan";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { planPackedCriticalReplaySections } from "../engine/packed-critical-replay-plan";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

const insert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  text: string,
  timestamp: number,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  parentVersion: new Set(parents),
  timestamp,
});

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

/** One author typing `count` characters at the end of the document. */
const typing = (
  replicaId: string,
  count: number,
  parents: ReadonlyArray<EventId> = [],
  startIndex = 0,
): GraphEvent[] => {
  const events: GraphEvent[] = [];
  for (let index = 0; index < count; index++) {
    events.push(
      insert(
        `${replicaId}:${index}`,
        index === 0 ? parents : [`${replicaId}:${index - 1}`],
        startIndex + index,
        String.fromCharCode(0x61 + (index % 26)),
        index,
      ),
    );
  }
  return events;
};

/** Layers of two concurrent inserts joined by an empty merge event. */
const diamonds = (layers: number): GraphEvent[] => {
  const events: GraphEvent[] = [];
  let parents: EventId[] = [];
  for (let layer = 0; layer < layers; layer++) {
    const left = `left:${layer}`;
    const right = `right:${layer}`;
    events.push(
      insert(left, parents, layer * 2, "L", layer * 3),
      insert(right, parents, layer * 2, "R", layer * 3 + 1),
      insert(
        `merge:${layer}`,
        [left, right],
        (layer + 1) * 2,
        "",
        layer * 3 + 2,
      ),
    );
    parents = [`merge:${layer}`];
  }
  return events;
};

const objectText = (events: ReadonlyArray<GraphEvent>): string =>
  new EgWalkerReplica("oracle", "", EventGraph.fromEvents(events)).getText();

describe("cold replay ladder", () => {
  it("doubles checkpoint depths behind the trailing window", () => {
    expect(coldReplayLadderEventCounts(1_000, 968)).toEqual([
      488, 744, 872, 936,
    ]);
    expect(coldReplayLadderEventCounts(1_000, 800)).toEqual([488, 744]);
    expect(coldReplayLadderEventCounts(64, 32)).toEqual([]);
  });

  it("serves a divergence older than the trailing window from a linear cold load", () => {
    const history = typing("author", 1_000);
    const late = insert("peer:0", ["author:699"], 0, "!", 2_000);
    const replica = new EgWalkerReplica("reader", "", pack(history));

    replica.applyRemoteEvent(late);

    expect(replica.getText()).toBe(objectText([...history, late]));
    expect(replica.getReplayStats()).toMatchObject({
      fullReplays: 1,
      partialReplays: 1,
      criticalCheckpointHits: 1,
    });
  });

  it("seeds the same ladder when an object graph holds the chain", () => {
    const history = typing("author", 1_000);
    const late = insert("peer:0", ["author:699"], 0, "!", 2_000);
    const expected = objectText([...history, late]);
    const replica = new EgWalkerReplica(
      "reader",
      "",
      EventGraph.fromEvents(history),
    );

    replica.applyRemoteEvent(late);

    expect(replica.getText()).toBe(expected);
    expect(replica.getReplayStats()).toMatchObject({
      fullReplays: 1,
      partialReplays: 1,
    });
  });

  it("serves a divergence older than the trailing window from a packed DAG load", () => {
    const history = diamonds(100);
    const late = insert("peer:0", ["merge:59"], 0, "!", 2_000);
    const replica = new EgWalkerReplica("reader", "", pack(history));

    replica.applyRemoteEvent(late);

    expect(replica.getText()).toBe(objectText([...history, late]));
    expect(replica.getReplayStats()).toMatchObject({
      fullReplays: 1,
      partialReplays: 1,
      criticalCheckpointHits: 1,
    });
  });
});

describe("packed prefix with a mutable tail", () => {
  const prefix = diamonds(20);
  const tail = [
    insert("tail:0", ["merge:19"], 0, "x", 100),
    insert("tail:1", ["merge:12"], 3, "y", 101),
    insert("tail:2", ["tail:0", "tail:1"], 1, "z", 102),
    insert("tail:3", ["left:4"], 0, "w", 103),
  ];

  const mixed = (): EventGraph => {
    const graph = pack(prefix);
    for (const event of tail) graph.addEvent(event);
    return graph;
  };

  it("repacks the prefix and tail into one numeric planning view", () => {
    const graph = mixed();
    const events = graph.getAllEvents();
    const view = graph.getPackedReplayPlanningView()!;

    expect(view).not.toBeNull();
    expect(view.count).toBe(events.length);
    events.forEach((event, offset) => {
      expect(view.idAt(offset)).toBe(event.id);
      expect(view.offsetOf(event.id)).toBe(offset);
      expect(view.operationAt(offset)).toEqual(event.operation);
      expect(view.eventAt(offset)).toEqual(event);
      const parents = Array.from(
        { length: view.parentCountAt(offset) },
        (_, index) => view.idAt(view.parentOffsetAt(offset, index)!),
      );
      expect(new Set(parents)).toEqual(event.parentVersion);
      const children = Array.from(
        { length: view.childCountAt(offset) },
        (_, index) => view.idAt(view.childOffsetAt(offset, index)!),
      );
      expect(new Set(children)).toEqual(graph.getChildren(event.id));
    });

    const packedPlan = planPackedCriticalReplaySections(graph)!;
    const objectPlan = planCriticalReplaySections(graph);
    expect(packedPlan.sectionCount).toBe(objectPlan.length);
    objectPlan.forEach((section, sectionIndex) => {
      expect(
        packedPlan.eventIdsInSectionRange(sectionIndex, sectionIndex + 1),
      ).toEqual(section.events.map(({ id }) => id));
    });
  });

  it("drops the repack when the tail changes", () => {
    const graph = mixed();
    const before = graph.getPackedReplayPlanningView()!;
    expect(graph.getPackedReplayPlanningView()).toBe(before);

    const transaction = graph.beginAppendTransaction();
    graph.addEvent(insert("tail:4", ["tail:2"], 0, "v", 104));
    const extended = graph.getPackedReplayPlanningView()!;
    expect(extended.count).toBe(before.count + 1);
    expect(extended.idAt(before.count)).toBe("tail:4");

    transaction.rollback();
    const restored = graph.getPackedReplayPlanningView()!;
    expect(restored.count).toBe(before.count);
    expect(restored.offsetOf("tail:4")).toBeUndefined();
  });

  it("cold-replays without the object planner", () => {
    const graph = mixed();
    const expected = objectText([...prefix, ...tail]);
    const objectOrder = vi.spyOn(
      EventGraph.prototype,
      "getBranchPreservingTopologicalOrder",
    );
    const packedRange = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRange",
    );

    try {
      const replica = new EgWalkerReplica("reader", "", graph);

      expect(replica.getText()).toBe(expected);
      expect(objectOrder).not.toHaveBeenCalled();
      expect(packedRange).toHaveBeenCalled();
    } finally {
      objectOrder.mockRestore();
      packedRange.mockRestore();
    }
  });

  it("repacks a lazily indexed linear prefix that the tail branches", () => {
    const history = typing("author", 50);
    const graph = pack(history);
    const branch = [
      insert("peer:0", ["author:9"], 0, "!", 100),
      insert("peer:1", ["peer:0", "author:49"], 0, "?", 101),
    ];
    for (const event of branch) graph.addEvent(event);

    const view = graph.getPackedReplayPlanningView()!;
    expect(view.eventAt(51)).toEqual({
      ...branch[1]!,
      parentVersion: new Set(["author:49", "peer:0"]),
    });
    expect(graph.getPackedLinearReplayView()).toBeNull();
    expect(new EgWalkerReplica("reader", "", graph).getText()).toBe(
      objectText([...history, ...branch]),
    );
  });

  it("streams a linear prefix with a linear tail through the packed chain path", () => {
    const history = typing("author", 50);
    const graph = pack(history);
    const next = insert("author:50", ["author:49"], 50, "!", 50);
    graph.addEvent(next);
    const expected = objectText([...history, next]);
    const materialized = vi.spyOn(
      EventGraph.prototype,
      "iterateEventsInInsertionOrder",
    );

    try {
      expect(graph.getPackedLinearReplayView()?.count).toBe(51);
      const replica = new EgWalkerReplica("reader", "", graph);
      expect(replica.getText()).toBe(expected);
      expect(materialized).not.toHaveBeenCalled();
    } finally {
      materialized.mockRestore();
    }
  });
});

describe("portable snapshot divergence older than every checkpoint", () => {
  it("replays the packed graph once more without the object planner", () => {
    const history = typing("author", 300);
    const source = new EgWalkerReplica("source");
    source.applyRemoteEvents(history);
    const codec = new PortableSnapshotCodec();
    const bytes = codec.encode(source.createPortableSnapshot()).slice();
    const late = insert("peer:0", ["author:0"], 0, "!", 1_000);
    const expected = objectText([...history, late]);
    const objectOrder = vi.spyOn(
      EventGraph.prototype,
      "getBranchPreservingTopologicalOrder",
    );

    try {
      const restored = EgWalkerReplica.fromPortableSnapshot(
        codec.decode(bytes),
      );
      restored.applyRemoteEvent(late);

      expect(restored.getText()).toBe(expected);
      expect(restored.getReplayStats()).toMatchObject({
        snapshotValidationReplays: 1,
        fullReplays: 1,
        partialReplays: 0,
      });
      expect(objectOrder).not.toHaveBeenCalled();
    } finally {
      objectOrder.mockRestore();
    }
  });
});
