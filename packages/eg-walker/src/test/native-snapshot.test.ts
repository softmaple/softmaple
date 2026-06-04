import { describe, expect, it } from "vitest";

import { NativeSnapshotCodec } from "../core/native-snapshot";
import { EgWalkerReplica } from "../core/replica";

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
    expect(restored.getReplayStats().fullReplays).toBe(1);
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
