import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  createCausalEventBatchBuilder,
  type CausalEventBatch,
} from "../core/causal-event-batch";
import { MAX_RETAINED_CHECKPOINTS } from "../core/internals/critical-checkpoint-store";
import { MIN_TRANSIENT_CHAIN_EVENTS } from "../core/internals/replay-packed-linear";
import { EgWalkerReplica } from "../core/replica";
import { EventGraph } from "../graph/event-graph";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import type { GraphEvent } from "../types";

describe("EgWalkerReplica.applyCausalBatch", () => {
  it("applies a large exact chain without replay or per-event runtime state", () => {
    const events = linearEvents(4_000);
    const subject = new EgWalkerReplica("causal-linear");
    const reference = new EgWalkerReplica("detailed-linear");

    PersistentUtf16Rope.resetInstrumentation();
    subject.applyCausalBatch(toCausalBatch(events));
    const causalRope = PersistentUtf16Rope.getInstrumentation();
    reference.applyRemoteEvents(events);

    expect(subject.getText()).toBe(reference.getText());
    expect(canonicalGraph(subject)).toEqual(canonicalGraph(reference));
    expect(subject.getReplayStats()).toMatchObject({
      fullReplays: 0,
      partialReplays: 0,
      incrementalApplies: events.length,
      sequenceRecordCount: 0,
    });
    expect(causalRope.nodeAllocations).toBeLessThan(events.length / 2);
  });

  it("edits the persistent rope only for the checkpoint window of a long chain", () => {
    // Inserts at the start never coalesce, so each is its own rope edit.
    const events = Array.from({ length: 1_000 }, (_, index) =>
      insertEvent(
        `front:${index}`,
        index === 0 ? [] : [`front:${index - 1}`],
        0,
        String.fromCharCode(0x21 + (index % 94)),
      ),
    );
    const replica = new EgWalkerReplica("causal-front");

    PersistentUtf16Rope.resetInstrumentation();
    replica.applyCausalBatch(toCausalBatch(events));
    const rope = PersistentUtf16Rope.getInstrumentation();

    expect(replica.getText()).toBe(insertedText(events).reverse().join(""));
    expect(rope.joins).toBeLessThanOrEqual(MAX_RETAINED_CHECKPOINTS);
    expect(replica.getReplayStats().checkpointCount).toBe(
      MAX_RETAINED_CHECKPOINTS,
    );
  });

  it("rolls back a long chain whose checkpoint-free prefix splits a surrogate pair", () => {
    const splitAt = MIN_TRANSIENT_CHAIN_EVENTS;
    // Typing after the pair, then an insert inside it, before the window.
    const events = Array.from(
      { length: splitAt + 2 * MAX_RETAINED_CHECKPOINTS },
      (_, index) =>
        insertEvent(
          `split:${index}`,
          index === 0 ? [] : [`split:${index - 1}`],
          index === 0 ? 0 : index === splitAt ? 1 : index + 1,
          index === 0 ? "🙂" : "a",
        ),
    );
    const replica = new EgWalkerReplica("causal-long-split");
    const before = observableState(replica);

    expect(() => replica.applyCausalBatch(toCausalBatch(events))).toThrow(
      /surrogate halves/,
    );
    expect(observableState(replica)).toEqual(before);
  });

  it("rejects a coalesced delete that would split a surrogate pair", () => {
    const replica = new EgWalkerReplica("causal-delete-boundary", "a🙂");
    const events: GraphEvent[] = [
      deleteEvent("delete:0", [], 0, 1, 0),
      deleteEvent("delete:1", ["delete:0"], 0, 1, 1),
    ];
    for (let offset = 2; offset < 42; offset++) {
      events.push(
        insertEvent(
          `delete:${offset}`,
          [`delete:${offset - 1}`],
          999,
          "",
          offset,
        ),
      );
    }
    const before = observableState(replica);

    expect(() => replica.applyCausalBatch(toCausalBatch(events))).toThrow(
      /surrogate halves/,
    );
    expect(observableState(replica)).toEqual(before);
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

  it.each([
    { name: "a branch and merge", setup: [], events: branchAndMergeEvents() },
    {
      name: "a chain after an object-stored event",
      setup: [insertEvent("root:0", [], 0, "a")],
      events: [
        insertEvent("chain:1", ["root:0"], 1, "b"),
        insertEvent("chain:2", ["chain:1"], 2, "c"),
      ],
    },
  ])("stores $name without per-event graph ingestion", ({ setup, events }) => {
    const replica = new EgWalkerReplica("causal-adopt");
    const reference = new EgWalkerReplica("detailed-adopt");
    for (const event of setup) {
      replica.applyRemoteEvent(event);
      reference.applyRemoteEvent(event);
    }
    const batch = toCausalBatch(events);
    const copied = vi.spyOn(EventGraph.prototype, "addEvent");
    const adopted = vi.spyOn(EventGraph.prototype, "addOwnedEvent");

    try {
      replica.applyCausalBatch(batch);

      expect(copied).not.toHaveBeenCalled();
      expect(adopted).not.toHaveBeenCalled();
    } finally {
      copied.mockRestore();
      adopted.mockRestore();
    }
    reference.applyRemoteEvents(events);
    expect(replica.getText()).toBe(reference.getText());
  });

  it("retries adopted columns on another replica after operation validation fails", () => {
    const batch = toCausalBatch([
      insertEvent("custom-root", [], 1, "A", 0.5),
      insertEvent("other:9", [], 1, "B", 1.5),
    ]);
    const empty = new EgWalkerReplica("empty");
    const before = observableState(empty);
    expect(() => empty.applyCausalBatch(batch)).toThrow();
    expect(observableState(empty)).toEqual(before);
    // A different initial document makes both concurrent operations valid.
    const target = new EgWalkerReplica("target", "x");
    const reference = new EgWalkerReplica("reference", "x");
    target.applyCausalBatch(batch);
    reference.applyRemoteEvents([
      insertEvent("custom-root", [], 1, "A", 0.5),
      insertEvent("other:9", [], 1, "B", 1.5),
    ]);
    expect(canonicalGraph(target)).toEqual(canonicalGraph(reference));
    expect(target.getText()).toBe(reference.getText());
    empty.applyCausalBatch(toCausalBatch([insertEvent("new:0", [], 0, "z")]));
    empty.insert(1, "!");
    expect(empty.getText()).toBe("z!");
  });

  it.each([
    "tail",
    "packed",
  ])("remaps local parents and agents onto a %s prefix", (prefix) => {
    const root = insertEvent("z:9", [], 0, "x");
    const replica = new EgWalkerReplica("mixed");
    const reference = new EgWalkerReplica("reference");
    if (prefix === "tail") replica.applyRemoteEvent(root);
    else replica.applyCausalBatch(toCausalBatch([root]));
    reference.applyRemoteEvent(root);
    const events = [
      insertEvent("a:2", ["z:9"], 1, "a", 0.5),
      insertEvent("z:10", ["z:9"], 1, "b", 1.5),
      insertEvent("custom", ["a:2", "z:10"], 3, "!", 2.5),
    ];
    replica.applyCausalBatch(toCausalBatch(events));
    reference.applyRemoteEvents(events);
    replica.insert(0, "@");
    reference.applyRemoteEvents(
      replica
        .exportEventGraph()
        .filter((event) => event.id.startsWith("mixed:")),
    );
    expect(replica.getText()).toBe(reference.getText());
    expect(canonicalGraph(replica)).toEqual(canonicalGraph(reference));
  });

  it("widens timestamps when extending an adopted linear chain", () => {
    const replica = new EgWalkerReplica("fractions");
    const events = [
      insertEvent("a:0", [], 0, "a", 0),
      insertEvent("a:1", ["a:0"], 1, "b", 0.5),
      insertEvent("a:2", ["a:1"], 2, "c", -1.5),
    ];
    for (const event of events)
      replica.applyCausalBatch(toCausalBatch([event]));
    expect(replica.exportEventGraph()).toEqual(events);
    expect(replica.getText()).toBe("abc");
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

const insertedText = (events: ReadonlyArray<GraphEvent>): string[] =>
  events.map((event) =>
    event.operation.type === OPERATION_TYPE.INSERT ? event.operation.text : "",
  );

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

const deleteEvent = (
  id: string,
  parents: ReadonlyArray<string>,
  index: number,
  length: number,
  timestamp: number,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.DELETE, index, length },
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
