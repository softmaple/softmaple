import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../constants/operation-types";
import { RemoteEventBuffer } from "../core/internals/remote-event-buffer";
import { EventGraph } from "../graph/event-graph";
import { APPLY_REMOTE_EVENT_STATUS, type GraphEvent } from "../types";

describe("RemoteEventBuffer transactions", () => {
  it("should journal only keys touched by an unrelated orphan", () => {
    // Arrange
    const buffer = createBuffer();
    const existingCount = 1_600;
    for (let index = 0; index < existingCount; index++) {
      buffer.tryAccept(orphan(`existing:${index}`, `missing:${index}`));
    }
    const transaction = buffer.beginTransaction();
    const candidate = orphan("candidate:0", "candidate-parent:0");

    // Act
    buffer.tryAccept(candidate);

    // Assert
    expect(transaction.touchedEntryCount).toBe(2);
    expect(buffer.pendingCount).toBe(existingCount + 1);
    transaction.rollback();
    expect(buffer.pendingCount).toBe(existingCount);
    expect(buffer.getBufferedEvent(candidate.id)).toBeUndefined();
    expect(buffer.getBufferedEvent("existing:1599")).toBeDefined();
  });

  it("should append to one hot missing-parent bucket without copying it", () => {
    // Arrange
    const buffer = createBuffer();
    const missingParent = "missing:shared";
    for (let index = 0; index < 1_600; index++) {
      buffer.tryAccept(orphan(`existing:${index}`, missingParent));
    }
    const buckets = pendingBuckets(buffer);
    const bucketBefore = buckets.get(missingParent);
    const transaction = buffer.beginTransaction();

    // Act
    buffer.tryAccept(orphan("candidate:0", missingParent));

    // Assert
    expect(buckets.get(missingParent)).toBe(bucketBefore);
    expect(bucketBefore).toHaveLength(1_601);
    expect(transaction.touchedEntryCount).toBe(2);
    transaction.rollback();
    expect(buckets.get(missingParent)).toBe(bucketBefore);
    expect(bucketBefore).toHaveLength(1_600);
    expect(buffer.pendingCount).toBe(1_600);
  });

  it("should restore existing pending entries after a flushed transaction", () => {
    // Arrange
    const buffer = createBuffer();
    const child = orphan("child:0", "parent:0");
    buffer.tryAccept(child);
    const transaction = buffer.beginTransaction();

    // Act
    const result = buffer.tryAccept(root("parent:0"));

    // Assert
    expect(result.status).toBe(APPLY_REMOTE_EVENT_STATUS.Integrated);
    expect(buffer.pendingCount).toBe(0);
    transaction.rollback();
    expect(buffer.pendingCount).toBe(1);
    expect(buffer.getBufferedEvent(child.id)).toEqual(child);
  });

  it("should make commit final and reject nested transactions", () => {
    // Arrange
    const buffer = createBuffer();
    const transaction = buffer.beginTransaction();

    // Act and assert
    expect(() => buffer.beginTransaction()).toThrow(/already active/);
    transaction.commit();
    transaction.commit();
    transaction.rollback();
    expect(() => buffer.beginTransaction()).not.toThrow();
  });

  it("should reject a duplicate while its first copy is buffered", () => {
    // Arrange
    const buffer = createBuffer();
    const event = orphan("child:0", "parent:0");
    buffer.tryAccept(event);

    // Act
    const result = buffer.tryAccept(event);

    // Assert
    expect(result.status).toBe(APPLY_REMOTE_EVENT_STATUS.Duplicate);
    expect(buffer.pendingCount).toBe(1);
  });
});

// Helpers

const createBuffer = (): RemoteEventBuffer =>
  new RemoteEventBuffer({
    graph: new EventGraph(),
    advanceWithEvent: () => ({ operation: null, exact: true }),
  });

const orphan = (id: string, missingParent: string): GraphEvent => ({
  id,
  parentVersion: new Set([missingParent]),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "x" },
  timestamp: 0,
});

const root = (id: string): GraphEvent => ({
  id,
  parentVersion: new Set(),
  operation: { type: OPERATION_TYPE.INSERT, index: 0, text: "p" },
  timestamp: 0,
});

const pendingBuckets = (
  buffer: RemoteEventBuffer,
): ReadonlyMap<string, GraphEvent[]> =>
  (
    buffer as unknown as {
      readonly pendingByMissingParent: ReadonlyMap<string, GraphEvent[]>;
    }
  ).pendingByMissingParent;
