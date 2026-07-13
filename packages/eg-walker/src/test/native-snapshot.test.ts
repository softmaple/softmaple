import { describe, expect, it } from "vitest";

import {
  NATIVE_SNAPSHOT_FORMAT_VERSION,
  NativeSnapshotCodec,
} from "../core/native-snapshot";
import { EgWalkerReplica } from "../core/replica";
import { REPLAY_SOURCE } from "../constants/replay-source";
import {
  EgWalkerEngine,
  type DeleteTargetRecord,
} from "../engine/eg-walker-engine";
import {
  sequenceFromRecords,
  type EngineSequenceRecord,
} from "../engine/sequence-records";
import { EventGraph } from "../graph/event-graph";
import { ColumnarEventGraphCodec } from "../graph/columnar-codec";
import { BinaryReader, BinaryWriter } from "../graph/internals/binary-io";

describe("EgWalkerReplica native snapshots", () => {
  it("should restore readable document state without replaying history", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "Hello");
    replica.insert(5, " world");
    replica.delete(0, 1);

    // Act
    const restored = EgWalkerReplica.fromNativeSnapshot(
      replica.createNativeSnapshot(),
      "alice",
    );

    // Assert
    expect(restored.getText()).toBe("ello world");
    expect(restored.exportEventGraph()).toHaveLength(2);
    expect(restored.getReplayStats().fullReplays).toBe(0);
    expect(restored.getReplayStats().lastReplaySource).toBeNull();
  });

  it("should continue local editing after restoring from a native snapshot", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const restored = EgWalkerReplica.fromNativeSnapshot(
      replica.createNativeSnapshot(),
      "alice",
    );

    // Act
    restored.insert(2, "C");

    // Assert
    expect(restored.getText()).toBe("ABC");
    expect(restored.exportEventGraph().map((event) => event.id)).toContain(
      "alice:2",
    );
    expect(restored.getReplayStats().fullReplays).toBe(0);
  });

  it("should continue local editing after restoring from decoded snapshot bytes", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Act
    restored.insert(2, "C");

    // Assert
    expect(restored.getText()).toBe("ABC");
    expect(restored.exportEventGraph().map((event) => event.id)).toContain(
      "alice:2",
    );
    expect(restored.getReplayStats().fullReplays).toBe(0);
  });

  it("should incrementally apply remote edits after local edits on a restored snapshot", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");
    restored.insert(2, "L");

    // Act
    restored.applyRemoteEvent({
      id: "bob:0",
      parentVersion: new Set(["alice:2"]),
      operation: { type: "insert", index: 3, text: "R" },
      timestamp: 3,
    });

    // Assert
    expect(restored.getText().startsWith("AB")).toBe(true);
    expect(restored.getText()).toContain("L");
    expect(restored.getText()).toContain("R");
    expect(restored.getReplayStats().fullReplays).toBe(0);
    expect(restored.getReplayStats().incrementalApplies).toBe(2);
  });

  it("should fall back when one parent does not cover a restored multi-frontier", () => {
    // Arrange: empty inserts retain the seeded text as a plain-index engine
    // record while leaving a two-event frontier in the snapshot.
    const replica = new EgWalkerReplica("alice", "S");
    replica.applyRemoteEvents([
      {
        id: "alice:0",
        parentVersion: new Set(),
        operation: { type: "insert", index: 0, text: "" },
        timestamp: 0,
      },
      {
        id: "bob:0",
        parentVersion: new Set(),
        operation: { type: "insert", index: 0, text: "" },
        timestamp: 1,
      },
    ]);
    const restored = EgWalkerReplica.fromNativeSnapshot(
      replica.createNativeSnapshot(),
      "alice",
    );

    // Act: alice:0 alone does not causally cover the restored
    // {alice:0, bob:0} engine base.
    restored.applyRemoteEvent({
      id: "alice:1",
      parentVersion: new Set(["alice:0"]),
      operation: { type: "insert", index: 1, text: "A" },
      timestamp: 2,
    });

    // Assert
    const stats = restored.getReplayStats();
    expect(restored.getText()).toBe("SA");
    expect(stats.replayCacheCoverageChecks).toBe(2);
    expect(stats.fullReplays + stats.partialReplays).toBe(1);
  });

  it("should partial replay bounded concurrent remote edits after snapshot restore", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");
    restored.insert(2, "L");

    // Act
    restored.applyRemoteEvent({
      id: "bob:0",
      parentVersion: new Set(["alice:1"]),
      operation: { type: "insert", index: 2, text: "R" },
      timestamp: 3,
    });

    // Assert
    const stats = restored.getReplayStats();
    expect(restored.getText().startsWith("AB")).toBe(true);
    expect(restored.getText()).toContain("L");
    expect(restored.getText()).toContain("R");
    expect(stats.fullReplays).toBe(0);
    expect(stats.partialReplays).toBe(0);
    expect(stats.criticalCheckpointHits).toBe(0);
    expect(stats.lastReplaySource).toBe(REPLAY_SOURCE.INCREMENTAL);
    expect(stats.replayCacheEvents).toBe(2);
  });

  it("should restore retained checkpoints for older bounded concurrent remote edits", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    replica.insert(2, "C");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");
    restored.insert(3, "L");

    // Act
    restored.applyRemoteEvent({
      id: "bob:0",
      parentVersion: new Set(["alice:1"]),
      operation: { type: "insert", index: 2, text: "R" },
      timestamp: 4,
    });

    // Assert
    const stats = restored.getReplayStats();
    expect(decoded.checkpoints.map((checkpoint) => checkpoint.text)).toEqual([
      "A",
      "AB",
      "ABC",
    ]);
    expect(restored.getText().startsWith("AB")).toBe(true);
    expect(restored.getText()).toContain("C");
    expect(restored.getText()).toContain("L");
    expect(restored.getText()).toContain("R");
    expect(stats.fullReplays).toBe(0);
    expect(stats.partialReplays).toBe(1);
    expect(stats.criticalCheckpointHits).toBe(1);
    expect(stats.lastReplaySource).toBe(REPLAY_SOURCE.PARTIAL);
  });

  it("should round-trip through the versioned native snapshot codec", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "Hello");
    replica.insert(5, " snapshot");
    const codec = new NativeSnapshotCodec();

    // Act
    const bytes = codec.encode(replica.createNativeSnapshot());
    const decoded = codec.decode(bytes);
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Assert
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("EGWS1");
    expect(decoded.text).toBe("Hello snapshot");
    expect(decoded.eventCount).toBe(2);
    expect(restored.getText()).toBe("Hello snapshot");
  });

  it("should decode length-prefixed binary snapshots whose header length starts with a JSON object byte", () => {
    // Arrange
    const codec = new NativeSnapshotCodec();
    const header = {
      formatVersion: NATIVE_SNAPSHOT_FORMAT_VERSION,
      text: "x".repeat(13),
      initialText: "",
      currentVersion: [],
      eventCount: 0,
      nextSequenceNumber: 0,
    };
    const body = new BinaryWriter();
    body.writeBytes(new TextEncoder().encode(JSON.stringify(header)));
    body.writeBytes(
      new ColumnarEventGraphCodec().encodeBinary(new EventGraph()),
    );
    const payload = body.toUint8Array();
    const bytes = new Uint8Array(5 + payload.byteLength);
    bytes.set(new TextEncoder().encode(NATIVE_SNAPSHOT_FORMAT_VERSION));
    bytes.set(payload, 5);

    // Act
    const decoded = codec.decode(bytes);
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Assert
    expect(bytes[5]).toBe(0x7b);
    expect(restored.getText()).toBe("x".repeat(13));
  });

  it("should reject lazy binary snapshot graphs whose frontier does not match the header", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    const snapshot = replica.createNativeSnapshot();
    const header = {
      formatVersion: snapshot.formatVersion,
      text: snapshot.text,
      initialText: snapshot.initialText,
      currentVersion: ["missing"],
      eventCount: snapshot.eventCount,
      nextSequenceNumber: snapshot.nextSequenceNumber,
      metadata: snapshot.metadata,
      checkpoints: snapshot.checkpoints,
    };
    const body = new BinaryWriter();
    body.writeBytes(new TextEncoder().encode(JSON.stringify(header)));
    body.writeBytes(
      new ColumnarEventGraphCodec().encodeBinary(
        EventGraph.deserialize(snapshot.eventGraph),
      ),
    );
    const payload = body.toUint8Array();
    const bytes = new Uint8Array(
      NATIVE_SNAPSHOT_FORMAT_VERSION.length + payload.byteLength,
    );
    bytes.set(new TextEncoder().encode(NATIVE_SNAPSHOT_FORMAT_VERSION));
    bytes.set(payload, NATIVE_SNAPSHOT_FORMAT_VERSION.length);
    const codec = new NativeSnapshotCodec();

    // Act
    const decoded = codec.decode(bytes);

    // Assert
    expect(() => decoded.eventGraph).toThrow(
      "Invalid native snapshot: currentVersion does not match event graph frontier",
    );
  });

  it("should persist sequence records for bulk ranked-sequence restore", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();

    // Act
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    const sequence = sequenceFromRecords(decoded.sequenceRecords);

    // Assert
    expect(decoded.sequenceRecords).toEqual([
      {
        id: "alice:0:0",
        eventId: "alice:0",
        content: "AB",
        originLeft: null,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: { replicaId: "alice", startSequence: 0 },
      },
    ]);
    expect(sequence.toArray()).toHaveLength(1);
    expect(sequence.effectIndexBeforePosition(sequence.length)).toBe(2);
  });

  it("should store runtime records outside the JSON header", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    replica.delete(0, 1);
    const codec = new NativeSnapshotCodec();

    // Act
    const bytes = codec.encode(replica.createNativeSnapshot());
    const body = bytes.subarray(NATIVE_SNAPSHOT_FORMAT_VERSION.length);
    const reader = new BinaryReader(body);
    const header = JSON.parse(
      new TextDecoder().decode(reader.readBytes(reader.readVarint())),
    ) as Record<string, unknown>;
    const decoded = codec.decode(bytes);

    // Assert
    expect(header.sequenceRecords).toBeUndefined();
    expect(header.deleteTargets).toBeUndefined();
    expect(decoded.sequenceRecords.map((record) => record.content)).toEqual([
      "A",
      "B",
    ]);
    expect(decoded.deleteTargets).toEqual([
      { deleteEventId: "alice:2", targetIds: ["alice:0:0"] },
    ]);
  });

  it("should optionally compress cold snapshot sections while keeping runtime state hot", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    for (let index = 0; index < 80; index++) {
      replica.insert(replica.getText().length, "x");
    }
    const snapshot = {
      ...replica.createNativeSnapshot(),
      metadata: {
        cold: "metadata/checkpoint section ".repeat(500),
      },
    };
    const codec = new NativeSnapshotCodec();

    // Act
    const bytes = codec.encode(snapshot);
    const body = bytes.subarray(NATIVE_SNAPSHOT_FORMAT_VERSION.length);
    const reader = new BinaryReader(body);
    const headerBytes = reader.readBytes(reader.readVarint());
    reader.readBytes(reader.readVarint());
    const runtimeBytes = reader.readBytes(reader.readVarint());
    const decoded = codec.decode(bytes);
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Assert
    expect(new TextDecoder().decode(headerBytes.subarray(0, 5))).toBe("EGWC1");
    expect(new TextDecoder().decode(runtimeBytes.subarray(0, 5))).toBe("EGWR2");
    expect(decoded.metadata).toEqual(snapshot.metadata);
    expect(restored.getText()).toBe(replica.getText());
    expect(restored.getReplayStats().fullReplays).toBe(0);
  });

  it("should encode runtime state with a versioned compact binary section", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    replica.delete(0, 1);
    const codec = new NativeSnapshotCodec();
    const snapshot = replica.createNativeSnapshot();

    // Act
    const bytes = codec.encode(snapshot);
    const body = bytes.subarray(NATIVE_SNAPSHOT_FORMAT_VERSION.length);
    const reader = new BinaryReader(body);
    reader.readBytes(reader.readVarint());
    reader.readBytes(reader.readVarint());
    const runtimeBytes = reader.readBytes(reader.readVarint());
    const decoded = codec.decode(bytes);

    // Assert
    expect(new TextDecoder().decode(runtimeBytes.subarray(0, 5))).toBe("EGWR2");
    expect(decoded.sequenceRecords).toEqual(snapshot.sequenceRecords);
    expect(decoded.deleteTargets).toEqual(snapshot.deleteTargets);
  });

  it("should decode legacy length-prefixed snapshots with JSON runtime records", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const snapshot = replica.createNativeSnapshot();
    const header = {
      formatVersion: snapshot.formatVersion,
      text: snapshot.text,
      initialText: snapshot.initialText,
      currentVersion: snapshot.currentVersion,
      eventCount: snapshot.eventCount,
      nextSequenceNumber: snapshot.nextSequenceNumber,
      metadata: snapshot.metadata,
      sequenceRecords: snapshot.sequenceRecords,
      deleteTargets: snapshot.deleteTargets,
      checkpoints: snapshot.checkpoints,
    };
    const body = new BinaryWriter();
    body.writeBytes(new TextEncoder().encode(JSON.stringify(header)));
    body.writeBytes(
      new ColumnarEventGraphCodec().encodeBinary(
        EventGraph.deserialize(snapshot.eventGraph),
      ),
    );
    const payload = body.toUint8Array();
    const bytes = new Uint8Array(
      NATIVE_SNAPSHOT_FORMAT_VERSION.length + payload.byteLength,
    );
    bytes.set(new TextEncoder().encode(NATIVE_SNAPSHOT_FORMAT_VERSION));
    bytes.set(payload, NATIVE_SNAPSHOT_FORMAT_VERSION.length);
    const codec = new NativeSnapshotCodec();

    // Act
    const decoded = codec.decode(bytes);
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Assert
    expect(decoded.sequenceRecords).toEqual(snapshot.sequenceRecords);
    expect(restored.getText()).toBe("AB");
    expect(restored.getReplayStats().fullReplays).toBe(0);
  });

  it("should decode legacy binary runtime state without the version prefix", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    replica.delete(0, 1);
    const snapshot = replica.createNativeSnapshot();
    const header = {
      formatVersion: snapshot.formatVersion,
      text: snapshot.text,
      initialText: snapshot.initialText,
      currentVersion: snapshot.currentVersion,
      eventCount: snapshot.eventCount,
      nextSequenceNumber: snapshot.nextSequenceNumber,
      metadata: snapshot.metadata,
      checkpoints: snapshot.checkpoints,
    };
    const body = new BinaryWriter();
    body.writeBytes(new TextEncoder().encode(JSON.stringify(header)));
    body.writeBytes(
      new ColumnarEventGraphCodec().encodeBinary(
        EventGraph.deserialize(snapshot.eventGraph),
      ),
    );
    body.writeBytes(
      encodeLegacyRuntimeState(
        snapshot.sequenceRecords,
        snapshot.deleteTargets,
      ),
    );
    const payload = body.toUint8Array();
    const bytes = new Uint8Array(
      NATIVE_SNAPSHOT_FORMAT_VERSION.length + payload.byteLength,
    );
    bytes.set(new TextEncoder().encode(NATIVE_SNAPSHOT_FORMAT_VERSION));
    bytes.set(payload, NATIVE_SNAPSHOT_FORMAT_VERSION.length);
    const codec = new NativeSnapshotCodec();

    // Act
    const decoded = codec.decode(bytes);
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Assert
    expect(decoded.sequenceRecords).toEqual(snapshot.sequenceRecords);
    expect(decoded.deleteTargets).toEqual(snapshot.deleteTargets);
    expect(restored.getText()).toBe("B");
    expect(restored.getReplayStats().fullReplays).toBe(0);
  });

  it("should fall back to legacy runtime state when legacy bytes collide with EGWR2", () => {
    // Arrange
    const header = {
      formatVersion: NATIVE_SNAPSHOT_FORMAT_VERSION,
      text: "",
      initialText: "",
      currentVersion: [],
      eventCount: 0,
      nextSequenceNumber: 0,
      checkpoints: [],
    };
    const runtimeBytes = encodeCollidingLegacyRuntimeState();
    const body = new BinaryWriter();
    body.writeBytes(new TextEncoder().encode(JSON.stringify(header)));
    body.writeBytes(
      new ColumnarEventGraphCodec().encodeBinary(new EventGraph()),
    );
    body.writeBytes(runtimeBytes);
    const payload = body.toUint8Array();
    const bytes = new Uint8Array(
      NATIVE_SNAPSHOT_FORMAT_VERSION.length + payload.byteLength,
    );
    bytes.set(new TextEncoder().encode(NATIVE_SNAPSHOT_FORMAT_VERSION));
    bytes.set(payload, NATIVE_SNAPSHOT_FORMAT_VERSION.length);
    const codec = new NativeSnapshotCodec();

    // Act
    const decoded = codec.decode(bytes);
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Assert
    expect(new TextDecoder().decode(runtimeBytes.subarray(0, 5))).toBe("EGWR2");
    expect(decoded.sequenceRecords).toEqual([]);
    expect(decoded.deleteTargets).toEqual([]);
    expect(restored.getText()).toBe("");
  });

  it("should persist delete targets for restored engine resume state", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    replica.delete(0, 1);
    const codec = new NativeSnapshotCodec();

    // Act
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");
    restored.insert(1, "C");
    const editedSnapshot = restored.createNativeSnapshot();

    // Assert
    expect(decoded.deleteTargets).toEqual([
      { deleteEventId: "alice:2", targetIds: ["alice:0:0"] },
    ]);
    expect(restored.getText()).toBe("BC");
    expect(restored.getReplayStats().fullReplays).toBe(0);
    expect(editedSnapshot.deleteTargets).toEqual(decoded.deleteTargets);
  });

  it("should carry sequence records through read-only snapshot restore and refresh them after local edits", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Act
    const readOnlySnapshot = restored.createNativeSnapshot();
    restored.insert(2, "C");
    const editedSnapshot = restored.createNativeSnapshot();

    // Assert
    expect(readOnlySnapshot.sequenceRecords).toEqual(decoded.sequenceRecords);
    expect(
      editedSnapshot.sequenceRecords.map((record) => record.content),
    ).toEqual(["ABC"]);
    expect(restored.getReplayStats().fullReplays).toBe(0);
  });

  it("should not share a decoded snapshot graph across restored replicas", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));

    // Act
    const first = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");
    const second = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");
    first.insert(1, "1");

    // Assert
    expect(first.getText()).toBe("A1");
    expect(second.getText()).toBe("A");
    expect(second.exportEventGraph().map((event) => event.id)).not.toContain(
      "alice:1",
    );
  });

  it("should restore decoded snapshots without materializing serialized graph output", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    Object.defineProperty(decoded, "eventGraph", {
      configurable: true,
      get: () => {
        throw new Error("eventGraph should stay lazy on fast restore");
      },
    });

    // Act
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Assert
    expect(restored.getText()).toBe("AB");
    expect(restored.getReplayStats().fullReplays).toBe(0);
  });

  it("should restore decoded snapshots without materializing public runtime record arrays", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    Object.defineProperty(decoded, "sequenceRecords", {
      configurable: true,
      get: () => {
        throw new Error("sequenceRecords should stay compact on fast restore");
      },
    });
    Object.defineProperty(decoded, "deleteTargets", {
      configurable: true,
      get: () => {
        throw new Error("deleteTargets should stay compact on fast restore");
      },
    });

    // Act
    const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");

    // Assert
    expect(restored.getText()).toBe("AB");
    expect(restored.getReplayStats().fullReplays).toBe(0);
  });

  it("should defer restored event indexes for linear local edits", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();
    const decoded = codec.decode(codec.encode(replica.createNativeSnapshot()));
    const originalGetTopologicalOrder =
      EventGraph.prototype.getTopologicalOrder;
    EventGraph.prototype.getTopologicalOrder = () => {
      throw new Error("topological order should stay lazy on linear restore");
    };

    try {
      // Act
      const restored = EgWalkerReplica.fromNativeSnapshot(decoded, "alice");
      restored.insert(2, "C");

      // Assert
      expect(restored.getText()).toBe("ABC");
      expect(restored.getReplayStats().fullReplays).toBe(0);
      expect(restored.getReplayStats().incrementalApplies).toBe(1);
    } finally {
      EventGraph.prototype.getTopologicalOrder = originalGetTopologicalOrder;
    }
  });

  it("should use restored typed-run event ranges for retreating concurrent edits", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "a");
    replica.insert(1, "b");
    replica.insert(2, "c");
    replica.insert(3, "d");
    replica.insert(4, "e");
    replica.insert(5, "f");
    const snapshot = replica.createNativeSnapshot();
    const graph = EventGraph.deserialize(snapshot.eventGraph);
    const remote = {
      id: "bob:0",
      parentVersion: new Set(["alice:2"]),
      operation: { type: "insert" as const, index: 3, text: "B" },
      timestamp: 7,
    };
    graph.addEvent(remote);
    const engine = EgWalkerEngine.fromSnapshotState({
      graph,
      currentVersion: new Set(snapshot.currentVersion),
      text: snapshot.text,
      sequenceRecords: snapshot.sequenceRecords,
      deleteTargets: snapshot.deleteTargets,
    });

    // Act
    const result = engine.applyEvent(remote, graph);

    // Assert
    expect(result.text).toContain("B");
    expect(engine.getStats().retreatCount).toBeGreaterThan(0);
    expect(engine.getStats().sequenceRecordCount).toBeGreaterThan(
      snapshot.sequenceRecords.length,
    );
  });

  it("should reject snapshots whose frontier does not match the event graph", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    const snapshot = {
      ...replica.createNativeSnapshot(),
      currentVersion: ["missing"],
    };

    // Act / Assert
    expect(() => EgWalkerReplica.fromNativeSnapshot(snapshot, "alice")).toThrow(
      "Invalid native snapshot: currentVersion does not match event graph frontier",
    );
  });

  it("should reject bytes without the native snapshot header", () => {
    // Arrange
    const codec = new NativeSnapshotCodec();

    // Act / Assert
    expect(() => codec.decode(new Uint8Array([1, 2, 3]))).toThrow(
      "Invalid native snapshot: missing EGWS1 header",
    );
  });
});

