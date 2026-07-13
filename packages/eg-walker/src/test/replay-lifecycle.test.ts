import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { EventGraph } from "../graph/event-graph";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import type { GraphEvent } from "../types";

const rootInsert = (index: number): GraphEvent => ({
  id: `root:${index}`,
  parentVersion: new Set(),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
  timestamp: index,
});

const twoBranchBurst = (eventCount: number): GraphEvent[] => {
  const root: GraphEvent = {
    id: "shared:0",
    parentVersion: new Set(),
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "s" },
    timestamp: 0,
  };
  const events = [root];
  let leftParent = root.id;
  let rightParent = root.id;
  let branchLength = 1;

  while (events.length < eventCount) {
    const left: GraphEvent = {
      id: `left:${branchLength}`,
      parentVersion: new Set([leftParent]),
      operation: {
        type: OPERATION_TYPE.INSERT,
        index: branchLength,
        text: "l",
      },
      timestamp: events.length,
    };
    events.push(left);
    leftParent = left.id;

    if (events.length < eventCount) {
      const right: GraphEvent = {
        id: `right:${branchLength}`,
        parentVersion: new Set([rightParent]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: branchLength,
          text: "r",
        },
        timestamp: events.length,
      };
      events.push(right);
      rightParent = right.id;
    }
    branchLength++;
  }

  return events;
};

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

  it("checks replay-cache coverage through direct parents in linear work", () => {
    // Arrange / Act: the second branch seeds a singleton critical checkpoint;
    // every later event descends from it through one direct parent.
    const sampleSizes = new Set([200, 400, 800]);
    const replica = new EgWalkerReplica("coverage");
    const measurements: Array<{
      readonly eventCount: number;
      readonly coverageChecks: number;
    }> = [];
    for (const [index, event] of twoBranchBurst(800).entries()) {
      replica.applyRemoteEvent(event);
      const eventCount = index + 1;
      if (sampleSizes.has(eventCount)) {
        measurements.push({
          eventCount,
          coverageChecks: replica.getReplayStats().replayCacheCoverageChecks,
        });
      }
    }

    // Assert: doubling the history doubles Set membership checks rather than
    // re-expanding every parent's complete ancestor closure.
    for (const measurement of measurements) {
      expect(measurement.coverageChecks).toBeLessThanOrEqual(
        measurement.eventCount,
      );
    }
    for (let index = 1; index < measurements.length; index++) {
      const previous = measurements[index - 1]!;
      const current = measurements[index]!;
      expect(
        current.coverageChecks / previous.coverageChecks,
      ).toBeLessThanOrEqual(2.02);
    }
    expect(replica.getText()).toHaveLength(800);
    expect(replica.getReplayStats()).toMatchObject({
      partialReplays: 1,
      fullReplays: 0,
    });
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

  it("loads a persisted linear history without retaining replay records", () => {
    const events: GraphEvent[] = [];
    let parent: ReadonlySet<string> = new Set();
    for (let index = 0; index < 10_000; index++) {
      const event: GraphEvent = {
        id: `persisted:${index}`,
        parentVersion: parent,
        operation: { type: OPERATION_TYPE.INSERT, index, text: "x" },
        timestamp: index,
      };
      events.push(event);
      parent = new Set([event.id]);
    }

    const replica = new EgWalkerReplica(
      "persisted",
      "",
      EventGraph.fromEvents(events),
    );

    expect(replica.getText()).toBe("x".repeat(events.length));
    expect(replica.getReplayStats()).toMatchObject({
      fullReplays: 1,
      sequenceRecordCount: 0,
      replayCacheEvents: 0,
      checkpointCount: 32,
    });
  });

  it("coalesces obsolete one-event critical sections across boundaries", () => {
    // Arrange: one concurrent prefix makes the graph nonlinear, followed by
    // a long chain whose every singleton frontier is a critical cut.
    const graph = new EventGraph();
    graph.addEvent({
      id: "alice:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 0,
    });
    graph.addEvent({
      id: "bob:0",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
      timestamp: 1,
    });
    graph.addEvent({
      id: "merge:0",
      parentVersion: new Set(["alice:0", "bob:0"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 2, text: "" },
      timestamp: 2,
    });
    let parent = "merge:0";
    for (let offset = 0; offset < 200; offset++) {
      const id = `tail:${offset}`;
      graph.addEvent({
        id,
        parentVersion: new Set([parent]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 2 + offset,
          text: "x",
        },
        timestamp: offset + 3,
      });
      parent = id;
    }
    PersistentUtf16Rope.resetInstrumentation();

    // Act
    const restored = new EgWalkerReplica("restored", "", graph);
    const ropeStats = PersistentUtf16Rope.getInstrumentation();

    // Assert: one prefix splice plus the 32 retained checkpoint edits, rather
    // than one persistent edit for every old critical section.
    expect(restored.getText()).toHaveLength(202);
    expect(restored.getText().endsWith("x".repeat(200))).toBe(true);
    expect(restored.getReplayStats().checkpointCount).toBe(32);
    expect(ropeStats.joins).toBeLessThanOrEqual(40);
  });

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
