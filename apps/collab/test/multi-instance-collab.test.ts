import { afterEach, describe, expect, it } from "vitest";
import {
  createCollabConsistencyHarness,
  type CollabConsistencyHarness,
  type HarnessClient,
} from "./helpers/collabConsistencyHarness";

const ACTOR_A = "00000000-0000-4000-8000-0000000000b1";
const ACTOR_B = "00000000-0000-4000-8000-0000000000b2";

describe("multi-instance collaboration harness", () => {
  let harness: CollabConsistencyHarness | undefined;

  afterEach(async () => {
    await harness?.close();
  });

  it("should keep local peer state isolated across instances while sharing durable history", async () => {
    // Arrange
    harness = createCollabConsistencyHarness();
    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");

    const clientA = await instanceA.connectClient({
      id: "a",
      actorId: ACTOR_A,
    });
    const clientB = await instanceB.connectClient({
      id: "b",
      actorId: ACTOR_B,
    });
    await harness.settle();
    await Promise.all([clientA.waitUntilSynced(), clientB.waitUntilSynced()]);

    // Assert: each instance only tracks its own local peers.
    expect(instanceA.localPeerCount(harness.documentId)).toBe(1);
    expect(instanceB.localPeerCount(harness.documentId)).toBe(1);
    expect(instanceA.room).not.toBe(instanceB.room);
  });

  it("should serialize concurrent writes from different instances into durable order", async () => {
    // Arrange
    harness = createCollabConsistencyHarness();
    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");
    const clientA = await instanceA.connectClient({
      id: "a",
      actorId: ACTOR_A,
    });
    const clientB = await instanceB.connectClient({
      id: "b",
      actorId: ACTOR_B,
    });
    await harness.settle();
    await Promise.all([clientA.waitUntilSynced(), clientB.waitUntilSynced()]);

    // Act: concurrent local edits from independently owned rooms.
    const batchA = clientA.localInsert("A", 0);
    const batchB = clientB.localInsert("B", 0);
    await Promise.all([clientA.flushOutgoing(), clientB.flushOutgoing()]);
    await harness.settle();
    await Promise.all([clientA.waitUntilIdle(), clientB.waitUntilIdle()]);

    // Assert
    expect(harness.store.hasBatch(harness.documentId, batchA.batchId)).toBe(
      true,
    );
    expect(harness.store.hasBatch(harness.documentId, batchB.batchId)).toBe(
      true,
    );
    expect(clientA.conflicts()).toEqual([]);
    expect(clientB.conflicts()).toEqual([]);
    harness.assertReplicasConverged([clientA, clientB]);
  });

  it("should fan out committed events across instances and tolerate duplicate delivery", async () => {
    // Arrange
    harness = createCollabConsistencyHarness();
    harness.setDeliveryMode("deferred");
    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");
    const clientA = await instanceA.connectClient({
      id: "a",
      actorId: ACTOR_A,
    });
    const clientB = await instanceB.connectClient({
      id: "b",
      actorId: ACTOR_B,
    });
    await harness.settle();
    await Promise.all([clientA.waitUntilSynced(), clientB.waitUntilSynced()]);

    // Act
    const batch = clientA.localInsert("fan", 0);
    await harness.pumpUntil(() =>
      clientA.acknowledgedBatchIds().has(batch.batchId),
    );
    expect(clientA.acknowledgedBatchIds().has(batch.batchId)).toBe(true);
    expect(harness.pendingDeliveries()).toBeGreaterThan(0);

    expect(harness.duplicateNextDelivery()).toBe(true);
    await harness.deliverAll();
    await harness.settle();

    // Assert: duplicate Event delivery does not corrupt state.
    expect(clientB.knownBatchIds().has(batch.batchId)).toBe(true);
    expect(clientA.conflicts()).toEqual([]);
    expect(clientB.conflicts()).toEqual([]);
    harness.assertReplicasConverged([clientA, clientB]);
  });

  it("should support disconnect, repair, and reconnect across instance boundaries", async () => {
    // Arrange
    harness = createCollabConsistencyHarness({ pageSize: 1 });
    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");
    const clientA = await instanceA.connectClient({
      id: "a",
      actorId: ACTOR_A,
    });
    const clientB = await instanceB.connectClient({
      id: "b",
      actorId: ACTOR_B,
    });
    await harness.settle();
    await Promise.all([clientA.waitUntilSynced(), clientB.waitUntilSynced()]);

    const first = clientA.localInsert("1", 0);
    await clientA.flushOutgoing();
    await harness.settle();

    // Act: B disconnects, A keeps writing, B reconnects and repairs.
    await clientB.disconnect();
    const second = clientA.localInsert("2", 1);
    await clientA.flushOutgoing();
    await harness.settle();

    await clientB.connect();
    await harness.settle();
    await clientB.waitUntilIdle();

    // Assert
    expect(clientB.knownBatchIds().has(first.batchId)).toBe(true);
    expect(clientB.knownBatchIds().has(second.batchId)).toBe(true);
    expect(clientB.conflicts()).toEqual([]);
    harness.assertReplicasConverged([clientA, clientB]);
  });

  it("should not share process-local topic state between instances", async () => {
    // Arrange
    harness = createCollabConsistencyHarness();
    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");
    const clients: HarnessClient[] = [];
    clients.push(
      await instanceA.connectClient({ id: "a1", actorId: ACTOR_A }),
      await instanceA.connectClient({ id: "a2", actorId: ACTOR_A }),
      await instanceB.connectClient({ id: "b1", actorId: ACTOR_B }),
    );
    await harness.settle();

    // Assert
    expect(instanceA.localPeerCount(harness.documentId)).toBe(2);
    expect(instanceB.localPeerCount(harness.documentId)).toBe(1);
  });
});
