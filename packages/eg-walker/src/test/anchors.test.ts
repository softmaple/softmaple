import { describe, expect, it } from "vitest";

import {
  captureAnchor,
  createSequenceAnchorApi,
  createSequenceAnchorProjection,
  insertWithAnchors,
  InvalidSequenceAtomError,
  isSequenceAnchor,
  resolveAnchor,
  tryResolveAnchor,
  UnknownSequenceAtomError,
  type SequenceAnchor,
} from "../anchors";
import { NativeSnapshotCodec } from "../core/native-snapshot";
import { PortableSnapshotCodec } from "../core/portable-snapshot";
import { EgWalkerReplica } from "../core/replica";
import type { GraphEvent } from "../types";

describe("captureAnchor", () => {
  it("should batch capture and resolution through one immutable projection", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "A😀BC");
    const reference = bootstrapReplica("alice", "A😀BC");
    const projection = createSequenceAnchorProjection(replica);
    const boundaries = [0, 1, 3, 4, 5];

    // Act
    const batched = boundaries.flatMap((index) =>
      (["before", "after"] as const).map((affinity) => {
        const anchor = projection.captureAnchor(index, affinity);
        return {
          anchor,
          resolved: projection.resolveAnchor(anchor),
        };
      }),
    );
    replica.insert(replica.getText().length, "!");

    // Assert
    expect(projection.text).toBe("A😀BC");
    expect(batched.map(({ resolved }) => resolved)).toEqual(
      boundaries.flatMap((index) => [index, index]),
    );
    expect(batched.map(({ anchor }) => anchor)).toEqual(
      boundaries.flatMap((index) =>
        (["before", "after"] as const).map((affinity) =>
          captureAnchor(reference, index, affinity),
        ),
      ),
    );
  });

  it("should round-trip every visible code-point boundary", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "A😀BC");
    const boundaries = [0, 1, 3, 4, 5];

    // Act
    const resolved = boundaries.flatMap((index) =>
      (["before", "after"] as const).map((affinity) => {
        const anchor = captureAnchor(replica, index, affinity);
        return resolveAnchor(replica, anchor);
      }),
    );

    // Assert
    expect(resolved).toEqual(boundaries.flatMap((index) => [index, index]));
  });

  it("should preserve opposite affinities around an inserted boundary", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "AB");
    const before = captureAnchor(replica, 1, "before");
    const after = captureAnchor(replica, 1, "after");

    // Act
    replica.insert(1, "x");

    // Assert
    expect(resolveAnchor(replica, before)).toBe(2);
    expect(resolveAnchor(replica, after)).toBe(1);
  });

  it("should preserve affinity at the document start and end", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "AB");
    const startBefore = captureAnchor(replica, 0, "before");
    const startAfter = captureAnchor(replica, 0, "after");
    const endBefore = captureAnchor(replica, 2, "before");
    const endAfter = captureAnchor(replica, 2, "after");

    // Act
    replica.insert(0, "x");
    replica.insert(replica.getText().length, "y");

    // Assert
    expect(resolveAnchor(replica, startBefore)).toBe(1);
    expect(resolveAnchor(replica, startAfter)).toBe(0);
    expect(resolveAnchor(replica, endBefore)).toBe(4);
    expect(resolveAnchor(replica, endAfter)).toBe(3);
  });

  it("should preserve affinity after every visible atom is deleted", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "AB");
    replica.delete(0, 2);
    const before = captureAnchor(replica, 0, "before");
    const after = captureAnchor(replica, 0, "after");

    // Act
    replica.insert(0, "x");

    // Assert
    expect(resolveAnchor(replica, before)).toBe(1);
    expect(resolveAnchor(replica, after)).toBe(0);
  });

  it("should reject a boundary inside a surrogate pair", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "😀");

    // Act / Assert
    expect(() => captureAnchor(replica, 1, "before")).toThrow(
      "splits a UTF-16 surrogate pair",
    );
  });

  it("should require event-backed bootstrap content", () => {
    // Arrange
    const replica = new EgWalkerReplica("alice", "legacy seed");

    // Act / Assert
    expect(() => captureAnchor(replica, 0, "after")).toThrow(
      "deterministic bootstrap insert event",
    );
  });
});

