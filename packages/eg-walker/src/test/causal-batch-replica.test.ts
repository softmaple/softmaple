import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  createCausalEventBatchBuilder,
  type CausalEventBatch,
} from "../core/causal-event-batch";
import { EgWalkerReplica } from "../core/replica";
import type { GraphEvent } from "../types";

describe("EgWalkerReplica.applyCausalBatch", () => {
  it("applies a large exact chain without replay or per-event runtime state", () => {
    const events = linearEvents(4_000);
    const subject = new EgWalkerReplica("causal-linear");
    const reference = new EgWalkerReplica("detailed-linear");

    subject.applyCausalBatch(toCausalBatch(events));
    reference.applyRemoteEvents(events);

    expect(subject.getText()).toBe(reference.getText());
    expect(canonicalGraph(subject)).toEqual(canonicalGraph(reference));
    expect(subject.getReplayStats()).toMatchObject({
      fullReplays: 0,
      partialReplays: 0,
      incrementalApplies: events.length,
      sequenceRecordCount: 0,
    });
  });

  it("integrates a branch and merge with at most one replay", () => {
    const events = branchAndMergeEvents();
    const subject = new EgWalkerReplica("causal-branch");
    const reference = new EgWalkerReplica("detailed-branch");

    subject.applyCausalBatch(toCausalBatch(events));
    reference.applyRemoteEvents(events);

    const stats = subject.getReplayStats();
    expect(subject.getText()).toBe(reference.getText());
    expect(canonicalGraph(subject)).toEqual(canonicalGraph(reference));
    expect(subject.getPendingRemoteCount()).toBe(0);
    expect(stats.fullReplays + stats.partialReplays).toBeLessThanOrEqual(1);
  });

  it.each([
    {
      name: "out-of-order parent",
      events: [
        insertEvent("a:1", ["a:0"], 1, "b"),
        insertEvent("a:0", [], 0, "a"),
      ],
      error: /Missing parent/,
    },
    {
      name: "duplicate within the batch",
      events: [insertEvent("a:0", [], 0, "a"), insertEvent("a:0", [], 0, "b")],
      error: /already exists/,
    },
    {
      name: "late invalid range",
      events: [
        insertEvent("a:0", [], 0, "a"),
        insertEvent("a:1", ["a:0"], 99, "b"),
      ],
      error: /out of bounds/,
    },
    {
      name: "late scalar split",
      events: [
        insertEvent("a:0", [], 0, "🙂"),
        insertEvent("a:1", ["a:0"], 1, "x"),
      ],
      error: /surrogate halves/,
    },
  ])("rolls back every field after a $name", ({ events, error }) => {
    const replica = new EgWalkerReplica("causal-rollback");
    const batch = toCausalBatch(events);
    const before = observableState(replica);

    expect(() => replica.applyCausalBatch(batch)).toThrow(error);

    expect(observableState(replica)).toEqual(before);
  });

  it("rejects an existing ID atomically", () => {
    const replica = new EgWalkerReplica("causal-existing");
    const root = insertEvent("a:0", [], 0, "a");
    replica.applyRemoteEvent(root);
    const before = observableState(replica);

    expect(() => replica.applyCausalBatch(toCausalBatch([root]))).toThrow(
      /already exists/,
    );
    expect(observableState(replica)).toEqual(before);
  });

  it("restores a multi-frontier replica exactly after a late branch failure", () => {
    const replica = new EgWalkerReplica("causal-frontier-rollback");
    const root = insertEvent("root:0", [], 0, "a");
    const left = insertEvent("left:0", [root.id], 1, "l", 1);
    const right = insertEvent("right:0", [root.id], 1, "r", 2);
    replica.applyRemoteEvents([root, left, right]);
    const before = observableState(replica);

    const batch = toCausalBatch([
      insertEvent("left:1", [left.id], 2, "x", 3),
      insertEvent("right:1", [right.id], 99, "y", 4),
    ]);

    expect(() => replica.applyCausalBatch(batch)).toThrow(
      /exceeds parent document length/,
    );
    expect(observableState(replica)).toEqual(before);
  });

  it("leaves a failed batch reusable after its prerequisite arrives", () => {
    const replica = new EgWalkerReplica("causal-retry");
    const root = insertEvent("a:0", [], 0, "a");
    const child = insertEvent("a:1", [root.id], 1, "b");
    const batch = toCausalBatch([child]);

    expect(() => replica.applyCausalBatch(batch)).toThrow(/Missing parent/);
    replica.applyRemoteEvent(root);
    replica.applyCausalBatch(batch);

    expect(replica.getText()).toBe("ab");
    expect(() => replica.applyCausalBatch(batch)).toThrow(/already consumed/);
  });

  it("does not interleave a strict batch with the pending queue", () => {
    const replica = new EgWalkerReplica("causal-pending");
    const missingRoot = insertEvent("a:0", [], 0, "a");
    const waitingChild = insertEvent("a:1", [missingRoot.id], 1, "b");
    const independent = toCausalBatch([
      insertEvent("independent:0", [], 0, "x"),
    ]);
    replica.applyRemoteEvent(waitingChild);
    const before = observableState(replica);

    expect(() => replica.applyCausalBatch(independent)).toThrow(/pending/);
    expect(observableState(replica)).toEqual(before);

    replica.applyRemoteEvent(missingRoot);
    replica.applyCausalBatch(independent);
    expect(replica.getPendingRemoteCount()).toBe(0);
  });

  it("keeps adopted graph events detached from public reads", () => {
    const replica = new EgWalkerReplica("causal-detached");
    replica.applyCausalBatch(toCausalBatch([insertEvent("a:0", [], 0, "a")]));

    const exported = replica.exportEventGraph()[0]!;
    (exported.operation as { text: string }).text = "mutated";
    (exported.parentVersion as Set<string>).add("forged:0");

    expect(replica.getText()).toBe("a");
    expect(replica.exportEventGraph()[0]).toEqual(
      insertEvent("a:0", [], 0, "a"),
    );
  });

  it("consumes an empty batch exactly once", () => {
    const replica = new EgWalkerReplica("causal-empty");
    const batch = createCausalEventBatchBuilder().finish();

    replica.applyCausalBatch(batch);

    expect(() => replica.applyCausalBatch(batch)).toThrow(/already consumed/);
    expect(replica.getText()).toBe("");
  });
});

