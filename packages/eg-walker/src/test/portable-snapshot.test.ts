import { describe, expect, it, vi } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import {
  PORTABLE_SNAPSHOT_FORMAT_VERSION,
  validatePortableSnapshotHeaderOnly,
  type PortableSnapshot,
} from "../core/portable-snapshot";
import { PortableSnapshotCodec } from "../core/portable-snapshot-codec";
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
  it("adopts successful validation work once without counting it as a live full replay", async () => {
    const source = createConcurrentReplica();
    const codec = new PortableSnapshotCodec();
    const snapshot = codec.decode(
      codec.encode(source.createPortableSnapshot()).slice(),
    );
    const restored = EgWalkerReplica.fromPortableSnapshot(snapshot, "reader");
    expect(restored.getReplayStats().replayedEvents).toBe(0);
    await restored.prepare();
    const prepared = restored.getReplayStats();
    expect(prepared).toMatchObject({
      snapshotValidationEvents: concurrentEvents.length,
      replayedEvents: concurrentEvents.length,
      fullReplayEvents: 0,
      partialReplayEvents: 0,
    });
    expect(prepared.lifetimeRetreats).toBeGreaterThan(0);
    await restored.prepare();
    expect(restored.getReplayStats()).toEqual(prepared);
    restored.insert(0, "!");
    expect(restored.getReplayStats().replayedEvents).toBe(
      concurrentEvents.length,
    );
    expect(restored.getReplayStats().lifetimeRetreats).toBeGreaterThanOrEqual(
      prepared.lifetimeRetreats,
    );
  });

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

  it("answers text reads before lazily decoding the columnar graph", () => {
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

  it("restores within maxEvents and rejects a larger snapshot before decoding its graph", () => {
    // Arrange
    const snapshot = createConcurrentReplica().createPortableSnapshot();
    const unreadableGraph = { ...snapshot, eventGraph: new Uint8Array([0xff]) };
    const count = snapshot.eventCount;

    // Act
    const restored = EgWalkerReplica.fromPortableSnapshot(snapshot, "r", {
      maxEvents: count,
    });
    const restoreOverLimit = () =>
      EgWalkerReplica.fromPortableSnapshot(unreadableGraph, "r", {
        maxEvents: count - 1,
      });

    // Assert
    expect(restored.exportEventGraph()).toHaveLength(count);
    expect(restoreOverLimit).toThrow(
      `Graph event count ${count} exceeds the limit of ${count - 1} events`,
    );
  });

  it("rejects a graph that declares more events than the snapshot header", () => {
    // Arrange
    const snapshot = createConcurrentReplica().createPortableSnapshot();
    const count = snapshot.eventCount;
    const restored = EgWalkerReplica.fromPortableSnapshot({
      ...snapshot,
      eventCount: count - 1,
    });

    // Act
    const exportGraph = () => restored.exportEventGraph();

    // Assert
    expect(exportGraph).toThrow(
      `Graph event count ${count} exceeds the limit of ${count - 1} events`,
    );
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
    const generatedPacked = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRange",
    );

    try {
      // Act
      const decoded = codec.decode(
        codec.encode(source.createPortableSnapshot()),
      );
      const restored = EgWalkerReplica.fromPortableSnapshot(decoded);
      restored.exportEventGraph();

      // Assert
      expect(generated).not.toHaveBeenCalled();
      expect(generatedPacked).not.toHaveBeenCalled();
      expect(restored.getReplayStats().snapshotValidationReplays).toBe(0);
    } finally {
      generated.mockRestore();
      generatedPacked.mockRestore();
    }
  });

  it("semantically validates bytes whose trusted identity was not preserved", () => {
    // Arrange
    const source = createConcurrentReplica();
    const codec = new PortableSnapshotCodec();
    const bytes = codec.encode(source.createPortableSnapshot()).slice();
    const generated = vi.spyOn(EgWalkerEngine.prototype, "generate");
    const generatedPacked = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRange",
    );

    try {
      // Act
      const restored = EgWalkerReplica.fromPortableSnapshot(
        codec.decode(bytes),
      );
      restored.exportEventGraph();

      // Assert: one sectioned packed replay, the same one a cold load runs.
      expect(generated).not.toHaveBeenCalled();
      expect(generatedPacked).toHaveBeenCalledOnce();
      expect(restored.getReplayStats()).toMatchObject({
        snapshotValidationReplays: 1,
        snapshotValidationEvents: concurrentEvents.length,
        fullReplays: 0,
      });
    } finally {
      generated.mockRestore();
      generatedPacked.mockRestore();
    }
  });

  it("keeps the validation replay for the first concurrent edit", () => {
    // Arrange: a shared root, then one long branch the snapshot has seen.
    const events: GraphEvent[] = [root];
    for (let index = 0; index < 64; index++) {
      events.push({
        id: `alice:${index + 1}`,
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "a" },
        parentVersion: new Set([events[events.length - 1]!.id]),
        timestamp: index + 2,
      });
    }
    const source = new EgWalkerReplica("source");
    source.applyRemoteEvents(events);
    const codec = new PortableSnapshotCodec();
    const bytes = codec.encode(source.createPortableSnapshot()).slice();
    const late: GraphEvent = {
      id: "bob:0",
      operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "B" },
      parentVersion: new Set(["alice:54"]),
      timestamp: 100,
    };
    const reference = new EgWalkerReplica("reference");
    reference.applyRemoteEvents([...events, late]);

    // Act
    const restored = EgWalkerReplica.fromPortableSnapshot(codec.decode(bytes));
    restored.applyRemoteEvent(late);

    // Assert: validation left checkpoints behind, so the concurrent edit
    // replays only the divergent suffix.
    expect(restored.getText()).toBe(reference.getText());
    expect(restored.getReplayStats()).toMatchObject({
      snapshotValidationReplays: 1,
      fullReplays: 0,
      partialReplays: 1,
    });
  });

  it("restores the lazy state when the validation replay fails", () => {
    // Arrange
    const source = createConcurrentReplica();
    const snapshot = source.createPortableSnapshot();
    const restored = EgWalkerReplica.fromPortableSnapshot({
      ...snapshot,
      text: `${snapshot.text}?`,
    });
    const statsBefore = restored.getReplayStats();

    // Act and assert
    expect(() => restored.insert(0, "!")).toThrow(/materialized text mismatch/);
    expect(restored.getText()).toBe(`${snapshot.text}?`);
    expect(restored.getFrontier()).toEqual(new Set(snapshot.currentVersion));
    expect(restored.getReplayStats()).toEqual(statsBefore);
    expect(() => restored.applyRemoteEvent(concurrentEvents[1]!)).toThrow(
      /materialized text mismatch/,
    );
  });

  it("proves an untrusted snapshot with the sectioned cold replay when encoding", () => {
    // Arrange: a structurally equal copy carries no validation proof.
    const snapshot = { ...createConcurrentReplica().createPortableSnapshot() };
    const generated = vi.spyOn(EgWalkerEngine.prototype, "generate");
    const generatedPacked = vi.spyOn(
      EgWalkerEngine.prototype,
      "generatePackedSectionRange",
    );

    try {
      // Act
      const decoded = new PortableSnapshotCodec().decode(
        new PortableSnapshotCodec().encode(snapshot),
      );

      // Assert
      expect(decoded.text).toBe(snapshot.text);
      expect(generated).not.toHaveBeenCalled();
      expect(generatedPacked).toHaveBeenCalledOnce();
    } finally {
      generated.mockRestore();
      generatedPacked.mockRestore();
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

  it("excludes all native runtime state from the object and columnar graph", () => {
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
      /columnar graph: checksum mismatch/,
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
