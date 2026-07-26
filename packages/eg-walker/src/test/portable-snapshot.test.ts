import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  PORTABLE_SNAPSHOT_FORMAT_VERSION,
  PortableSnapshotCodec,
  validatePortableSnapshotHeaderOnly,
  type PortableSnapshot,
} from "../core/portable-snapshot";
import { EgWalkerReplica } from "../core/replica";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { EventGraph } from "../graph/event-graph";
import { BinaryWriter, encodeText } from "../graph/internals/binary-io";
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

  it("preserves application graph metadata", () => {
    const graph = EventGraph.fromEvents(concurrentEvents);
    graph.setMetadata({
      documentId: "doc-42",
      nested: { stable: true },
    });
    const source = new EgWalkerReplica("receiver", "", graph);
    const codec = new PortableSnapshotCodec();

    const decoded = codec.decode(codec.encode(source.createPortableSnapshot()));
    const restored = EgWalkerReplica.fromPortableSnapshot(decoded, "receiver");

    expect(restored.serialize().eventGraph.metadata).toMatchObject({
      documentId: "doc-42",
      nested: { stable: true },
    });
  });

  it("rejects runtime metadata when creating a portable snapshot", () => {
    const graph = EventGraph.fromEvents(concurrentEvents);
    graph.setMetadata({ replayCache: { records: [] } });
    const source = new EgWalkerReplica("receiver", "", graph);

    expect(() => source.createPortableSnapshot()).toThrow(
      /runtime metadata replayCache is forbidden/,
    );
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

  it("detaches lazy graph bytes from the decoded snapshot", () => {
    // Arrange
    const source = createConcurrentReplica();
    const codec = new PortableSnapshotCodec();
    const decoded = codec.decode(codec.encode(source.createPortableSnapshot()));

    // Act
    const restored = EgWalkerReplica.fromPortableSnapshot(decoded);
    decoded.eventGraph.fill(0);

    // Assert
    expect(restored.getText()).toBe(source.getText());
    expect(restored.exportEventGraph()).toEqual(source.exportEventGraph());
  });

  it("reuses validation provenance across a trusted codec round-trip", () => {
    // Arrange
    const source = createConcurrentReplica();
    const codec = new PortableSnapshotCodec();
    const generated = vi.spyOn(EgWalkerEngine.prototype, "generate");

    try {
      // Act
      const decoded = codec.decode(
        codec.encode(source.createPortableSnapshot()),
      );
      const restored = EgWalkerReplica.fromPortableSnapshot(decoded);
      restored.exportEventGraph();

      // Assert
      expect(generated).not.toHaveBeenCalled();
    } finally {
      generated.mockRestore();
    }
  });

  it("semantically validates bytes whose trusted identity was not preserved", () => {
    // Arrange
    const source = createConcurrentReplica();
    const codec = new PortableSnapshotCodec();
    const bytes = codec.encode(source.createPortableSnapshot()).slice();
    const generated = vi.spyOn(EgWalkerEngine.prototype, "generate");

    try {
      // Act
      const restored = EgWalkerReplica.fromPortableSnapshot(
        codec.decode(bytes),
      );
      restored.exportEventGraph();

      // Assert
      expect(generated).toHaveBeenCalledOnce();
    } finally {
      generated.mockRestore();
    }
  });

  it("does not trust a snapshot after its graph bytes are mutated", () => {
    // Arrange
    const snapshot = createConcurrentReplica().createPortableSnapshot();
    snapshot.eventGraph.fill(0);

    // Act and assert
    expect(() => new PortableSnapshotCodec().encode(snapshot)).toThrow(
      /columnar graph|header/,
    );
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
    expect(() => codec.decode(new Uint8Array())).toThrow(
      /missing EGWP1 header/,
    );
    const malformedWriter = new BinaryWriter();
    malformedWriter.writeString("{");
    malformedWriter.writeBytes(new Uint8Array());
    const malformedBody = malformedWriter.toUint8Array();
    const magic = encodeText(PORTABLE_SNAPSHOT_FORMAT_VERSION);
    const malformedHeader = new Uint8Array(magic.length + malformedBody.length);
    malformedHeader.set(magic);
    malformedHeader.set(malformedBody, magic.length);
    expect(() => codec.decode(malformedHeader)).toThrow(
      /malformed JSON header/,
    );
    const badMagic = encoded.slice();
    badMagic[0] = badMagic[0]! ^ 0xff;
    expect(() => codec.decode(badMagic)).toThrow(/missing EGWP1 header/);

    const trailing = new Uint8Array(encoded.length + 1);
    trailing.set(encoded);
    expect(() => codec.decode(trailing)).toThrow(/trailing bytes/);
  });

  it("rejects malformed portable header fields before graph decoding", () => {
    // Arrange
    const snapshot = createConcurrentReplica().createPortableSnapshot();
    const validate = (change: Readonly<Record<string, unknown>>) => () =>
      validatePortableSnapshotHeaderOnly({
        ...snapshot,
        ...change,
      } as PortableSnapshot);

    // Act and assert
    expect(validate({ formatVersion: "EGWP0" })).toThrow(/format version/);
    expect(validate({ text: 1 })).toThrow(/text fields/);
    expect(validate({ eventCount: -1 })).toThrow(/eventCount/);
    expect(validate({ nextSequenceNumber: -1 })).toThrow(/nextSequenceNumber/);
    expect(validate({ eventGraph: [] })).toThrow(/eventGraph/);
    expect(validate({ currentVersion: "remote:0" })).toThrow(
      /must be an array/,
    );
    expect(validate({ currentVersion: [root.id, root.id] })).toThrow(/invalid/);
  });
});
