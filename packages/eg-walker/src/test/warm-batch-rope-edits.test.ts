import { afterEach, describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { TransientUtf16RopeEditor } from "../text/transient-utf16-rope";
import type { EventId, GraphEvent } from "../types";

describe("warm receive batches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { events: 127, pieceIndexes: 0 },
    { events: 128, pieceIndexes: 1 },
  ])("should freeze $pieceIndexes piece indexes for a batch of $events events", ({
    events,
    pieceIndexes,
  }) => {
    // Arrange: two concurrent roots leave a retained engine, and a third
    // writer's chain diverges from the first root.
    const replica = new EgWalkerReplica("reader");
    const roots = [insert("a:0", [], 0, "a"), insert("b:0", [], 0, "b")];
    for (const root of roots) {
      replica.applyRemoteEvent(root);
    }
    const chain = Array.from({ length: events }, (_unused, index) =>
      insert(
        `c:${index}`,
        [index === 0 ? "a:0" : `c:${index - 1}`],
        index + 1,
        "c",
      ),
    );
    const freeze = vi.spyOn(TransientUtf16RopeEditor.prototype, "finish");

    // Act
    replica.applyRemoteEvents(chain);

    // Assert
    expect(freeze).toHaveBeenCalledTimes(pieceIndexes);
    expect(replica.getReplayStats()).toMatchObject({
      fullReplays: 1,
      partialReplays: 0,
      incrementalApplies: 1 + events,
    });
    expect(replica.getText()).toBe(receivedAtOnce([...roots, ...chain]));
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

/** Text of a fresh replica that receives `events` in one batch. */
const receivedAtOnce = (events: ReadonlyArray<GraphEvent>): string => {
  const replica = new EgWalkerReplica("reference");
  replica.applyRemoteEvents(events);
  return replica.getText();
};
