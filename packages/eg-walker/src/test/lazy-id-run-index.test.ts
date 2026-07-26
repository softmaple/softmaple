import { describe, expect, it, vi } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { LazyIdRunIndex } from "../graph/columnar-codec/lazy-id-run-index";
import type { IdRun } from "../graph/columnar-codec/types";
import { EventGraph } from "../graph/event-graph";

const run = (
  replicaId: string,
  startSequence: number,
  startEventOffset: number,
  length: number,
  custom = false,
): IdRun => ({
  replicaId,
  startSequence,
  startEventOffset,
  length,
  custom,
});

describe("LazyIdRunIndex", () => {
  it("resolves canonical and custom runs without expanding them", () => {
    const index = new LazyIdRunIndex(
      [
        run("alice", 40, 0, 3),
        run("legacy-id", 0, 3, 1, true),
        run("bob", 7, 4, 2),
        run("alice", 100, 6, 2),
      ],
      8,
    );

    expect(index.count).toBe(8);
    expect(Array.from(index.iterateIds())).toEqual([
      "alice:40",
      "alice:41",
      "alice:42",
      "legacy-id",
      "bob:7",
      "bob:8",
      "alice:100",
      "alice:101",
    ]);
    expect(index.idAt(0)).toBe("alice:40");
    expect(index.idAt(3)).toBe("legacy-id");
    expect(index.idAt(7)).toBe("alice:101");
    expect(index.idAt(-1)).toBeUndefined();
    expect(index.idAt(8)).toBeUndefined();
    expect(index.idAt(1.5)).toBeUndefined();
    expect(index.canonicalRunAt(0)).toMatchObject({
      replicaId: "alice",
      startSequence: 40,
      startEventOffset: 0,
      length: 3,
    });
    expect(index.canonicalRunAt(2)).toBe(index.canonicalRunAt(0));
    expect(index.canonicalRunAt(3)).toBeUndefined();
    expect(index.canonicalRunAt(7)).toMatchObject({
      replicaId: "alice",
      startSequence: 100,
      startEventOffset: 6,
      length: 2,
    });
    expect(index.canonicalRunAt(-1)).toBeUndefined();
    expect(index.canonicalRunAt(8)).toBeUndefined();
    index.releaseCanonicalRunLookup();
    expect(index.canonicalRunAt(2)).toBe(index.canonicalRunAt(0));
    expect(index.offsetOf("alice:41")).toBe(1);
    expect(index.offsetOf("legacy-id")).toBe(3);
    expect(index.offsetOf("alice:99")).toBeUndefined();
    expect(index.has("bob:8")).toBe(true);
    expect(index.maximumSequenceForReplica("alice")).toBe(101);
    expect(index.maximumSequenceForReplica("missing")).toBeUndefined();

    const parseableCustom = new LazyIdRunIndex(
      [run("alice:500", 0, 0, 1, true)],
      1,
    );
    expect(parseableCustom.maximumSequenceForReplica("alice")).toBe(500);
  });

  it("strictly rejects collisions without building a per-event map", () => {
    expect(
      () =>
        new LazyIdRunIndex(
          [run("alice", 0, 0, 3), run("bob", 0, 3, 1), run("alice", 2, 4, 2)],
          6,
        ),
    ).toThrow("Duplicate event ID in columnar graph: alice:2");

    expect(
      () =>
        new LazyIdRunIndex(
          [run("duplicate", 0, 0, 1, true), run("duplicate", 0, 1, 1, true)],
          2,
        ),
    ).toThrow("Duplicate event ID in columnar graph: duplicate");

    expect(
      () =>
        new LazyIdRunIndex(
          [run("alice", 4, 0, 2), run("alice:5", 0, 2, 1, true)],
          3,
        ),
    ).toThrow("Duplicate event ID in columnar graph: alice:5");
  });

  it("rejects malformed or incomplete run layouts", () => {
    expect(() => new LazyIdRunIndex([run("alice", 0, 1, 1)], 1)).toThrow(
      "Invalid ID run 0",
    );
    expect(() => new LazyIdRunIndex([run("", 0, 0, 1)], 1)).toThrow(
      "Invalid event ID in run 0",
    );
    expect(() => new LazyIdRunIndex([run("custom", 0, 0, 2, true)], 2)).toThrow(
      "Custom id run must have length 1",
    );
    expect(() => new LazyIdRunIndex([run("alice", 0, 0, 1)], 2)).toThrow(
      "ID runs cover 1 events but graph contains 2",
    );
  });
});

describe("lazy exact-linear EGW3 IDs", () => {
  it("round-trips mixed ID runs and indexes a mutable tail", () => {
    const ids = ["alice:8", "alice:9", "legacy", "bob:3", "alice:20"];
    const source = new EventGraph();
    ids.forEach((id, offset) => {
      source.addEvent({
        id,
        parentVersion: offset === 0 ? new Set() : new Set([ids[offset - 1]!]),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: offset,
          text: "x",
        },
        timestamp: offset,
      });
    });

    const codec = new ColumnarEventGraphCodec();
    const decoded = codec.decodeBinary(codec.encodeBinary(source));
    expect(Array.from(decoded.iterateEventIdsInInsertionOrder())).toEqual(ids);
    expect(decoded.getEvent("legacy")?.parentVersion).toEqual(
      new Set(["alice:9"]),
    );
    expect(decoded.getMaximumSequenceForReplica("alice")).toBe(20);
    expect(decoded.getMaximumSequenceForReplica("bob")).toBe(3);

    decoded.addEvent({
      id: "alice:50",
      parentVersion: new Set(["alice:20"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "!" },
      timestamp: 5,
    });
    expect(decoded.getMaximumSequenceForReplica("alice")).toBe(50);
  });

  it("keeps branching payload behavior on the materialized ID path", () => {
    const source = new EventGraph();
    source.addEvent({
      id: "alice:2",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 0,
    });
    source.addEvent({
      id: "alice:7",
      parentVersion: new Set(["alice:2"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "L" },
      timestamp: 1,
    });
    source.addEvent({
      id: "bob:4",
      parentVersion: new Set(["alice:2"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "R" },
      timestamp: 2,
    });

    const codec = new ColumnarEventGraphCodec();
    const decoded = codec.decodeBinary(codec.encodeBinary(source));
    expect(decoded.getTopologicalOrder()).toEqual(source.getTopologicalOrder());
    expect(decoded.getMaximumSequenceForReplica("alice")).toBe(7);
    expect(decoded.getMaximumSequenceForReplica("bob")).toBe(4);
  });

  it("infers the next local sequence without expanding linear IDs", () => {
    const source = new EventGraph();
    source.addEvent({
      id: "alice:8",
      parentVersion: new Set(),
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      timestamp: 0,
    });
    source.addEvent({
      id: "alice:9",
      parentVersion: new Set(["alice:8"]),
      operation: { type: OPERATION_TYPE.INSERT, index: 1, text: "B" },
      timestamp: 1,
    });
    const codec = new ColumnarEventGraphCodec();
    const decoded = codec.decodeBinary(codec.encodeBinary(source));
    const iterateIds = vi
      .spyOn(decoded, "iterateEventIdsInInsertionOrder")
      .mockImplementation(() => {
        throw new Error("linear IDs were expanded");
      });

    try {
      const restored = new EgWalkerReplica("alice", "", decoded);
      restored.insert(2, "!");

      expect(restored.exportEventGraph().at(-1)?.id).toBe("alice:10");
      expect(iterateIds).not.toHaveBeenCalled();
    } finally {
      iterateIds.mockRestore();
    }
  });
});
