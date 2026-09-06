import { describe, expect, it, vi } from "vitest";
import { EgWalkerReplica } from "../core/replica";
import { createCausalEventBatchBuilder } from "../core/causal-event-batch";
import { PortableSnapshotCodec } from "../core/portable-snapshot";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import type { GraphEvent } from "../types";

const insert = (
  id: string,
  parents: string[],
  index: number,
  text: string,
): GraphEvent => ({
  id,
  parentVersion: new Set(parents),
  operation: { type: "insert", index, text },
  timestamp: 0,
});

const offline = (depth: number): GraphEvent[] => {
  const events = [insert("root:0", [], 0, "*")];
  for (const branch of ["a", "b"]) {
    for (let i = 0; i < depth; i++) {
      events.push(
        insert(
          `${branch}:${i}`,
          [i === 0 ? "root:0" : `${branch}:${i - 1}`],
          branch === "a" ? 0 : i + 1,
          branch,
        ),
      );
    }
  }
  events.push(insert("merge:0", [`a:${depth - 1}`, `b:${depth - 1}`], 0, "!"));
  return events;
};

const receive = (
  replica: EgWalkerReplica,
  events: GraphEvent[],
  causal: boolean,
): void => {
  if (!causal) {
    replica.applyRemoteEvents(events);
    return;
  }
  const builder = createCausalEventBatchBuilder();
  for (const event of events) {
    const op = event.operation;
    if (op.type === "insert")
      builder.appendInsert(
        event.id,
        event.parentVersion,
        op.index,
        op.text,
        event.timestamp,
      );
    else
      builder.appendDelete(
        event.id,
        event.parentVersion,
        op.index,
        op.length,
        event.timestamp,
      );
  }
  replica.applyCausalBatch(builder.finish());
};

describe("bounded concurrent replay reuse", () => {
  it.each([
    1, 64, 4_096,
  ])("keeps a 4,202-event offline merge warm with batch size %i", (size) => {
    const replica = new EgWalkerReplica("receiver");
    const events = offline(2_100);
    for (let i = 0; i < events.length; i += size) {
      if (size === 1) replica.applyRemoteEvent(events[i]!);
      else replica.applyRemoteEvents(events.slice(i, i + size));
    }
    expect(replica.getText()).toBe(
      `!${"a".repeat(2_100)}*${"b".repeat(2_100)}`,
    );
    const stats = replica.getReplayStats();
    expect(stats.fullReplays + stats.partialReplays).toBeLessThanOrEqual(2);
    expect(stats.replayCacheBytes).toBe(0); // The final merge is a critical cut.
  });

  it.each([
    false,
    true,
  ])("rolls back a warm batch and resumes after an older fork (causal=%s)", (causal) => {
    const replica = new EgWalkerReplica("receiver");
    const events = offline(2_100);
    receive(replica, events.slice(0, -2), causal);
    const text = replica.getText();
    const graph = replica.exportEventGraph();
    const stats = replica.getReplayStats();
    const next = events.at(-2)!;
    expect(() =>
      receive(
        replica,
        [next, insert("invalid:0", [next.id], 100_000, "x")],
        causal,
      ),
    ).toThrow();
    expect(replica.getText()).toBe(text);
    expect(replica.exportEventGraph()).toEqual(graph);
    expect(replica.getReplayStats()).toEqual(stats);
    receive(replica, events.slice(-2), causal);
    // The previous seed no longer covers this independent root. Replay once.
    receive(
      replica,
      [insert("old:0", [], 0, "o"), insert("old:1", ["old:0"], 1, "k")],
      causal,
    );
    const reference = new EgWalkerReplica("reference");
    reference.applyRemoteEvents([
      ...events,
      insert("old:0", [], 0, "o"),
      insert("old:1", ["old:0"], 1, "k"),
    ]);
    expect(replica.getText()).toBe(reference.getText());
  });

  it("handles Unicode deletes and reverse delivery after a cold snapshot", () => {
    const replica = new EgWalkerReplica("source");
    replica.applyRemoteEvent(insert("root:0", [], 0, "*"));
    const codec = new PortableSnapshotCodec();
    const restored = EgWalkerReplica.fromPortableSnapshot(
      codec.decode(codec.encode(replica.createPortableSnapshot()).slice()),
    );
    const events: GraphEvent[] = [];
    for (let i = 0; i < 1_100; i++) {
      for (const branch of ["a", "b"]) {
        const id = `${branch}:${i * 2}`;
        events.push(
          insert(id, [i === 0 ? "root:0" : `${branch}:${i * 2 - 1}`], 1, "🙂"),
        );
        events.push({
          id: `${branch}:${i * 2 + 1}`,
          parentVersion: new Set([id]),
          operation: { type: "delete", index: 1, length: 2 },
          timestamp: 0,
        });
      }
    }
    for (let i = 0; i < events.length; i += 64)
      restored.applyRemoteEvents(events.slice(i, i + 64).reverse());
    expect(restored.getText()).toBe("*");
    expect(restored.getPendingRemoteCount()).toBe(0);
    expect(restored.getReplayStats().replayCacheEvents).toBeGreaterThan(4_096);
    expect(restored.getReplayStats().partialReplays).toBeLessThanOrEqual(2);
    expect(restored.getReplayStats().snapshotValidationReplays).toBe(1);
    expect(restored.getReplayStats().replayCacheBytes).toBeLessThan(
      32 * 1024 * 1024,
    );
  });

  it("releases a concurrent cache at the byte budget even before convergence", () => {
    const replica = new EgWalkerReplica(
      "receiver",
      "x".repeat(16 * 1024 * 1024),
    );
    replica.applyRemoteEvent(insert("a:0", [], 0, "a"));
    replica.applyRemoteEvent(insert("b:0", [], 0, "b"));
    expect(replica.getReplayStats().replayCacheBytes).toBe(0);
    expect(replica.getReplayStats().sequenceRecordCount).toBe(0);
    expect(replica.getText()).toHaveLength(16 * 1024 * 1024 + 2);
  });
});

