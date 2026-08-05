import { describe, expect, it } from "vitest";
import { createPersistenceChannel } from "./channel";
import {
  createPersistenceCoordinator,
  getPersistenceStorageKey,
} from "./coordinator";
import { PERSISTENCE_ROW_KIND, parsePersistenceStorage } from "./schema";
import {
  createBatch,
  FakeLockManager,
  MockBroadcastNetwork,
  SharedStorageBackend,
  tick,
} from "./test-helpers";

describe("TanStack DB persistence coordinator", () => {
  it("lets only the leader append and acknowledges after persistence", async () => {
    const storage = new SharedStorageBackend();
    const broadcast = new MockBroadcastNetwork();
    const locks = new FakeLockManager();
    const tabA = storage.createTab("a");
    const tabB = storage.createTab("b");
    const a = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "a",
      storage: tabA,
      storageEventApi: tabA,
      lockManager: locks,
      channelFactory: broadcast.createChannel,
      createId: () => "repair-a",
      repairDelayMs: 0,
      now: () => 1,
    });
    const b = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "b",
      storage: tabB,
      storageEventApi: tabB,
      lockManager: locks,
      channelFactory: broadcast.createChannel,
      createId: () => "repair-b",
      repairDelayMs: 0,
      now: () => 1,
    });

    expect(a.getSnapshot().leader.status).toBe("leader");
    expect(b.getSnapshot().leader.status).toBe("waiting");
    expect(b.publishBatch(createBatch("batch-1", "hello"))).toBe(true);
    await a.flushPending();
    await tick();

    expect(storage.writes).toEqual(["a"]);
    expect(a.getSnapshot().durability).toBe("saved");
    expect(a.getSnapshot().storageBytes).toBeGreaterThan(0);
    expect(b.getSnapshot().durability).toBe("saved");
    expect(b.getSnapshot().durableBatchIds).toEqual(["batch-1"]);
    const rows = parsePersistenceStorage(
      storage.data.get(getPersistenceStorageKey("room-a")) ?? null,
      "room-a",
    );
    expect(
      rows.filter((row) => row.kind === PERSISTENCE_ROW_KIND.Event),
    ).toHaveLength(1);

    await a.close();
    await b.close();
  });

  it("repairs the active peer set and persists it after leader takeover", async () => {
    const storage = new SharedStorageBackend();
    const broadcast = new MockBroadcastNetwork();
    const locks = new FakeLockManager();
    const tabA = storage.createTab("a");
    const tabB = storage.createTab("b");
    const a = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "a",
      storage: tabA,
      storageEventApi: tabA,
      lockManager: locks,
      channelFactory: broadcast.createChannel,
      repairDelayMs: 1_000,
    });
    const b = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "b",
      storage: tabB,
      storageEventApi: tabB,
      lockManager: locks,
      channelFactory: broadcast.createChannel,
      repairDelayMs: 0,
    });

    b.publishBatch(createBatch("takeover-batch", "survives"));
    await a.close();
    await tick();
    expect(b.getSnapshot().leader.status).toBe("leader");
    await b.flushPending();

    const rows = parsePersistenceStorage(
      storage.data.get(getPersistenceStorageKey("room-a")) ?? null,
      "room-a",
    );
    expect(
      rows.some(
        (row) =>
          row.kind === PERSISTENCE_ROW_KIND.Event &&
          row.batch.batchId === "takeover-batch",
      ),
    ).toBe(true);
    expect(storage.writes).toEqual(["b"]);
    await b.close();
  });

  it("flushes final batches before closing", async () => {
    const storage = new SharedStorageBackend();
    const broadcast = new MockBroadcastNetwork();
    const locks = new FakeLockManager();
    const tab = storage.createTab("a");
    const coordinator = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "a",
      storage: tab,
      storageEventApi: tab,
      lockManager: locks,
      channelFactory: broadcast.createChannel,
    });

    coordinator.publishBatch(createBatch("closing-batch", "saved"));
    await coordinator.close();

    const rows = parsePersistenceStorage(
      storage.data.get(getPersistenceStorageKey("room-a")) ?? null,
      "room-a",
    );
    expect(
      rows.some(
        (row) =>
          row.kind === PERSISTENCE_ROW_KIND.Event &&
          row.batch.batchId === "closing-batch",
      ),
    ).toBe(true);
  });

  it("retains channel durability acknowledgements across storage refreshes", async () => {
    const storage = new SharedStorageBackend();
    const broadcast = new MockBroadcastNetwork();
    const locks = new FakeLockManager();
    const tab = storage.createTab("a");
    const coordinator = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "a",
      storage: tab,
      storageEventApi: tab,
      lockManager: locks,
      channelFactory: broadcast.createChannel,
    });
    const sender = createPersistenceChannel({
      roomId: "room-a",
      peerId: "sender",
      channelFactory: broadcast.createChannel,
    });

    sender.broadcastDurableAck(["channel-only"]);
    tab.dispatch(getPersistenceStorageKey("room-a"));

    expect(coordinator.getSnapshot().durableBatchIds).toContain("channel-only");
    sender.close();
    await coordinator.close();
  });
});
