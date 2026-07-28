import { describe, expect, it } from "vitest";

import { EgWalkerReplica, type GraphEvent } from "@softmaple/eg-walker";
import {
  buildCheckpointTrace,
  buildConcurrentSameIndexInserts,
  buildDeleteHeavyWorkload,
  buildLongLinearHistory,
  buildLongOfflineBranchMerge,
} from "../bench/traces";

const applyTrace = (events: ReadonlyArray<GraphEvent>): EgWalkerReplica => {
  const replica = new EgWalkerReplica("trace-smoke");
  for (const event of events) {
    replica.applyRemoteEvent(event);
  }
  return replica;
};

describe("bench trace builders", () => {
  it("builds causally closed linear histories", () => {
    const events = buildLongLinearHistory(10);
    const replica = applyTrace(events);

    expect(events).toHaveLength(10);
    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getText()).toHaveLength(10);
  });

  it("builds independent same-index insert traces", () => {
    const events = buildConcurrentSameIndexInserts(12);
    const replica = applyTrace(events);

    expect(events).toHaveLength(12);
    expect(events.every((event) => event.parentVersion.size === 0)).toBe(true);
    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getText()).toHaveLength(12);
  });

  it("builds long offline branch merge traces with a fan-in event", () => {
    const events = buildLongOfflineBranchMerge(0);
    const replica = applyTrace(events);

    expect(events).toHaveLength(2);
    expect(events.at(-1)?.id).toBe("merge:0");
    expect(replica.getPendingRemoteCount()).toBe(0);
  });

  it("builds delete-heavy traces that remain valid when applied", () => {
    const events = buildDeleteHeavyWorkload(50);
    const replica = applyTrace(events);

    expect(events).toHaveLength(50);
    expect(replica.getPendingRemoteCount()).toBe(0);
  });

  it("builds checkpoint traces that exercise partial replay", () => {
    const events = buildCheckpointTrace({
      linearHistory: 40,
      siblingCount: 6,
    });
    const replica = applyTrace(events);

    expect(events).toHaveLength(46);
    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getReplayStats().partialReplays).toBeGreaterThan(0);
  });
});
