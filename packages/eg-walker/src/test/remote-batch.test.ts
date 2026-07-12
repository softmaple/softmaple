import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { APPLY_REMOTE_EVENT_STATUS, type GraphEvent } from "../types";
import { cloneEvent } from "./test-helpers";

const insertEvent = (
  id: string,
  parents: ReadonlyArray<string>,
  index: number,
  text: string,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.INSERT, index, text },
  timestamp: Number(id.split(":").at(-1) ?? 0),
});

const deleteEvent = (
  id: string,
  parents: ReadonlyArray<string>,
  index: number,
  length: number,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: OPERATION_TYPE.DELETE, index, length },
  timestamp: Number(id.split(":").at(-1) ?? 0),
});

describe("EgWalkerReplica.applyRemoteEvents", () => {
  it("rejects malformed event fields before mutating any batch state", () => {
    // Arrange
    const replica = new EgWalkerReplica("receiver");
    const valid = insertEvent("valid:0", [], 0, "v");
    const malformed: ReadonlyArray<
      readonly [event: GraphEvent, expected: RegExp]
    > = [
      [{ ...valid, id: "bad:timestamp", timestamp: Number.NaN }, /timestamp/],
      [
        {
          ...valid,
          id: "bad:operation",
          operation: null,
        } as unknown as GraphEvent,
        /operation/,
      ],
      [
        {
          ...valid,
          id: "bad:insert",
          operation: { type: OPERATION_TYPE.INSERT, index: "0", text: "x" },
        } as unknown as GraphEvent,
        /invalid insert/,
      ],
      [
        {
          ...valid,
          id: "bad:delete",
          operation: { type: OPERATION_TYPE.DELETE, index: 0, length: "1" },
        } as unknown as GraphEvent,
        /invalid delete/,
      ],
      [
        {
          ...valid,
          id: "bad:type",
          operation: { type: "replace", index: 0, text: "x" },
        } as unknown as GraphEvent,
        /unknown operation type/,
      ],
    ];

    // Act and assert
    for (const [event, expected] of malformed) {
      expect(() => replica.applyRemoteEvents([valid, event])).toThrow(expected);
      expect(replica.getText()).toBe("");
      expect(replica.exportEventGraph()).toEqual([]);
    }
  });

  it("causally orders a reversed batch while aligning results to input", () => {
    const root = insertEvent("alice:0", [], 0, "a");
    const child = insertEvent("alice:1", [root.id], 1, "b");
    const replica = new EgWalkerReplica("receiver");

    const result = replica.applyRemoteEvents([child, root]);

    expect(result.results).toEqual([
      {
        status: APPLY_REMOTE_EVENT_STATUS.Integrated,
        operation: { type: OPERATION_TYPE.INSERT, index: 1, length: 1 },
      },
      {
        status: APPLY_REMOTE_EVENT_STATUS.Integrated,
        operation: { type: OPERATION_TYPE.INSERT, index: 0, length: 1 },
      },
    ]);
    expect(result.operations).toEqual([
      { type: OPERATION_TYPE.INSERT, index: 0, length: 1 },
      { type: OPERATION_TYPE.INSERT, index: 1, length: 1 },
    ]);
    expect(replica.getText()).toBe("ab");
  });

  it("reports missing external parents and repeated IDs without mutation", () => {
    const event = insertEvent("alice:1", ["alice:0"], 1, "b");
    const replica = new EgWalkerReplica("receiver");

    const result = replica.applyRemoteEvents([event, cloneEvent(event)]);

    expect(result.results).toEqual([
      { status: APPLY_REMOTE_EVENT_STATUS.Buffered },
      { status: APPLY_REMOTE_EVENT_STATUS.Duplicate },
    ]);
    expect(result.operations).toEqual([]);
    expect(replica.getPendingRemoteCount()).toBe(1);
    expect(replica.getText()).toBe("");
  });

  it("includes descendants buffered before the batch in aggregate operations", () => {
    const root = insertEvent("alice:0", [], 0, "a");
    const child = insertEvent("alice:1", [root.id], 1, "b");
    const replica = new EgWalkerReplica("receiver");
    replica.applyRemoteEvent(child);

    const result = replica.applyRemoteEvents([root]);

    expect(result.results).toEqual([
      {
        status: APPLY_REMOTE_EVENT_STATUS.Integrated,
        operation: null,
      },
    ]);
    expect(result.operations).toEqual([
      { type: OPERATION_TYPE.INSERT, index: 0, length: 1 },
      { type: OPERATION_TYPE.INSERT, index: 1, length: 1 },
    ]);
    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getText()).toBe("ab");
  });

  it("returns null aggregate operations when a concurrent event replays", () => {
    const root = insertEvent("seed:0", [], 0, "s");
    const left = insertEvent("alice:0", [root.id], 1, "a");
    const right = insertEvent("bob:0", [root.id], 1, "b");
    const replica = new EgWalkerReplica("receiver");

    const result = replica.applyRemoteEvents([right, root, left]);

    expect(result.results.every((entry) => entry.status === "integrated")).toBe(
      true,
    );
    expect(result.operations).toBeNull();
    expect(replica.getText()).toHaveLength(3);
  });

  it("rolls back every observable field when a later event is invalid", () => {
    const replica = new EgWalkerReplica("receiver");
    replica.applyRemoteEvent(insertEvent("seed:0", [], 0, "s"));
    const valid = insertEvent("alice:0", ["seed:0"], 1, "a");
    const invalid = insertEvent("alice:1", [valid.id], 99, "x");
    const before = {
      serialized: replica.serialize(),
      text: replica.getText(),
      pending: replica.getPendingRemoteCount(),
      stats: replica.getReplayStats(),
    };

    expect(() => replica.applyRemoteEvents([valid, invalid])).toThrow();

    expect(replica.serialize()).toEqual(before.serialized);
    expect(replica.getText()).toBe(before.text);
    expect(replica.getPendingRemoteCount()).toBe(before.pending);
    expect(replica.getReplayStats()).toEqual(before.stats);
  });

  it("rejects a divergent delete that exceeds its parent view atomically", () => {
    const replica = new EgWalkerReplica("receiver");
    const root = insertEvent("root:0", [], 0, "a");
    const left = insertEvent("left:0", [root.id], 1, "b");
    replica.applyRemoteEvents([root, left]);
    const before = {
      serialized: replica.serialize(),
      text: replica.getText(),
      pending: replica.getPendingRemoteCount(),
      stats: replica.getReplayStats(),
    };

    expect(() =>
      replica.applyRemoteEvent(deleteEvent("bad:0", [root.id], 0, 2)),
    ).toThrow(/exceeds parent document length 1/);
    expect(replica.serialize()).toEqual(before.serialized);
    expect(replica.getText()).toBe(before.text);
    expect(replica.getPendingRemoteCount()).toBe(before.pending);
    expect(replica.getReplayStats()).toEqual(before.stats);
  });

  it("rejects a divergent edit inside a parent-view surrogate pair atomically", () => {
    const replica = new EgWalkerReplica("receiver");
    const root = insertEvent("root:0", [], 0, "😀");
    const left = insertEvent("left:0", [root.id], 2, "x");
    replica.applyRemoteEvents([root, left]);
    const before = {
      serialized: replica.serialize(),
      text: replica.getText(),
      pending: replica.getPendingRemoteCount(),
      stats: replica.getReplayStats(),
    };

    expect(() =>
      replica.applyRemoteEvent(insertEvent("bad:0", [root.id], 1, "!")),
    ).toThrow(/splits a Unicode scalar/);
    expect(replica.serialize()).toEqual(before.serialized);
    expect(replica.getText()).toBe(before.text);
    expect(replica.getPendingRemoteCount()).toBe(before.pending);
    expect(replica.getReplayStats()).toEqual(before.stats);
  });

  it("preserves structural counters for the next event after rollback", () => {
    const subject = new EgWalkerReplica("subject");
    const control = new EgWalkerReplica("control");
    const root = insertEvent("root:0", [], 0, "a");
    const left = insertEvent("left:0", [root.id], 1, "b");
    subject.applyRemoteEvents([root, left]);
    control.applyRemoteEvents([root, left]);

    expect(() =>
      subject.applyRemoteEvent(insertEvent("bad:0", [root.id], 99, "!")),
    ).toThrow();

    const next = insertEvent("left:1", [left.id], 2, "c");
    subject.applyRemoteEvent(next);
    control.applyRemoteEvent(next);

    expect(subject.getText()).toBe(control.getText());
    expect(subject.exportEventGraph()).toEqual(control.exportEventGraph());
    expect(subject.getReplayStats()).toEqual(control.getReplayStats());
  });

  it("preserves checkpoint-seeded replay state metrics after rollback", () => {
    const subject = new EgWalkerReplica("subject");
    const control = new EgWalkerReplica("control");
    const root = insertEvent("root:0", [], 0, "abcdef");
    const deletion = deleteEvent("delete:0", [root.id], 0, 5);
    const left = insertEvent("left:0", [root.id], 6, "L");
    subject.applyRemoteEvents([root, deletion, left]);
    control.applyRemoteEvents([root, deletion, left]);
    const before = subject.getReplayStats();
    const valid = insertEvent("right:0", [root.id], 0, "R");
    const invalid = insertEvent("bad:0", [valid.id], 99, "!");

    expect(before.sequenceRecordCount).toBe(3);
    expect(() => subject.applyRemoteEvents([valid, invalid])).toThrow(
      /exceeds parent document length/,
    );
    expect(subject.getReplayStats()).toEqual(before);
    expect(subject.getText()).toBe("fL");

    const merge = insertEvent("merge:0", [deletion.id, left.id], 2, "M");
    subject.applyRemoteEvent(merge);
    control.applyRemoteEvent(merge);

    expect(subject.getText()).toBe(control.getText());
    expect(subject.exportEventGraph()).toEqual(control.exportEventGraph());
    expect(subject.getReplayStats()).toEqual(control.getReplayStats());
  });

  it("restores pending descendants flushed before a later batch failure", () => {
    const replica = new EgWalkerReplica("receiver");
    const root = insertEvent("a:0", [], 0, "a");
    const bufferedChild = insertEvent("child:0", [root.id], 1, "c");
    const invalidSibling = insertEvent("z:0", [root.id], 99, "z");
    replica.applyRemoteEvent(bufferedChild);
    const beforeStats = replica.getReplayStats();

    expect(() => replica.applyRemoteEvents([root, invalidSibling])).toThrow();

    expect(replica.exportEventGraph()).toEqual([]);
    expect(replica.getText()).toBe("");
    expect(replica.getPendingRemoteCount()).toBe(1);
    expect(replica.getReplayStats()).toEqual(beforeStats);
    replica.applyRemoteEvent(root);
    expect(replica.getText()).toBe("ac");
  });

  it("rejects conflicting duplicate IDs before applying a valid prefix", () => {
    const first = insertEvent("alice:0", [], 0, "a");
    const conflicting = insertEvent("alice:0", [], 0, "b");
    const replica = new EgWalkerReplica("receiver");

    expect(() => replica.applyRemoteEvents([first, conflicting])).toThrow(
      /conflicts with an existing ID/,
    );
    expect(replica.exportEventGraph()).toEqual([]);
    expect(replica.getText()).toBe("");
  });

  it("rejects a cycle introduced through an existing buffered event", () => {
    const replica = new EgWalkerReplica("receiver");
    const buffered = insertEvent("buffered:0", ["candidate:0"], 0, "b");
    const candidate = insertEvent("candidate:0", [buffered.id], 0, "c");
    replica.applyRemoteEvent(buffered);

    expect(() => replica.applyRemoteEvent(candidate)).toThrow(/causal cycle/);
    expect(replica.getPendingRemoteCount()).toBe(1);
    expect(replica.exportEventGraph()).toEqual([]);
    expect(replica.getText()).toBe("");
  });

  it("copies accepted events and handles a 4,000-event reverse chain", () => {
    const events = Array.from({ length: 4_000 }, (_, index) =>
      insertEvent(
        `deep:${index}`,
        index === 0 ? [] : [`deep:${index - 1}`],
        index,
        "x",
      ),
    );
    const replica = new EgWalkerReplica("receiver");

    replica.applyRemoteEvents([...events].reverse());
    (events[0]!.parentVersion as Set<string>).add("mutated:parent");
    (events[0]!.operation as { text: string }).text = "changed";

    expect(replica.getPendingRemoteCount()).toBe(0);
    expect(replica.getText()).toBe("x".repeat(events.length));
    expect(replica.exportEventGraph()[0]).toMatchObject({
      parentVersion: new Set(),
      operation: { text: "x" },
    });
  }, 15_000);
});