describe("resolveAnchor", () => {
  it("should collapse deleted atoms to their nearest surviving boundary", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "ABCDE");
    const before = captureAnchor(replica, 2, "before");
    const after = captureAnchor(replica, 3, "after");

    // Act
    replica.delete(1, 3);

    // Assert
    expect(replica.getText()).toBe("AE");
    expect(resolveAnchor(replica, before)).toBe(1);
    expect(resolveAnchor(replica, after)).toBe(1);
  });

  it("should survive native and portable snapshot round-trips", () => {
    // Arrange
    const source = bootstrapReplica("alice", "A😀BC");
    source.insert(3, "xy");
    source.delete(1, 2);
    const anchor = captureAnchor(source, 2, "before");
    const nativeCodec = new NativeSnapshotCodec();
    const portableCodec = new PortableSnapshotCodec();

    // Act
    const native = EgWalkerReplica.fromNativeSnapshot(
      nativeCodec.decode(
        nativeCodec.encode(
          source.createNativeSnapshot({ resumeCache: "rebuild" }),
        ),
      ),
      "native",
    );
    const portable = EgWalkerReplica.fromPortableSnapshot(
      portableCodec.decode(
        portableCodec.encode(source.createPortableSnapshot()),
      ),
      "portable",
    );

    // Assert
    expect(native.getReplayStats().checkpointCount).toBeGreaterThan(0);
    expect(resolveAnchor(native, anchor)).toBe(2);
    expect(resolveAnchor(portable, anchor)).toBe(2);
  });

  it("should agree after a late old branch uses a critical checkpoint", () => {
    // Arrange
    const base = bootstrapReplica("seed", "AB");
    const bootstrap = base.exportEventGraph()[0]!;
    const left = replicaFromEvents("left", [bootstrap]);
    const right = replicaFromEvents("right", [bootstrap]);
    const late = left.insert(1, "L")!;
    const anchor = captureAnchor(left, 2, "after");
    right.insert(1, "R");
    right.insert(2, "!");
    const rightEvents = right.exportEventGraph().slice(1);

    // Act
    left.applyRemoteEvents(rightEvents.map(cloneEvent));
    right.applyRemoteEvent(cloneEvent(late));

    // Assert
    expect(left.getText()).toBe(right.getText());
    expect(left.getReplayStats().criticalCheckpointHits).toBeGreaterThan(0);
    expect(resolveAnchor(left, anchor)).toBe(resolveAnchor(right, anchor));
  });

  it("should resolve public custom event IDs, including the placeholder spelling", () => {
    // Arrange
    const replica = new EgWalkerReplica("receiver");
    const events: GraphEvent[] = [
      remoteInsert("custom:event", [], 0, "A"),
      remoteInsert("tenant:4", ["custom:event"], 1, "B"),
      remoteInsert("__placeholder__", ["tenant:4"], 2, "C"),
    ];
    for (const event of events) {
      replica.applyRemoteEvent(event);
    }

    // Act
    const anchor = captureAnchor(replica, 2, "before");

    // Assert
    expect(anchor).toMatchObject({
      type: "atom",
      eventId: "__placeholder__",
      offset: 0,
    });
    expect(resolveAnchor(replica, anchor)).toBe(2);
  });

  it("should reject wire anchors that split a surrogate pair", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "😀");
    const insidePair: SequenceAnchor = {
      type: "atom",
      eventId: "alice:0",
      offset: 0,
      affinity: "after",
    };

    // Act / Assert
    expect(() => resolveAnchor(replica, insidePair)).toThrow(
      "splits a UTF-16 surrogate pair",
    );
  });

  it("should treat missing insert events as temporarily unresolved", () => {
    // Arrange — presence can arrive before the document collaboration event.
    const author = bootstrapReplica("alice", "AB");
    const bootstrap = author.exportEventGraph()[0]!;
    author.insert(2, "!");
    const lateInsert = author.exportEventGraph()[1]!;
    const remoteAtom: SequenceAnchor = {
      type: "atom",
      eventId: lateInsert.id,
      offset: 0,
      affinity: "after",
    };
    const receiver = replicaFromEvents("bob", [bootstrap]);

    // Act / Assert
    expect(tryResolveAnchor(receiver, remoteAtom)).toBeNull();
    expect(() => resolveAnchor(receiver, remoteAtom)).toThrow(
      UnknownSequenceAtomError,
    );

    receiver.applyRemoteEvent(cloneEvent(lateInsert));

    expect(tryResolveAnchor(receiver, remoteAtom)).toBe(3);
    expect(resolveAnchor(receiver, remoteAtom)).toBe(3);
  });

  it("should not classify a known event with a bad offset as transient", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "A");
    const malformed: SequenceAnchor = {
      type: "atom",
      eventId: "alice:0",
      offset: 99,
      affinity: "before",
    };

    // Act / Assert
    expect(() => tryResolveAnchor(replica, malformed)).toThrow(
      InvalidSequenceAtomError,
    );
    expect(() => resolveAnchor(replica, malformed)).toThrow(
      InvalidSequenceAtomError,
    );
  });

  it("should keep deleted-atom affinity when resolving through tryResolve", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "ABCDE");
    const before = captureAnchor(replica, 2, "before");
    const after = captureAnchor(replica, 3, "after");
    replica.delete(1, 3);

    // Act / Assert
    expect(tryResolveAnchor(replica, before)).toBe(1);
    expect(tryResolveAnchor(replica, after)).toBe(1);
  });
});

