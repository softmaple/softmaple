import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import type { GraphEvent } from "../types";

const rootInsert = (index: number): GraphEvent => ({
  id: `root:${index}`,
  parentVersion: new Set(),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
  timestamp: index,
});

describe("paper-style replay lifecycle", () => {
  it("absorbs a 1,600-event concurrent batch with one cold replay", () => {
    const replica = new EgWalkerReplica("batch");

    replica.applyRemoteEvents(
      Array.from({ length: 1_600 }, (_, i) => rootInsert(i)),
    );

    const stats = replica.getReplayStats();
    expect(replica.getText()).toHaveLength(1_600);
    expect(stats.fullReplays).toBeLessThanOrEqual(1);
    expect(stats.replayCacheEvents).toBe(1_600);
  });

  it("absorbs 1,200 individually delivered concurrent events in one cache", () => {
    const replica = new EgWalkerReplica("stream");
    for (let index = 0; index < 1_200; index++) {
      replica.applyRemoteEvent(rootInsert(index));
    }

    const stats = replica.getReplayStats();
    expect(replica.getText()).toHaveLength(1_200);
    expect(stats.fullReplays).toBeLessThanOrEqual(2);
    expect(stats.replayCacheEvents).toBeLessThanOrEqual(4_096);
    expect(stats.replayCacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  });

  it("keeps 100,000 linear events engine-free and materializes lazily", () => {
    PersistentUtf16Rope.resetInstrumentation();
    const replica = new EgWalkerReplica("linear");
    let parent: ReadonlySet<string> = new Set();
    for (let index = 0; index < 100_000; index++) {
      const id = `linear:${index}`;
      replica.applyRemoteEvent({
        id,
        parentVersion: parent,
        operation: { type: OPERATION_TYPE.INSERT, index, text: "x" },
        timestamp: index,
      });
      parent = new Set([id]);
    }

    const beforeRead = replica.getReplayStats();
    expect(beforeRead.sequenceRecordCount).toBe(0);
    expect(beforeRead.replayCacheEvents).toBe(0);
    expect(PersistentUtf16Rope.getInstrumentation().flattenCount).toBe(0);
    expect(replica.getText()).toHaveLength(100_000);
    expect(replica.getText()).toHaveLength(100_000);
    expect(PersistentUtf16Rope.getInstrumentation().flattenCount).toBe(1);
  }, 30_000);

  it("shares checkpoint leaves instead of retaining full string copies", () => {
    const replica = new EgWalkerReplica("sharing", "x".repeat(8_192));
    for (let index = 0; index < 40; index++) {
      replica.insert(8_192 + index, "y");
    }

    const stats = replica.getReplayStats();
    const copiedUpperBound = 32 * replica.getText().length * 2;
    expect(stats.checkpointCount).toBe(32);
    expect(stats.checkpointUniqueTextBytes).toBeLessThan(copiedUpperBound / 4);
  });

  it("should keep replica partial replay and recovery anchoring rope-backed", () => {
    // Arrange
    const checkpointText = "x".repeat(256 * 1024);
    const root: GraphEvent = {
      id: "checkpoint:0",
      parentVersion: new Set(),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: 0,
        text: checkpointText,
      },
      timestamp: 0,
    };
    const left: GraphEvent = {
      id: "left:0",
      parentVersion: new Set([root.id]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: checkpointText.length,
        text: "L",
      },
      timestamp: 1,
    };
    const right: GraphEvent = {
      id: "right:0",
      parentVersion: new Set([root.id]),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "R" },
      timestamp: 2,
    };
    const replica = new EgWalkerReplica("receiver");
    replica.applyRemoteEvents([root, left]);
    PersistentUtf16Rope.resetInstrumentation();

    // Act
    replica.applyRemoteEvent(right);

    // Assert
    expect(replica.getReplayStats().partialReplays).toBe(1);
    expect(PersistentUtf16Rope.getInstrumentation()).toMatchObject({
      flattenCount: 0,
      flattenedCodeUnits: 0,
    });
  });
});
