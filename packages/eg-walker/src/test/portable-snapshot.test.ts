import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  PORTABLE_SNAPSHOT_FORMAT_VERSION,
  PortableSnapshotCodec,
  type PortableSnapshot,
} from "../core/portable-snapshot";
import { EgWalkerReplica } from "../core/replica";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import type { GraphEvent } from "../types";

const ROOT_TEXT = "👩‍💻e\u0301";

const root: GraphEvent = {
  id: "remote:0",
  operation: {
    type: OPERATION_TYPE.INSERT,
    index: 0,
    text: ROOT_TEXT,
  },
  parentVersion: new Set(),
  timestamp: 1,
};

const concurrentEvents: ReadonlyArray<GraphEvent> = [
  root,
  {
    id: "alice:0",
    operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
    parentVersion: new Set([root.id]),
    timestamp: 2,
  },
  {
    id: "bob:0",
    operation: {
      type: OPERATION_TYPE.INSERT,
      index: ROOT_TEXT.length,
      text: "B",
    },
    parentVersion: new Set([root.id]),
    timestamp: 3,
  },
];

const createConcurrentReplica = (): EgWalkerReplica => {
  const replica = new EgWalkerReplica("receiver");
  replica.applyRemoteEvents(concurrentEvents);
  return replica;
};