describe("insertWithAnchors", () => {
  it("should return the GraphEvent and stable inserted range", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "AB");

    // Act
    const result = insertWithAnchors(replica, 1, "😀x")!;

    // Assert
    expect(result.event.id).toBe("alice:1");
    expect(result.event.operation).toEqual({
      type: "insert",
      index: 1,
      text: "😀x",
    });
    expect(resolveAnchor(replica, result.range.start)).toBe(1);
    expect(resolveAnchor(replica, result.range.end)).toBe(4);
  });

  it("should expose a detached read-only frontier", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "A");
    const api = createSequenceAnchorApi(replica);
    const frontier = api.getFrontier() as Set<string>;

    // Act
    frontier.clear();
    const result = api.insert(1, "B")!;

    // Assert
    expect(result.event.parentVersion).toEqual(new Set(["alice:0"]));
    expect(api.getFrontier()).toEqual(new Set(["alice:1"]));
  });
});

describe("isSequenceAnchor", () => {
  it("should validate a JSON round-trip without accepting malformed offsets", () => {
    // Arrange
    const replica = bootstrapReplica("alice", "A");
    const anchor = captureAnchor(replica, 0, "before");
    const wire = JSON.parse(JSON.stringify(anchor)) as unknown;
    const malformed: SequenceAnchor = {
      type: "atom",
      eventId: "alice:0",
      offset: -1,
      affinity: "before",
    };

    // Act / Assert
    expect(isSequenceAnchor(wire)).toBe(true);
    expect(isSequenceAnchor(malformed)).toBe(false);
  });
});

// Helpers

const bootstrapReplica = (replicaId: string, text: string): EgWalkerReplica => {
  const replica = new EgWalkerReplica(replicaId);
  replica.insert(0, text);
  return replica;
};

const replicaFromEvents = (
  replicaId: string,
  events: ReadonlyArray<GraphEvent>,
): EgWalkerReplica => {
  const replica = new EgWalkerReplica(replicaId);
  for (const event of events) {
    replica.applyRemoteEvent(cloneEvent(event));
  }
  return replica;
};

const cloneEvent = (event: GraphEvent): GraphEvent => ({
  id: event.id,
  operation: { ...event.operation },
  parentVersion: new Set(event.parentVersion),
  timestamp: event.timestamp,
});

const remoteInsert = (
  id: string,
  parents: ReadonlyArray<string>,
  index: number,
  text: string,
): GraphEvent => ({
  id,
  operation: { type: "insert", index, text },
  parentVersion: new Set(parents),
  timestamp: index,
});
