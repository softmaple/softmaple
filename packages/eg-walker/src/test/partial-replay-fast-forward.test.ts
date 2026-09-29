import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

describe("EgWalkerReplica partial replay from a checkpoint", () => {
  it("should keep CRDT state only for the events after the divergence", () => {
    // Arrange
    const history = typing("author", 1_000, [], 0);
    const replica = new EgWalkerReplica("reader", "", pack(history));
    const late = insert("peer:0", ["author:699"], 0, "!");

    // Act
    replica.applyRemoteEvent(late);

    // Assert
    expect(replica.getText()).toBe(replayedText([...history, late]));
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      criticalCheckpointHits: 1,
      replayCacheEvents: 301,
    });
  });

  it("should fast-forward concurrent sections and chains before the divergence", () => {
    // Arrange
    const history = historyWithConcurrentSections();
    const replica = new EgWalkerReplica("reader", "", pack(history));
    const late = insert("peer:0", ["after:194"], 0, "!");

    // Act
    replica.applyRemoteEvent(late);

    // Assert
    expect(replica.getText()).toBe(replayedText([...history, late]));
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      replayCacheEvents: 301,
    });
  });

  it("should integrate the diverged peer's next edit incrementally", () => {
    // Arrange
    const history = historyWithConcurrentSections();
    const replica = new EgWalkerReplica("reader", "", pack(history));
    const late = insert("peer:0", ["after:194"], 0, "!");
    const next = insert("peer:1", ["peer:0"], 1, "?");
    replica.applyRemoteEvent(late);

    // Act
    replica.applyRemoteEvent(next);

    // Assert
    expect(replica.getText()).toBe(replayedText([...history, late, next]));
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      incrementalApplies: 1,
    });
  });

  it("should rebuild the retained engine from its own base after a rejected batch", () => {
    // Arrange
    const history = historyWithConcurrentSections();
    const replica = new EgWalkerReplica("reader", "", pack(history));
    const late = insert("peer:0", ["after:194"], 0, "!");
    const next = insert("peer:1", ["peer:0"], 1, "?");
    const outOfRange: GraphEvent = {
      id: "peer:2",
      operation: { type: OPERATION_TYPE.DELETE, index: 0, length: 1_000_000 },
      parentVersion: new Set(["peer:1"]),
      timestamp: 0,
    };
    replica.applyRemoteEvent(late);
    const rejected = () => replica.applyRemoteEvents([next, outOfRange]);

    // Act
    expect(rejected).toThrow(/exceeds/);
    replica.applyRemoteEvent(next);

    // Assert
    expect(replica.getText()).toBe(replayedText([...history, late, next]));
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      incrementalApplies: 1,
    });
  });
});

// Helpers

const insert = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  text: string,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  parentVersion: new Set(parents),
  timestamp: 0,
});

/** One author typing `count` characters from `startIndex` onwards. */
const typing = (
  replicaId: string,
  count: number,
  parents: ReadonlyArray<EventId>,
  startIndex: number,
): GraphEvent[] =>
  Array.from({ length: count }, (_unused, index) =>
    insert(
      `${replicaId}:${index}`,
      index === 0 ? parents : [`${replicaId}:${index - 1}`],
      startIndex + index,
      String.fromCharCode(0x61 + (index % 26)),
    ),
  );

/**
 * 505 typed events, five layers of two concurrent inserts joined by a merge,
 * then 495 more typed events. After a cold load the checkpoint ladder holds
 * a cut 512 events back, at `before:503`, so a peer diverging at `after:194`,
 * 300 events back, finds it with a two-event chain, the concurrent layers and
 * a 196-event chain between that cut and its own.
 */
const historyWithConcurrentSections = (): GraphEvent[] => {
  const events = typing("before", 505, [], 0);
  let parents: EventId[] = ["before:504"];
  let length = 505;
  for (let layer = 0; layer < 5; layer++) {
    events.push(
      insert(`left:${layer}`, parents, length, "L"),
      insert(`right:${layer}`, parents, length, "R"),
      insert(
        `merge:${layer}`,
        [`left:${layer}`, `right:${layer}`],
        length + 2,
        "M",
      ),
    );
    parents = [`merge:${layer}`];
    length += 3;
  }
  return [...events, ...typing("after", 495, parents, length)];
};

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

const replayedText = (events: ReadonlyArray<GraphEvent>): string =>
  new EgWalkerReplica("oracle", "", EventGraph.fromEvents(events)).getText();
