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
  it("should keep a large replay cache at a critical cut its authors have not built on", () => {
    // Arrange
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    replica.applyCausalBatch(batchOf(branch.fork));

    // Act
    replica.applyCausalBatch(batchOf(branch.firstMerge));

    // Assert
    expect(replica.getReplayStats()).toMatchObject({
      replayCacheEvents: 6_003,
      replayCacheEvictions: 0,
    });
  });

  it("should release the cache once every author has built on the critical cut", () => {
    // Arrange
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    replica.applyCausalBatch(batchOf(branch.fork));
    replica.applyCausalBatch(batchOf(branch.firstMerge));

    // Act
    replica.applyCausalBatch(batchOf(bothBuildOn("merge:0", 6_001, 1, 6_103)));

    // Assert
    expect(replica.getReplayStats()).toMatchObject({
      replayCacheEvents: 0,
      replayCacheEvictions: 1,
    });
  });

  it("should integrate the branch's extensions past unconfirmed cuts without a replay", () => {
    // Arrange
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    replica.applyCausalBatch(batchOf(branch.fork));
    const afterFork = replica.getReplayStats();

    // Act
    for (const events of [
      branch.firstMerge,
      branch.extension,
      branch.secondMerge,
      branch.nextExtension,
    ]) {
      replica.applyCausalBatch(batchOf(events));
    }

    // Assert
    expect(replica.getReplayStats()).toMatchObject({
      fullReplays: afterFork.fullReplays,
      partialReplays: 0,
      replayCacheEvictions: 0,
      incrementalApplies: afterFork.incrementalApplies + 6,
    });
    expect(replica.getText()).toBe(replayedText(branchEvents(branch)));
  });

  it("should keep a cache across critical cuts once a release had to be rebuilt", () => {
    // Arrange: the side branch is silent long enough for the main line alone
    // to confirm the first merge, then extends its own branch again.
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    replica.applyCausalBatch(batchOf(branch.fork));
    replica.applyCausalBatch(batchOf(branch.firstMerge));
    for (const event of mainAfterFirstMerge(1_024)) {
      replica.applyRemoteEvent(event);
    }
    expect(replica.getReplayStats().replayCacheEvictions).toBe(1);
    replica.applyCausalBatch(batchOf(branch.extension));

    // Act
    replica.applyCausalBatch(batchOf(secondMergeAfter(1_024)));

    // Assert
    const eventCount = replica.exportEventGraph().length;
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      replayCacheEvictions: 1,
      replayCacheEvents: eventCount - 100,
    });
  });
});

describe("EgWalkerReplica.applyRemoteEvent", () => {
  it("should release a rebuilt cache at the next confirmed critical cut", () => {
    // Arrange
    const branch = maintenanceBranch();
    const replica = new EgWalkerReplica("reader", "", pack(branch.history));
    for (const event of [
      ...branch.fork,
      ...branch.firstMerge,
      ...mainAfterFirstMerge(1_024),
      ...branch.extension,
      ...secondMergeAfter(1_024),
    ]) {
      replica.applyRemoteEvent(event);
    }
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      replayCacheEvictions: 1,
    });
    expect(replica.getReplayStats().replayCacheEvents).toBeGreaterThan(0);

    // Act
    for (const event of bothBuildOn("merge:1", 7_026, 2, 7_129)) {
      replica.applyRemoteEvent(event);
    }

    // Assert
    expect(replica.getReplayStats()).toMatchObject({
      replayCacheEvents: 0,
      replayCacheEvictions: 2,
    });
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

/** `count` edits the main line types at its end after the first merge. */
const mainAfterFirstMerge = (count: number): GraphEvent[] =>
  Array.from({ length: count }, (_unused, index) =>
    insert(
      `main:${6_001 + index}`,
      [index === 0 ? "merge:0" : `main:${6_000 + index}`],
      6_103 + index,
      "y",
    ),
  );

/**
 * The main line's next edit after {@link mainAfterFirstMerge}, then a merge
 * of it with the side branch's `side:1`.
 */
const secondMergeAfter = (mainEdits: number): GraphEvent[] => {
  const last = 6_000 + mainEdits;
  const length = 6_103 + mainEdits;
  return [
    insert(`main:${last + 1}`, [`main:${last}`], length, "y"),
    insert("merge:1", [`main:${last + 1}`, "side:1"], length + 2, "m"),
  ];
};

/**
 * The main line, then the side branch, each building on `mergeId` in a
 * document of `length` code units.
 */
const bothBuildOn = (
  mergeId: EventId,
  mainSequence: number,
  sideSequence: number,
  length: number,
): GraphEvent[] => [
  insert(`main:${mainSequence}`, [mergeId], length, "y"),
  insert(`side:${sideSequence}`, [`main:${mainSequence}`], 51, "s"),
];

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