const toCausalBatch = (events: ReadonlyArray<GraphEvent>): CausalEventBatch => {
  const builder = createCausalEventBatchBuilder(events.length);
  for (const event of events) {
    if (event.operation.type === OPERATION_TYPE.INSERT) {
      builder.appendInsert(
        event.id,
        event.parentVersion,
        event.operation.index,
        event.operation.text,
        event.timestamp,
      );
    } else {
      builder.appendDelete(
        event.id,
        event.parentVersion,
        event.operation.index,
        event.operation.length,
        event.timestamp,
      );
    }
  }
  return builder.finish();
};

const linearEvents = (count: number): GraphEvent[] =>
  Array.from({ length: count }, (_, index) =>
    insertEvent(
      `linear:${index}`,
      index === 0 ? [] : [`linear:${index - 1}`],
      index,
      "x",
      index,
    ),
  );

const branchAndMergeEvents = (): GraphEvent[] => [
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
  timestamp = Number(id.split(":").at(-1) ?? 0),
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  timestamp,
});

const observableState = (replica: EgWalkerReplica): unknown => ({
  serialized: replica.serialize(),
  text: replica.getText(),
  pending: replica.getPendingRemoteCount(),
  stats: replica.getReplayStats(),
});

interface CanonicalEvent {
  readonly id: string;
  readonly parents: ReadonlyArray<string>;
  readonly operation: GraphEvent["operation"];
  readonly timestamp: number;
}

const canonicalGraph = (
  replica: EgWalkerReplica,
): ReadonlyArray<CanonicalEvent> =>
  replica
    .exportEventGraph()
    .map((event) => ({
      id: event.id,
      parents: [...event.parentVersion].sort(),
      operation: event.operation,
      timestamp: event.timestamp,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
