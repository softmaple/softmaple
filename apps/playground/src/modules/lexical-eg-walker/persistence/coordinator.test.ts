import type { StorageApi, StorageEventApi } from "@tanstack/react-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BroadcastChannelFactory, BroadcastChannelLike } from "./channel";
import {
  createPersistenceCoordinator,
  getPersistenceStorageKey,
} from "./coordinator";
import type {
  ExclusiveLockRequestOptions,
  LockHandleLike,
  LockManagerLike,
} from "./leader";
import {
  PERSISTENCE_ROW_KIND,
  parsePersistenceStorage,
  type WireBatch,
  WireBatchSchema,
} from "./schema";

class MockBroadcastNetwork {
  private readonly channels = new Map<string, Set<MockBroadcastChannel>>();

  readonly createChannel: BroadcastChannelFactory = (name) => {
    const channel = new MockBroadcastChannel(name, this);
    const peers = this.channels.get(name) ?? new Set<MockBroadcastChannel>();
    peers.add(channel);
    this.channels.set(name, peers);
    return channel;
  };

  deliver(sender: MockBroadcastChannel, message: unknown): void {
    for (const peer of this.channels.get(sender.name) ?? []) {
      if (peer !== sender) peer.onmessage?.({ data: structuredClone(message) });
    }
  }

  remove(channel: MockBroadcastChannel): void {
    this.channels.get(channel.name)?.delete(channel);
  }
}

class MockBroadcastChannel implements BroadcastChannelLike {
  onmessage: BroadcastChannelLike["onmessage"] = null;

  constructor(
    readonly name: string,
    private readonly network: MockBroadcastNetwork,
  ) {}

  postMessage(message: unknown): void {
    this.network.deliver(this, message);
  }

  close(): void {
    this.network.remove(this);
  }
}

interface PendingLock {
  readonly callback: (lock: LockHandleLike) => Promise<void> | void;
  readonly name: string;
  readonly options: ExclusiveLockRequestOptions;
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
}

class FakeLockManager implements LockManagerLike {
  private readonly activeNames = new Set<string>();
  private readonly pending: PendingLock[] = [];
  requestCount = 0;

  request(
    name: string,
    options: ExclusiveLockRequestOptions,
    callback: (lock: LockHandleLike) => Promise<void> | void,
  ): Promise<void> {
    this.requestCount++;
    return new Promise<void>((resolve, reject) => {
      const request = { name, options, callback, resolve, reject };
      options.signal.addEventListener(
        "abort",
        () => {
          const index = this.pending.indexOf(request);
          if (index < 0) return;
          this.pending.splice(index, 1);
          const error = new Error("Lock request aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
      this.pending.push(request);
      this.drain(name);
    });
  }

  private drain(name: string): void {
    if (this.activeNames.has(name)) return;
    const index = this.pending.findIndex((request) => request.name === name);
    if (index < 0) return;
    const [request] = this.pending.splice(index, 1);
    if (!request) return;
    this.activeNames.add(name);
    Promise.resolve(
      request.callback({ name, mode: request.options.mode }),
    ).finally(() => {
      this.activeNames.delete(name);
      request.resolve();
      this.drain(name);
    });
  }
}

class SharedStorageBackend {
  readonly data = new Map<string, string>();
  readonly writes: string[] = [];
  readonly tabs = new Set<TestStorageTab>();
  quotaExceeded = false;

  createTab(id: string): TestStorageTab {
    const tab = new TestStorageTab(id, this);
    this.tabs.add(tab);
    return tab;
  }

  write(source: TestStorageTab, key: string, value: string): void {
    if (this.quotaExceeded) {
      const error = new Error("Local storage quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.data.set(key, value);
    this.writes.push(source.id);
    for (const tab of this.tabs) {
      if (tab !== source) tab.dispatch(key);
    }
  }
}

class TestStorageTab implements StorageApi, StorageEventApi {
  private readonly listeners = new Set<(event: StorageEvent) => void>();

  constructor(
    readonly id: string,
    private readonly backend: SharedStorageBackend,
  ) {}

  getItem(key: string): string | null {
    return this.backend.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.backend.write(this, key, value);
  }

  removeItem(key: string): void {
    this.backend.data.delete(key);
    for (const tab of this.backend.tabs) {
      if (tab !== this) tab.dispatch(key);
    }
  }

  addEventListener(
    _type: "storage",
    listener: (event: StorageEvent) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "storage",
    listener: (event: StorageEvent) => void,
  ): void {
    this.listeners.delete(listener);
  }

  dispatch(key: string): void {
    const event = { key, storageArea: this } as unknown as StorageEvent;
    for (const listener of this.listeners) listener(event);
  }
}

const createBatch = (batchId: string, text: string): WireBatch =>
  WireBatchSchema.parse({
    schemaVersion: 1,
    batchId,
    parentVersion: [],
    events: [
      {
        schemaVersion: 1,
        id: `${batchId}:event`,
        parentVersion: [],
        timestamp: 1,
        operation: { type: "insert", text },
        effect: { type: "text-insert", blockId: "block-1", text },
      },
    ],
  });

const tick = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  vi.restoreAllMocks();
});

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