describe("PortableSnapshot", () => {
  it("round-trips Unicode text, frontier, events, and sequence continuation", () => {
    const source = createConcurrentReplica();
    const codec = new PortableSnapshotCodec();
    const snapshot = source.createPortableSnapshot();
    const decoded = codec.decode(codec.encode(snapshot));
    const restored = EgWalkerReplica.fromPortableSnapshot(decoded, "receiver");

    expect(decoded.formatVersion).toBe(PORTABLE_SNAPSHOT_FORMAT_VERSION);
    expect(restored.getText()).toBe(source.getText());
    expect(new Set(decoded.currentVersion)).toEqual(
      new Set(["alice:0", "bob:0"]),
    );
    expect(restored.exportEventGraph()).toEqual(source.exportEventGraph());
    expect(restored.getReplayStats().sequenceRecordCount).toBe(0);

    restored.insert(restored.getText().length, "!");
    expect(restored.getText()).toBe(`${source.getText()}!`);
    expect(restored.exportEventGraph().at(-1)?.id).toBe("receiver:0");
  });

  it("preserves a local author's next sequence number", () => {
    const source = new EgWalkerReplica("author", "base");
    source.insert(4, "🙂");
    source.insert(6, "x");

    const restored = EgWalkerReplica.fromPortableSnapshot(
      source.createPortableSnapshot(),
      "author",
    );
    restored.insert(restored.getText().length, "y");

    expect(restored.exportEventGraph().at(-1)?.id).toBe("author:2");
    expect(restored.getText()).toBe("base🙂xy");
  });

  it("skips IDs owned by the replica selected at restore time", () => {
    const source = new EgWalkerReplica("receiver");
    source.applyRemoteEvent({
      id: "alice:0",
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "A" },
      parentVersion: new Set(),
      timestamp: 1,
    });
    const restored = EgWalkerReplica.fromPortableSnapshot(
      source.createPortableSnapshot(),
      "alice",
    );

    restored.insert(1, "B");

    expect(restored.getText()).toBe("AB");
    expect(restored.exportEventGraph().at(-1)?.id).toBe("alice:1");
  });

  it("answers text reads before lazily decoding the EGW3 graph", () => {
    const source = createConcurrentReplica();
    const codec = new PortableSnapshotCodec();
    const bytes = codec.encode(source.createPortableSnapshot());
    const decode = vi
      .spyOn(ColumnarEventGraphCodec.prototype, "decodeBinary")
      .mockImplementation(() => {
        throw new Error("portable graph decoded");
      });

    try {
      const decoded = codec.decode(bytes);
      const restored = EgWalkerReplica.fromPortableSnapshot(decoded);
      expect(restored.getText()).toBe(source.getText());
      expect(() => restored.exportEventGraph()).toThrow(
        /portable graph decoded/,
      );
    } finally {
      decode.mockRestore();
    }
  });

  it("keeps rejecting a lazy graph after validation fails", () => {
    const source = createConcurrentReplica();
    const snapshot = source.createPortableSnapshot();
    const restored = EgWalkerReplica.fromPortableSnapshot({
      ...snapshot,
      text: `${snapshot.text}!`,
    });

    expect(restored.getText()).toBe(`${snapshot.text}!`);
    expect(() => restored.exportEventGraph()).toThrow(
      /materialized text mismatch/,
    );
    expect(() => restored.exportEventGraph()).toThrow(
      /materialized text mismatch/,
    );
  });

  it("excludes all native runtime state from the object and EGW3 graph", () => {
    const source = createConcurrentReplica();
    const snapshot = source.createPortableSnapshot();
    const graph = new ColumnarEventGraphCodec().decodeBinary(
      snapshot.eventGraph,
    );
    const encodedText = new TextDecoder().decode(
      new PortableSnapshotCodec().encode(snapshot),
    );

    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "currentVersion",
        "eventCount",
        "eventGraph",
        "formatVersion",
        "initialText",
        "nextSequenceNumber",
        "text",
      ].sort(),
    );
    expect(graph.getMetadata()).toEqual({});
    for (const runtimeKey of [
      "sequenceRecords",
      "deleteTargets",
      "checkpoints",
      "replayCache",
    ]) {
      expect(snapshot).not.toHaveProperty(runtimeKey);
      expect(encodedText).not.toContain(runtimeKey);
    }
  });

  it("is smaller than the equivalent JSON graph on a maintained fixture", () => {
    const replica = new EgWalkerReplica("author");
    for (let index = 0; index < 1_000; index++) {
      replica.insert(index, String.fromCharCode(0x61 + (index % 26)));
    }

    const portableBytes = new PortableSnapshotCodec().encode(
      replica.createPortableSnapshot(),
    ).byteLength;
    const jsonBytes = new TextEncoder().encode(
      JSON.stringify(replica.serialize()),
    ).byteLength;

    expect(portableBytes).toBeLessThan(jsonBytes);
  });

  it("rejects header, graph, frontier, count, and text tampering", () => {
    const snapshot = createConcurrentReplica().createPortableSnapshot();
    const codec = new PortableSnapshotCodec();
    const encode =
      (change: Partial<PortableSnapshot>): (() => Uint8Array) =>
      () =>
        codec.encode({ ...snapshot, ...change });

    expect(() => codec.encode(null as never)).toThrow(/expected an object/);
    expect(encode({ text: `${snapshot.text}!` })).toThrow(
      /materialized text mismatch/,
    );
    expect(encode({ currentVersion: [root.id] })).toThrow(/frontier mismatch/);
    expect(encode({ eventCount: snapshot.eventCount + 1 })).toThrow(
      /event count mismatch/,
    );

    const graphCodec = new ColumnarEventGraphCodec();
    const graph = graphCodec.decodeBinary(snapshot.eventGraph);
    graph.setMetadata({ replayCache: { records: [] } });
    expect(encode({ eventGraph: graphCodec.encodeBinary(graph) })).toThrow(
      /runtime metadata replayCache is forbidden/,
    );

    const trailingGraph = new Uint8Array(snapshot.eventGraph.length + 1);
    trailingGraph.set(snapshot.eventGraph);
    expect(encode({ eventGraph: trailingGraph })).toThrow(
      /columnar graph: trailing bytes/,
    );

    const encoded = codec.encode(snapshot);
    const badMagic = encoded.slice();
    badMagic[0] = badMagic[0]! ^ 0xff;
    expect(() => codec.decode(badMagic)).toThrow(/missing EGWP1 header/);

    const trailing = new Uint8Array(encoded.length + 1);
    trailing.set(encoded);
    expect(() => codec.decode(trailing)).toThrow(/trailing bytes/);
  });
});
