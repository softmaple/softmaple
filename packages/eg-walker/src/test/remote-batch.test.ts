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

describe("EgWalkerReplica.applyRemoteEvents", () => {
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
