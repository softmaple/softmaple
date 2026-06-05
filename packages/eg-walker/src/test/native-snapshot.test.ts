import { describe, expect, it } from "vitest";

import {
  NATIVE_SNAPSHOT_FORMAT_VERSION,
  NativeSnapshotCodec,
} from "../core/native-snapshot";
import { EgWalkerReplica } from "../core/replica";
import { REPLAY_SOURCE } from "../constants/replay-source";
import { sequenceFromRecords } from "../engine/sequence-records";
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
    expect(stats.partialReplays).toBe(1);
    expect(stats.criticalCheckpointHits).toBe(1);
    expect(stats.lastReplaySource).toBe(REPLAY_SOURCE.PARTIAL);
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

  it("should keep runtime records out of the JSON header", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "");
    replica.insert(0, "A");
    replica.insert(1, "B");
    const codec = new NativeSnapshotCodec();

    // Act
    const bytes = codec.encode(replica.createNativeSnapshot());
    const reader = new BinaryReader(bytes.subarray(5));
    const header = JSON.parse(
      new TextDecoder().decode(reader.readBytes(reader.readVarint())),
    ) as Record<string, unknown>;
    const decoded = codec.decode(bytes);

    // Assert
    expect(header.sequenceRecords).toBeUndefined();
    expect(header.deleteTargets).toBeUndefined();
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
