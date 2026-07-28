import { describe, expect, it } from "vitest";

import { applyRemoteEventsInBatches } from "../bench/paper-bench-apply";
import {
  EgWalkerReplica,
  OPERATION_TYPE,
  type GraphEvent,
} from "@softmaple/eg-walker";

describe("applyRemoteEventsInBatches", () => {
  it.each([
    { batchEvents: 1 as const, expectedCalls: 6 },
    { batchEvents: 2 as const, expectedCalls: 3 },
    { batchEvents: 4 as const, expectedCalls: 2 },
    { batchEvents: "all" as const, expectedCalls: 1 },
  ])(
    "preserves trace semantics with batchEvents=$batchEvents",
    ({ batchEvents, expectedCalls }) => {
      const events = branchAndMergeTrace();
      const replica = new EgWalkerReplica(`paper-batch-${batchEvents}`);

      const applyCalls = applyRemoteEventsInBatches(
        replica,
        events,
        batchEvents,
      );
      const reference = referenceState(events);

      expect(applyCalls).toBe(expectedCalls);
      expect(replica.getPendingRemoteCount()).toBe(0);
      expect(replica.getText()).toBe(reference.text);
      expect(sortedFrontier(replica)).toEqual(reference.frontier);
      expect(canonicalEvents(replica)).toEqual(reference.events);
    },
  );

  it("does not call the receive API for an empty trace", () => {
    const replica = new EgWalkerReplica("paper-batch-empty");

    const applyCalls = applyRemoteEventsInBatches(replica, [], 4_096);

    expect(applyCalls).toBe(0);
    expect(replica.exportEventGraph()).toEqual([]);
  });

  it.each([0, -1, 1.5])("rejects invalid batch size %s", (batchEvents) => {
    const replica = new EgWalkerReplica("paper-batch-invalid");

    expect(() =>
      applyRemoteEventsInBatches(replica, branchAndMergeTrace(), batchEvents),
    ).toThrow(/batch size must be positive/);
    expect(replica.exportEventGraph()).toEqual([]);
  });
});

const branchAndMergeTrace = (): GraphEvent[] => [
  insertEvent("root:0", [], 0, "a", 0),
  insertEvent("left:0", ["root:0"], 1, "l", 1),
  insertEvent("right:0", ["root:0"], 1, "r", 2),
  insertEvent("left:1", ["left:0"], 2, "x", 3),
  insertEvent("right:1", ["right:0"], 2, "y", 4),
  insertEvent("merge:0", ["left:1", "right:1"], 5, "!", 5),
];

const insertEvent = (
  id: string,
  parents: ReadonlyArray<string>,
  index: number,
  text: string,
  timestamp: number,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  timestamp,
});

const referenceState = (
  events: ReadonlyArray<GraphEvent>,
): {
  readonly text: string;
  readonly frontier: ReadonlyArray<string>;
  readonly events: ReadonlyArray<CanonicalEvent>;
} => {
  const replica = new EgWalkerReplica("paper-batch-reference");
  for (const event of events) {
    replica.applyRemoteEvent(event);
  }
  return {
    text: replica.getText(),
    frontier: sortedFrontier(replica),
    events: canonicalEvents(replica),
  };
};

interface CanonicalEvent {
  readonly id: string;
  readonly parents: ReadonlyArray<string>;
  readonly operation: GraphEvent["operation"];
  readonly timestamp: number;
}

const canonicalEvents = (
  replica: EgWalkerReplica,
): ReadonlyArray<CanonicalEvent> =>
  replica
    .exportEventGraph()
    .map((event) => ({
      id: event.id,
      parents: Array.from(event.parentVersion).sort(),
      operation: event.operation,
      timestamp: event.timestamp,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

const sortedFrontier = (replica: EgWalkerReplica): ReadonlyArray<string> =>
  [...replica.serialize().eventGraph.version].sort();
