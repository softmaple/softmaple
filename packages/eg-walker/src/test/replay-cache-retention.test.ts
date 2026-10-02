import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  type CausalEventBatch,
  createCausalEventBatchBuilder,
} from "../core/causal-event-batch";
import { EgWalkerReplica } from "../core/replica";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import type { EventId, GraphEvent } from "../types";

describe("EgWalkerReplica.applyCausalBatch", () => {
  it("should release a large replay cache at a critical cut", () => {
    // Arrange
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    replica.applyCausalBatch(batchOf(branch.fork));

    // Act
    replica.applyCausalBatch(batchOf(branch.firstMerge));

    // Assert
    expect(replica.getReplayStats().replayCacheEvents).toBe(0);
  });

  it("should keep a cache across critical cuts once a release had to be rebuilt", () => {
    // Arrange
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    replica.applyCausalBatch(batchOf(branch.fork));
    replica.applyCausalBatch(batchOf(branch.firstMerge));
    // The branch's next event reaches back past the released cut.
    replica.applyCausalBatch(batchOf(branch.extension));

    // Act
    replica.applyCausalBatch(batchOf(branch.secondMerge));

    // Assert
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      replayCacheEvents: 6_006,
    });
  });

  it("should integrate the branch's next event incrementally", () => {
    // Arrange
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    for (const events of [
      branch.fork,
      branch.firstMerge,
      branch.extension,
      branch.secondMerge,
    ]) {
      replica.applyCausalBatch(batchOf(events));
    }

    // Act
    replica.applyCausalBatch(batchOf(branch.nextExtension));

    // Assert
    expect(replica.getReplayStats().partialReplays).toBe(1);
    expect(replica.getText()).toBe(replayedText(branchEvents(branch)));
  });
});

describe("EgWalkerReplica.applyRemoteEvent", () => {
  it("should release a rebuilt cache at the next critical cut", () => {
    // Arrange
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    for (const event of [
      ...branch.fork,
      ...branch.firstMerge,
      ...branch.extension,
    ]) {
      replica.applyRemoteEvent(event);
    }

    // Act
    for (const event of branch.secondMerge) {
      replica.applyRemoteEvent(event);
    }

    // Assert
    expect(replica.getReplayStats().replayCacheEvents).toBe(0);
  });
});

// Helpers

/**
 * A branch off the start of a 6,100-event history, merged into it, extended
 * from its own last event and merged again, as a maintenance branch is.
 * Each merge arrives with the main line's next edit, so neither batch
 * extends the receiver's frontier as one chain.
 */
const maintenanceBranch = () => ({
  history: [
    ...typing("base", 100, [], 0),
    ...typing("main", 6_000, ["base:99"], 100),
  ],
  fork: [insert("side:0", ["base:99"], 50, "s")],
  firstMerge: [
    insert("main:6000", ["main:5999"], 6_100, "x"),
    insert("merge:0", ["main:6000", "side:0"], 6_102, "m"),
  ],
  extension: [insert("side:1", ["side:0"], 51, "s")],
  secondMerge: [
    insert("main:6001", ["merge:0"], 6_103, "y"),
    insert("merge:1", ["main:6001", "side:1"], 6_105, "m"),
  ],
  nextExtension: [insert("side:2", ["side:1"], 52, "s")],
});

const branchEvents = (
  branch: ReturnType<typeof maintenanceBranch>,
): GraphEvent[] => [
  ...branch.history,
  ...branch.fork,
  ...branch.firstMerge,
  ...branch.extension,
  ...branch.secondMerge,
  ...branch.nextExtension,
];

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

/** A causal batch of insert events. */
const batchOf = (events: ReadonlyArray<GraphEvent>): CausalEventBatch => {
  const builder = createCausalEventBatchBuilder(events.length);
  for (const event of events) {
    if (event.operation.type !== OPERATION_TYPE.INSERT) {
      throw new Error(`${event.id} is not an insert`);
    }
    builder.appendInsert(
      event.id,
      event.parentVersion,
      event.operation.index,
      event.operation.text,
      event.timestamp,
    );
  }
  return builder.finish();
};

const pack = (events: ReadonlyArray<GraphEvent>): EventGraph => {
  const codec = new ColumnarEventGraphCodec();
  return codec.decodeBinary(codec.encodeBinary(EventGraph.fromEvents(events)));
};

const replayedText = (events: ReadonlyArray<GraphEvent>): string =>
  new EgWalkerReplica("oracle", "", EventGraph.fromEvents(events)).getText();
