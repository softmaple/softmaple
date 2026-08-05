import type { StorageApi, StorageEventApi } from "@tanstack/react-db";
import type { BroadcastChannelFactory, BroadcastChannelLike } from "./channel";
import type {
  ExclusiveLockRequestOptions,
  LockHandleLike,
  LockManagerLike,
} from "./leader";
import { type WireBatch, WireBatchSchema } from "./schema";

export class MockBroadcastNetwork {
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

export class FakeLockManager implements LockManagerLike {
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
    if (request === undefined) return;
    this.activeNames.add(name);
    const finish = (): void => {
      this.activeNames.delete(name);
      this.drain(name);
    };
    Promise.resolve(
      request.callback({ name, mode: request.options.mode }),
    ).then(
      () => {
        finish();
        request.resolve();
      },
      (error: unknown) => {
        finish();
        request.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    );
  }
}

export class SharedStorageBackend {
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

export class TestStorageTab implements StorageApi, StorageEventApi {
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

export const createBatch = (batchId: string, text: string): WireBatch =>
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

export const tick = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
