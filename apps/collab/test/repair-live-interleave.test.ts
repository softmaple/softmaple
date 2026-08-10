import { afterEach, describe, expect, it } from "vitest";
import {
  createCausalBatches,
  createCollabConsistencyHarness,
  type CollabConsistencyHarness,
} from "./helpers/collabConsistencyHarness";

const ACTOR_A = "00000000-0000-4000-8000-0000000000a1";
const ACTOR_B = "00000000-0000-4000-8000-0000000000a2";

describe("repair and live-event interleaving", () => {
  let harness: CollabConsistencyHarness;

  afterEach(async () => {
    await harness.close();
  });

  it("should apply live Event after a partial repair page without losing history", async () => {
    // Arrange: durable history of two causal batches; repair pages of size 1.
    harness = createCollabConsistencyHarness({ pageSize: 1 });
    const { first, second } = createCausalBatches("seed");
    await harness.store.appendEventBatches(harness.documentId, ACTOR_A, [
      first,
      second,
    ]);
    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");

    // Act: start client A repair, but only complete the first page turn.
    const clientA = await instanceA.connectClient({
      id: "client-a",
      actorId: ACTOR_A,
    });
    // Auth -> Ready enqueue -> RepairRequest -> RepairResponse(page1) -> next RepairRequest
    await harness.pumpProtocol(5);
    expect(clientA.isSynced()).toBe(false);
    expect(clientA.knownBatchIds().has(first.batchId)).toBe(true);
    expect(clientA.knownBatchIds().has(second.batchId)).toBe(false);

    const clientB = await instanceB.connectClient({
      id: "client-b",
      actorId: ACTOR_B,
    });
    await harness.settle();
    await clientB.waitUntilSynced();
    const live = clientB.localInsert("Z", 2);
    await clientB.flushOutgoing();

    // Finish A's remaining repair pages and live fan-out.
    await harness.settle();
    await clientA.waitUntilSynced();

    // Assert
    expect(clientA.knownBatchIds().has(second.batchId)).toBe(true);
    expect(clientA.knownBatchIds().has(live.batchId)).toBe(true);
    expect(clientA.conflicts()).toEqual([]);
    expect(clientA.repairRequestCount()).toBeGreaterThanOrEqual(2);
    harness.assertReplicasConverged([clientA, clientB]);
  });

  it("should tolerate live Event arriving before the first repair page", async () => {
    // Arrange
    harness = createCollabConsistencyHarness({ pageSize: 1 });
    const { first, second } = createCausalBatches("seed");
    await harness.store.appendEventBatches(harness.documentId, ACTOR_A, [
      first,
      second,
    ]);
    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");

    const clientB = await instanceB.connectClient({
      id: "client-b",
      actorId: ACTOR_B,
    });
    await harness.settle();
    await clientB.waitUntilSynced();
    const live = clientB.localInsert("L", 2);
    await clientB.flushOutgoing();

    // Act: connect A after the live commit already happened.
    const clientA = await instanceA.connectClient({
      id: "client-a",
      actorId: ACTOR_A,
    });
    await harness.settle();
    await clientA.waitUntilSynced();

    // Assert: repair + live delivery converge; no missing-parent conflict.
    expect(clientA.knownBatchIds().has(first.batchId)).toBe(true);
    expect(clientA.knownBatchIds().has(second.batchId)).toBe(true);
    expect(clientA.knownBatchIds().has(live.batchId)).toBe(true);
    expect(clientA.conflicts()).toEqual([]);
    harness.assertReplicasConverged([clientA, clientB]);
  });

  it("should keep repair page 1, live Event, repair page 2 ordering correct", async () => {
    // Arrange: three durable batches so repair needs multiple pages around a live write.
    harness = createCollabConsistencyHarness({ pageSize: 1 });
    const seed = createCausalBatches("seed-1");
    await harness.store.appendEventBatches(harness.documentId, ACTOR_A, [
      seed.first,
      seed.second,
    ]);
    // Third durable batch via a temporary writer.
    const bootstrapInstance = harness.createInstance("bootstrap");
    const seeder = await bootstrapInstance.connectClient({
      id: "seeder",
      actorId: ACTOR_A,
    });
    await harness.settle();
    await seeder.waitUntilSynced();
    const third = seeder.localInsert("C", 2);
    await seeder.flushOutgoing();
    await seeder.disconnect();

    const instanceA = harness.createInstance("A");
    const instanceB = harness.createInstance("B");
    const clientA = await instanceA.connectClient({
      id: "client-a",
      actorId: ACTOR_A,
    });

    // Act: stop after first repair response applied and next request queued.
    await harness.pumpProtocol(5);
    expect(clientA.knownBatchIds().has(seed.first.batchId)).toBe(true);
    expect(clientA.isSynced()).toBe(false);

    const clientB = await instanceB.connectClient({
      id: "client-b",
      actorId: ACTOR_B,
    });
    await harness.settle();
    await clientB.waitUntilSynced();
    const live = clientB.localInsert("X", 3);
    await clientB.flushOutgoing();
    await harness.settle();
    await clientA.waitUntilSynced();

    // Assert
    expect(clientA.knownBatchIds().has(seed.second.batchId)).toBe(true);
    expect(clientA.knownBatchIds().has(third.batchId)).toBe(true);
    expect(clientA.knownBatchIds().has(live.batchId)).toBe(true);
    expect(clientA.conflicts()).toEqual([]);
    // No repair loop: requests stay proportional to page count + reconnects.
    expect(clientA.repairRequestCount()).toBeLessThanOrEqual(8);
    harness.assertReplicasConverged([clientA, clientB]);
  });

  it("should repair then exact-resend pending batches after reconnect", async () => {
    // Arrange
    harness = createCollabConsistencyHarness({ pageSize: 2 });
    const instance = harness.createInstance("A");
    const client = await instance.connectClient({
      id: "client-a",
      actorId: ACTOR_A,
    });
    await harness.settle();
    await client.waitUntilSynced();

    const pending = client.localInsert("P", 0);
    // Disconnect before DurableAck while the Event is still queued.
    await client.disconnect();
    expect(client.pendingBatchIds()).toEqual([pending.batchId]);
    expect(client.acknowledgedBatchIds().has(pending.batchId)).toBe(false);

    // Act: reconnect resumes repair from cursor, then exact pending resend.
    await client.connect();
    await harness.settle();
    await client.waitUntilIdle();

    // Assert
    expect(harness.store.hasBatch(harness.documentId, pending.batchId)).toBe(
      true,
    );
    expect(client.acknowledgedBatchIds().has(pending.batchId)).toBe(true);
    expect(client.pendingBatchIds()).toEqual([]);
    expect(client.conflicts()).toEqual([]);
    // Initial connect + reconnect each start repair; no loop beyond that.
    expect(client.repairRequestCount()).toBeGreaterThanOrEqual(2);
    expect(client.repairRequestCount()).toBeLessThanOrEqual(4);
  });
});
