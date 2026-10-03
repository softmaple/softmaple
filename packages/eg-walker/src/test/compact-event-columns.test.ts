import { describe, expect, it, vi } from "vitest";
import { createCausalEventBatchBuilder } from "../core/causal-event-batch";
import { EgWalkerReplica } from "../core/replica";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { CausalBatchColumns } from "../graph/internals/causal-batch-columns";
import { SpanColumn } from "../graph/internals/span-column";
import type { GraphEvent } from "../types";

const chain = (start: number, count: number): GraphEvent[] =>
  Array.from({ length: count }, (_, index) => {
    const offset = start + index;
    return {
      id: `author:${offset}`,
      parentVersion: new Set(offset === 0 ? [] : [`author:${offset - 1}`]),
      operation: { type: "insert", index: offset, text: "x" },
      timestamp: 1_800_000_000_000 + Math.floor(offset / 3),
    };
  });

const batch = (events: GraphEvent[]) => {
  const builder = createCausalEventBatchBuilder();
  for (const event of events) {
    if (event.operation.type === "insert")
      builder.appendInsert(
        event.id,
        event.parentVersion,
        event.operation.index,
        event.operation.text,
        event.timestamp,
      );
    else
      builder.appendDelete(
        event.id,
        event.parentVersion,
        event.operation.index,
        event.operation.length,
        event.timestamp,
      );
  }
  return builder.finish();
};

describe("compacted event columns", () => {
  it("preserves wide columns and missing timestamp lookups across sealing", () => {
    const columns = new CausalBatchColumns(1_025);
    for (let index = 0; index < 1_025; index++) {
      columns.append(
        `a:${index}`,
        index === 0 ? [] : [`a:${index - 1}`],
        2 ** 40 + index,
        "x",
        1,
        index + 0.5,
      );
    }
    columns.finish();
    const base = columns.packedBase();
    base.compactOperations();
    expect(base.operationIndexAt(1_024)).toBe(2 ** 40 + 1_024);
    expect(base.timestampAt(1_024)).toBe(1_024.5);
    for (const offset of [-1, 0.5, NaN, Infinity, 1_025])
      expect(base.timestampAt(offset)).toBeUndefined();
    const dense = base.materializeOperations();
    expect(dense.operationIndexes).toBeInstanceOf(Float64Array);
    expect(dense.operationLengths).toBeInstanceOf(Uint32Array);
    expect(dense.timestamps).toBeInstanceOf(Float64Array);
    expect(dense.operationIndexes[1_024]).toBe(2 ** 40 + 1_024);
    expect(dense.timestamps[1_024]).toBe(1_024.5);
  });

  it("extends a sealed linear receive, rolls back failure and round-trips its wire format", () => {
    const events = chain(0, 17_003);
    const replica = new EgWalkerReplica("local");
    replica.applyCausalBatch(batch(events));
    expect(replica.exportEventGraph()).toEqual(events);

    const invalid = chain(events.length, 2);
    invalid[1] = {
      ...invalid[1]!,
      operation: { type: "insert", index: 100_000, text: "!" },
    };
    expect(() => replica.applyCausalBatch(batch(invalid))).toThrow();
    expect(replica.exportEventGraph()).toEqual(events);
    expect(replica.getText()).toBe("x".repeat(events.length));

    const suffix = chain(events.length, 17_009);
    replica.applyCausalBatch(batch(suffix));
    const expected = [...events, ...suffix];
    expect(replica.exportEventGraph()).toEqual(expected);
    const codec = new ColumnarEventGraphCodec();
    const restored = codec.decodeBinary(
      codec.encodeBinary(EventGraph.fromEvents(replica.exportEventGraph())),
    );
    expect(restored.serialize().events).toEqual(
      EventGraph.fromEvents(expected).serialize().events,
    );
    replica.insert(0, "!");
    expect(replica.getText()).toBe("!" + "x".repeat(expected.length));
  });

  it("preserves a received branch, its timestamps and a later concurrent edit", () => {
    const events = chain(0, 17_003);
    const peer: GraphEvent = {
      id: "peer:0",
      parentVersion: new Set(["author:500"]),
      operation: { type: "insert", index: 0, text: "!" },
      timestamp: 0.5,
    };
    events.push(peer);
    const subject = new EgWalkerReplica("subject");
    const reference = new EgWalkerReplica("reference");
    subject.applyCausalBatch(batch(events));
    reference.applyRemoteEvents(events);
    expect(subject.getText()).toBe(reference.getText());
    expect(subject.exportEventGraph()).toEqual(reference.exportEventGraph());
    const next: GraphEvent = {
      id: "peer:1",
      parentVersion: new Set(["peer:0"]),
      operation: { type: "insert", index: 1, text: "?" },
      timestamp: -1.5,
    };
    subject.applyRemoteEvent(next);
    reference.applyRemoteEvent(next);
    expect(subject.getText()).toBe(reference.getText());
    expect(subject.exportEventGraph()).toEqual(reference.exportEventGraph());
  });

  it("reads only the requested suffix and reuses truncated tail blocks", () => {
    const events = chain(0, 4_103);
    const graph = EventGraph.fromEvents(events);
    const materialize = vi.spyOn(SpanColumn.prototype, "toArray");
    try {
      const view = graph.getPackedSuffixReplayView(4_090);
      expect(view?.count).toBe(14);
      expect(materialize).not.toHaveBeenCalled();
    } finally {
      materialize.mockRestore();
    }
    const transaction = graph.beginAppendTransaction();
    for (const event of chain(events.length, 2_100)) graph.addEvent(event);
    transaction.rollback();
    for (const event of chain(events.length, 1_100)) graph.addEvent(event);
    expect(Array.from(graph.getAllEvents())).toEqual([
      ...events,
      ...chain(events.length, 1_100),
    ]);
  });
});
