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

  it("should replay a second divergence from the first one's base", () => {
    // Arrange
    const history = historyWithConcurrentSections();
    const replica = new EgWalkerReplica("reader", "", pack(history));
    const first = insert("peer:0", ["after:194"], 0, "!");
    // A merge closes the divergence, and a typed chain longer than a live
    // receive drops its cache.
    const merge = insert("merge:peer", ["peer:0", "after:494"], 1_016, "M");
    const chain = typing("tail", 1_025, ["merge:peer"], 1_017);
    replica.applyRemoteEvent(first);
    replica.applyRemoteEvent(merge);
    replica.applyRemoteEvents(chain);
    // Concurrent with `first` too, so the newest critical cut before it is
    // the first divergence's base, newer than every older checkpoint.
    const second = insert("late:0", ["after:200"], 0, "?");

    // Act
    replica.applyRemoteEvent(second);

    // Assert
    expect(replica.getText()).toBe(
      replayedText([...history, first, merge, ...chain, second]),
    );
    expect(replica.getReplayStats().partialReplays).toBe(2);
  });

  it("should retreat and advance deletes of the checkpoint's text", () => {
    // Arrange
    const history = typing("author", 600, [], 0);
    const replica = new EgWalkerReplica("reader", "", pack(history));
    // One peer deletes loaded characters one at a time, as a deleted line
    // arrives; another deletes ten of the same characters in one edit. The
    // replay that follows is long enough to keep the loaded text as one
    // segmented placeholder.
    const left = forwardDeletes("left", 80, "author:599", 100);
    replica.applyRemoteEvents(left);
    const concurrent = [
      remove("right:0", ["author:599"], 110, 10),
      insert("right:1", ["right:0"], 110, "R"),
      remove("left:80", ["left:79"], 100, 1),
      insert("right:2", ["right:1"], 111, "S"),
      insert("merge:0", ["left:80", "right:2"], 0, "M"),
      // Retreats both peers' deletes at once, then types after the region
      // they deleted, where a miscounted character would shift the edit.
      insert("far:0", ["author:599"], 0, "F"),
      insert("far:1", ["far:0"], 200, "G"),
    ];

    // Act
    for (const event of concurrent) {
      replica.applyRemoteEvent(event);
    }

    // Assert
    expect(replica.getText()).toBe(
      replayedText([...history, ...left, ...concurrent]),
    );
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

const remove = (
  id: EventId,
  parents: ReadonlyArray<EventId>,
  index: number,
  length: number,
): GraphEvent => ({
  id,
  operation: { type: OPERATION_TYPE.DELETE, index, length },
  parentVersion: new Set(parents),
  timestamp: 0,
});

/** `count` single-character deletes at `index`, each after the last. */
const forwardDeletes = (
  replicaId: string,
  count: number,
  parent: EventId,
  index: number,
): GraphEvent[] =>
  Array.from({ length: count }, (_unused, offset) =>
    remove(
      `${replicaId}:${offset}`,
      [offset === 0 ? parent : `${replicaId}:${offset - 1}`],
      index,
      1,
    ),
  );

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
 * a cut 512 events back, after `before:502`, so a peer diverging at
 * `after:194`, 300 events back, finds it with a two-event chain, the
 * concurrent layers and a 196-event chain between that cut and its own.
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