describe("cold portable validation", () => {
  it("validates a linear Unicode history through packed replay and counts it once", () => {
    const source = new EgWalkerReplica("source", "🙂");
    for (let i = 0; i < 100; i++) source.insert(i + 2, "x");
    source.delete(0, 2);
    const codec = new PortableSnapshotCodec();
    const bytes = codec.encode(source.createPortableSnapshot()).slice();
    const generate = vi.spyOn(EgWalkerEngine.prototype, "generate");
    try {
      const restored = EgWalkerReplica.fromPortableSnapshot(
        codec.decode(bytes),
      );
      expect(restored.getReplayStats().snapshotValidationReplays).toBe(0);
      restored.insert(0, "🙂");
      restored.insert(0, "!");
      expect(restored.getText()).toBe(`!🙂${"x".repeat(100)}`);
      expect(generate).not.toHaveBeenCalled();
      expect(restored.getReplayStats()).toMatchObject({
        snapshotValidationReplays: 1,
        snapshotValidationEvents: 101,
        snapshotValidationLinearReplays: 1,
        fullReplays: 0,
      });
    } finally {
      generate.mockRestore();
    }
  });

  it("still replays a cold concurrent snapshot and rejects a forged linear text", () => {
    const codec = new PortableSnapshotCodec();
    const source = EgWalkerReplica.fromEventGraph("source", offline(32));
    const restored = EgWalkerReplica.fromPortableSnapshot(
      codec.decode(codec.encode(source.createPortableSnapshot()).slice()),
    );
    restored.insert(0, "?");
    expect(restored.getText()).toBe(`?${source.getText()}`);
    expect(restored.getReplayStats()).toMatchObject({
      snapshotValidationReplays: 1,
      snapshotValidationLinearReplays: 0,
    });

    const linear = new EgWalkerReplica("linear", "🙂");
    linear.insert(2, "x");
    const decoded = codec.decode(
      codec.encode(linear.createPortableSnapshot()).slice(),
    );
    const forged = EgWalkerReplica.fromPortableSnapshot({
      ...decoded,
      text: "🙂y",
    });
    expect(() => forged.insert(0, "!")).toThrow(/materialized text mismatch/);
  });
});