const encodeLegacyRuntimeState = (
  sequenceRecords: ReadonlyArray<EngineSequenceRecord>,
  deleteTargets: ReadonlyArray<DeleteTargetRecord>,
): Uint8Array => {
  const idTable = createRuntimeIdTable(sequenceRecords, deleteTargets);
  const replicaTable = createRuntimeReplicaTable(sequenceRecords);
  const writer = new BinaryWriter();
  writer.writeStringArray(idTable.values);
  writer.writeStringArray(replicaTable.values);
  writer.writeVarint(sequenceRecords.length);
  writer.writeVarintArray(
    sequenceRecords.map((record) => idTable.ids.get(record.id) ?? 0),
  );
  writer.writeVarintArray(
    sequenceRecords.map((record) => idTable.ids.get(record.eventId) ?? 0),
  );
  writer.writeVarintArray(
    sequenceRecords.map((record) =>
      optionalRuntimeId(idTable, record.originLeft),
    ),
  );
  writer.writeVarintArray(
    sequenceRecords.map((record) =>
      optionalRuntimeId(idTable, record.originRight),
    ),
  );
  writer.writeVarintArray(
    sequenceRecords.map((record) => (record.everDeleted ? 1 : 0)),
  );
  writer.writeVarintArray(sequenceRecords.map((record) => record.prepareState));
  writer.writeVarintArray(
    sequenceRecords.map((record) =>
      record.run === null
        ? 0
        : (replicaTable.ids.get(record.run.replicaId) ?? 0) + 1,
    ),
  );
  writer.writeVarintArray(
    sequenceRecords.map((record) => record.run?.startSequence ?? 0),
  );
  writeLegacyContentBlob(writer, sequenceRecords);
  writer.writeVarint(deleteTargets.length);
  for (const target of deleteTargets) {
    writer.writeVarint(idTable.ids.get(target.deleteEventId) ?? 0);
    writer.writeVarintArray(
      target.targetIds.map((targetId) => idTable.ids.get(targetId) ?? 0),
    );
  }
  return writer.toUint8Array();
};

