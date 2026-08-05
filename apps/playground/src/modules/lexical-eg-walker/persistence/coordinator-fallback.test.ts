import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPersistenceCoordinator,
  getPersistenceStorageKey,
} from "./coordinator";
import {
  createBatch,
  FakeLockManager,
  MockBroadcastNetwork,
  SharedStorageBackend,
  tick,
} from "./test-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistence coordinator fallbacks", () => {
  it("keeps collaborating in memory when Web Locks are unsupported", async () => {
    const storage = new SharedStorageBackend();
    const broadcast = new MockBroadcastNetwork();
    const tab = storage.createTab("a");
    const coordinator = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "a",
      storage: tab,
      storageEventApi: tab,
      lockManager: null,
      channelFactory: broadcast.createChannel,
    });

    coordinator.publishBatch(createBatch("memory-batch", "hello"));
    await coordinator.flushPending();
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: "memory-only",
      durability: "unsaved",
      failureReason: "web-locks-unsupported",
    });
    expect(coordinator.getKnownBatches()).toHaveLength(1);
    expect(storage.writes).toEqual([]);
    await coordinator.close();
  });

  it("does not start leader election when storage is unavailable", async () => {
    const broadcast = new MockBroadcastNetwork();
    const locks = new FakeLockManager();
    const coordinator = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "a",
      storage: null,
      storageEventApi: null,
      lockManager: locks,
      channelFactory: broadcast.createChannel,
    });

    expect(locks.requestCount).toBe(0);
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: "memory-only",
      failureReason: "storage-unavailable",
      leader: { status: "stopped", isLeader: false },
    });
    await coordinator.close();
  });

  it("preserves corrupt storage and refuses to overwrite it", async () => {
    const storage = new SharedStorageBackend();
    const broadcast = new MockBroadcastNetwork();
    const locks = new FakeLockManager();
    const tab = storage.createTab("a");
    const key = getPersistenceStorageKey("room-a");
    storage.data.set(key, "{broken");
    const coordinator = await createPersistenceCoordinator({
      roomId: "room-a",
      peerId: "a",
      storage: tab,
      storageEventApi: tab,
      lockManager: locks,
      channelFactory: broadcast.createChannel,
    });

    coordinator.publishBatch(createBatch("memory-batch", "hello"));
    await coordinator.flushPending();
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: "memory-only",
      failureReason: "corrupt-storage",
    });
    expect(storage.data.get(key)).toBe("{broken");
    expect(storage.writes).toEqual([]);
    await coordinator.close();
  });

  it("degrades to an explicit unsaved state when quota is exceeded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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
      repairDelayMs: 0,
    });
    storage.quotaExceeded = true;

    coordinator.publishBatch(createBatch("quota-batch", "hello"));
    await coordinator.flushPending();
    expect(coordinator.getSnapshot()).toMatchObject({
      mode: "memory-only",
      durability: "unsaved",
      failureReason: "quota-exceeded",
      pendingBatchIds: ["quota-batch"],
    });
    expect(storage.writes).toEqual([]);
    await coordinator.close();
  });

  it("releases leadership after degrading so a waiting tab can take over", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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
      repairDelayMs: 1_000,
    });
    storage.quotaExceeded = true;

    a.publishBatch(createBatch("quota-batch", "hello"));
    await a.flushPending();
    await tick();

    expect(a.getSnapshot()).toMatchObject({
      mode: "memory-only",
      leader: { status: "stopped", isLeader: false },
    });
    expect(b.getSnapshot().leader).toMatchObject({
      status: "leader",
      isLeader: true,
    });
    await a.close();
    await b.close();
  });
});