const encodeCollidingLegacyRuntimeState = (): Uint8Array => {
  const writer = new BinaryWriter();
  writer.writeStringArray([
    `WR2${"x".repeat(68)}`,
    ...Array.from({ length: 68 }, (_, index) => `id-${index}`),
  ]);
  writer.writeStringArray([]);
  writer.writeVarint(0);
  for (let index = 0; index < 8; index++) {
    writer.writeVarintArray([]);
  }
  writeLegacyContentBlob(writer, []);
  writer.writeVarint(0);
  return writer.toUint8Array();
};

const createRuntimeIdTable = (
  sequenceRecords: ReadonlyArray<EngineSequenceRecord>,
  deleteTargets: ReadonlyArray<DeleteTargetRecord>,
): { readonly values: string[]; readonly ids: ReadonlyMap<string, number> } => {
  const ids = new Map<string, number>();
  const values: string[] = [];
  const add = (value: string | null): void => {
    if (value === null || ids.has(value)) {
      return;
    }
    ids.set(value, values.length);
    values.push(value);
  };
  for (const record of sequenceRecords) {
    add(record.id);
    add(record.eventId);
    add(record.originLeft);
    add(record.originRight);
  }
  for (const target of deleteTargets) {
    add(target.deleteEventId);
    target.targetIds.forEach(add);
  }
  return { values, ids };
};

const createRuntimeReplicaTable = (
  sequenceRecords: ReadonlyArray<EngineSequenceRecord>,
): { readonly values: string[]; readonly ids: ReadonlyMap<string, number> } => {
  const ids = new Map<string, number>();
  const values: string[] = [];
  for (const record of sequenceRecords) {
    if (record.run === null || ids.has(record.run.replicaId)) {
      continue;
    }
    ids.set(record.run.replicaId, values.length);
    values.push(record.run.replicaId);
  }
  return { values, ids };
};

const optionalRuntimeId = (
  table: { readonly ids: ReadonlyMap<string, number> },
  value: string | null,
): number => (value === null ? 0 : (table.ids.get(value) ?? 0) + 1);

const writeLegacyContentBlob = (
  writer: BinaryWriter,
  records: ReadonlyArray<EngineSequenceRecord>,
): void => {
  const encoder = new TextEncoder();
  const encoded = records.map((record) => encoder.encode(record.content));
  const offsets: number[] = [0];
  for (const content of encoded) {
    offsets.push(offsets[offsets.length - 1]! + content.byteLength);
  }
  const blob = new Uint8Array(offsets[offsets.length - 1]!);
  encoded.reduce((offset, content) => {
    blob.set(content, offset);
    return offset + content.byteLength;
  }, 0);
  writer.writeZigZagDeltaArray(offsets);
  writer.writeBytes(blob);
};
