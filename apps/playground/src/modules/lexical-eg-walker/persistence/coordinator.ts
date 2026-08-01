import {
  createCollection,
  localStorageCollectionOptions,
  type StorageApi,
  type StorageEventApi,
} from "@tanstack/react-db";
import {
  type BatchListener,
  type BroadcastChannelFactory,
  createPersistenceChannel,
} from "./channel";
import {
  createLeaderElection,
  type LeaderElectionSnapshot,
  type LockManagerLike,
} from "./leader";
import {
  CorruptPersistenceStorageError,
  createEventRow,
  createRoomRow,
  PERSISTENCE_ROW_KIND,
  type PersistenceRow,
  PersistenceRowSchema,
  parsePersistenceStorage,
  type WireBatch,
} from "./schema";

export const PERSISTENCE_COORDINATOR_MODE = {
  Closed: "closed",
  Initializing: "initializing",
  MemoryOnly: "memory-only",
  Persistent: "persistent",
} as const;

export const PERSISTENCE_DURABILITY = {
  Loading: "loading",
  Pending: "pending",
  Saved: "saved",
  Unsaved: "unsaved",
} as const;

export const PERSISTENCE_FAILURE_REASON = {
  CorruptStorage: "corrupt-storage",
  QuotaExceeded: "quota-exceeded",
  StorageError: "storage-error",
  StorageUnavailable: "storage-unavailable",
  WebLocksUnsupported: "web-locks-unsupported",
} as const;

export type CoordinatorMode =
  (typeof PERSISTENCE_COORDINATOR_MODE)[keyof typeof PERSISTENCE_COORDINATOR_MODE];
export type Durability =
  (typeof PERSISTENCE_DURABILITY)[keyof typeof PERSISTENCE_DURABILITY];
export type FailureReason =
  | (typeof PERSISTENCE_FAILURE_REASON)[keyof typeof PERSISTENCE_FAILURE_REASON]
  | null;

export interface PersistenceCoordinatorSnapshot {
  readonly mode: CoordinatorMode;
  readonly durability: Durability;
  readonly leader: LeaderElectionSnapshot;
  readonly pendingBatchIds: ReadonlyArray<string>;
  readonly durableBatchIds: ReadonlyArray<string>;
  readonly storageBytes: number;
  readonly failureReason: FailureReason;
  readonly errorMessage: string | null;
}

export interface PersistenceCoordinator {
  publishBatch(batch: WireBatch): boolean;
  requestRepair(): string;
  flushPending(): Promise<void>;
  getKnownBatches(): ReadonlyArray<WireBatch>;
  getSnapshot(): PersistenceCoordinatorSnapshot;
  subscribeBatches(listener: BatchListener): () => void;
  subscribeState(
    listener: (snapshot: PersistenceCoordinatorSnapshot) => void,
  ): () => void;
  subscribeErrors(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
}

export interface CreatePersistenceCoordinatorOptions {
  readonly roomId: string;
  readonly peerId: string;
  readonly storage?: StorageApi | null;
  readonly storageEventApi?: StorageEventApi | null;
  readonly lockManager?: LockManagerLike | null;
  readonly channelFactory?: BroadcastChannelFactory;
  readonly createId?: () => string;
  readonly now?: () => number;
  readonly repairDelayMs?: number;
}

interface StorageEventBridge {
  readonly api: StorageEventApi;
  dispatch(event: StorageEvent): void;
  close(): void;
}

export const getPersistenceStorageKey = (roomId: string): string =>
  `softmaple:lexical-eg-walker:v1:room:${encodeURIComponent(roomId)}`;

const getDefaultStorage = (): StorageApi | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const getDefaultStorageEventApi = (): StorageEventApi | null =>
  typeof window === "undefined" ? null : window;

const createStorageEventBridge = (
  source: StorageEventApi | null,
): StorageEventBridge => {
  const listeners = new Set<(event: StorageEvent) => void>();
  const dispatch = (event: StorageEvent): void => {
    for (const listener of listeners) listener(event);
  };
  source?.addEventListener("storage", dispatch);

  return {
    api: {
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    },
    dispatch,
    close: () => {
      source?.removeEventListener("storage", dispatch);
      listeners.clear();
    },
  };
};

const createPersistenceCollection = (
  roomId: string,
  peerId: string,
  storageKey: string,
  storage: StorageApi,
  storageEventApi: StorageEventApi,
) =>
  createCollection(
    localStorageCollectionOptions({
      id: `lexical-eg-walker-persistence:${roomId}:${peerId}`,
      storageKey,
      storage,
      storageEventApi,
      schema: PersistenceRowSchema,
      getKey: (row) => row.key,
    }),
  );

type PersistenceCollection = ReturnType<typeof createPersistenceCollection>;

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : "Persistence operation failed";

const isQuotaExceededError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  return (
    Reflect.get(error, "name") === "QuotaExceededError" ||
    Reflect.get(error, "code") === 22 ||
    Reflect.get(error, "code") === 1014
  );
};

const storageByteLength = (raw: string | null): number =>
  raw === null ? 0 : new TextEncoder().encode(raw).byteLength;

const createStorageEvent = (key: string, storage: StorageApi): StorageEvent =>
  ({ key, storageArea: storage }) as unknown as StorageEvent;

export const createPersistenceCoordinator = async (
  options: CreatePersistenceCoordinatorOptions,
): Promise<PersistenceCoordinator> => {
  const now = options.now ?? Date.now;
  const repairDelayMs = options.repairDelayMs ?? 25;
  const storageKey = getPersistenceStorageKey(options.roomId);
  const storage =
    options.storage === undefined ? getDefaultStorage() : options.storage;
  const sourceEventApi =
    options.storageEventApi === undefined
      ? getDefaultStorageEventApi()
      : options.storageEventApi;
  const eventBridge = createStorageEventBridge(sourceEventApi);
  const channel = createPersistenceChannel({
    roomId: options.roomId,
    peerId: options.peerId,
    channelFactory: options.channelFactory,
    createId: options.createId,
  });
  const election = createLeaderElection({
    roomId: options.roomId,
    lockManager: options.lockManager,
  });
  const stateListeners = new Set<
    (snapshot: PersistenceCoordinatorSnapshot) => void
  >();
  const batchListeners = new Set<BatchListener>();
  const errorListeners = new Set<(error: Error) => void>();
  const persistedBatchIds = new Set<string>();
  const durableBatchIds = new Set<string>();
  let mode: CoordinatorMode = PERSISTENCE_COORDINATOR_MODE.Initializing;
  let failureReason: FailureReason = null;
  let lastErrorMessage: string | null = null;
  let leaderSnapshot = election.getSnapshot();
  let storageBytes = 0;
  let roomRowStored = false;
  let collection: PersistenceCollection | null = null;
  let closed = false;
  let repairTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;
  let flushRequested = false;

  const pendingBatchIds = (): string[] =>
    channel
      .getKnownBatches()
      .map((batch) => batch.batchId)
      .filter((batchId) => !durableBatchIds.has(batchId))
      .sort();

  const durability = (): Durability => {
    if (mode === PERSISTENCE_COORDINATOR_MODE.Initializing) {
      return PERSISTENCE_DURABILITY.Loading;
    }
    if (mode !== PERSISTENCE_COORDINATOR_MODE.Persistent) {
      return PERSISTENCE_DURABILITY.Unsaved;
    }
    return pendingBatchIds().length === 0
      ? PERSISTENCE_DURABILITY.Saved
      : PERSISTENCE_DURABILITY.Pending;
  };

  const getSnapshot = (): PersistenceCoordinatorSnapshot => ({
    mode,
    durability: durability(),
    leader: leaderSnapshot,
    pendingBatchIds: pendingBatchIds(),
    durableBatchIds: [...durableBatchIds].sort(),
    storageBytes,
    failureReason,
    errorMessage: lastErrorMessage,
  });

  const notifyState = (): void => {
    const snapshot = getSnapshot();
    for (const listener of stateListeners) listener(snapshot);
  };

  const notifyError = (error: Error): void => {
    lastErrorMessage = error.message;
    for (const listener of errorListeners) listener(error);
    notifyState();
  };

  const disablePersistence = (
    reason: Exclude<FailureReason, null>,
    error?: Error,
  ): void => {
    if (closed) return;
    mode = PERSISTENCE_COORDINATOR_MODE.MemoryOnly;
    failureReason = reason;
    if (error) notifyError(error);
    const abandonedCollection = collection;
    collection = null;
    if (abandonedCollection) void abandonedCollection.cleanup();
    notifyState();
  };

  const syncRows = (
    rows: ReadonlyArray<PersistenceRow>,
    raw: string | null,
  ): void => {
    const eventRows = rows.filter(
      (row) => row.kind === PERSISTENCE_ROW_KIND.Event,
    );
    persistedBatchIds.clear();
    durableBatchIds.clear();
    for (const row of eventRows) {
      persistedBatchIds.add(row.batch.batchId);
      durableBatchIds.add(row.batch.batchId);
    }
    roomRowStored = rows.some((row) => row.kind === PERSISTENCE_ROW_KIND.Room);
    storageBytes = storageByteLength(raw);
    channel.seedBatches(eventRows.map((row) => row.batch));
    notifyState();
  };

  const refreshFromStorage = (): boolean => {
    if (storage === null) return false;
    try {
      const raw = storage.getItem(storageKey);
      syncRows(parsePersistenceStorage(raw, options.roomId), raw);
      eventBridge.dispatch(createStorageEvent(storageKey, storage));
      return true;
    } catch (error) {
      const normalized =
        error instanceof Error
          ? error
          : new Error("Failed to read persistence storage");
      disablePersistence(
        error instanceof CorruptPersistenceStorageError
          ? PERSISTENCE_FAILURE_REASON.CorruptStorage
          : PERSISTENCE_FAILURE_REASON.StorageError,
        normalized,
      );
      return false;
    }
  };

  const performFlush = async (): Promise<void> => {
    if (
      closed ||
      mode !== PERSISTENCE_COORDINATOR_MODE.Persistent ||
      !leaderSnapshot.isLeader ||
      collection === null
    ) {
      return;
    }

    const batches = channel
      .getKnownBatches()
      .filter((batch) => !persistedBatchIds.has(batch.batchId));
    if (batches.length === 0) return;

    const rows: PersistenceRow[] = batches.map((batch) =>
      createEventRow(options.roomId, batch, now()),
    );
    if (!roomRowStored) rows.unshift(createRoomRow(options.roomId, now()));

    try {
      const transaction = collection.insert(rows);
      await transaction.isPersisted.promise;
      roomRowStored = true;
      for (const batch of batches) {
        persistedBatchIds.add(batch.batchId);
        durableBatchIds.add(batch.batchId);
      }
      storageBytes = storageByteLength(storage?.getItem(storageKey) ?? null);
      channel.broadcastDurableAck(batches.map((batch) => batch.batchId));
      notifyState();
    } catch (error) {
      const normalized = new Error(messageFromError(error));
      normalized.name = error instanceof Error ? error.name : normalized.name;
      disablePersistence(
        isQuotaExceededError(error)
          ? PERSISTENCE_FAILURE_REASON.QuotaExceeded
          : PERSISTENCE_FAILURE_REASON.StorageError,
        normalized,
      );
    }
  };

  const flushPending = (): Promise<void> => {
    if (flushPromise) {
      flushRequested = true;
      return flushPromise;
    }
    flushPromise = (async () => {
      do {
        flushRequested = false;
        await performFlush();
      } while (flushRequested);
    })().finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  };

  const scheduleFlush = (): void => {
    if (closed) return;
    queueMicrotask(() => void flushPending());
  };

  const unsubscribeBatches = channel.subscribeBatches((batch, source) => {
    for (const listener of batchListeners) listener(batch, source);
    notifyState();
    if (leaderSnapshot.isLeader) scheduleFlush();
  });
  const unsubscribeAcks = channel.subscribeDurableAcks((batchIds) => {
    for (const batchId of batchIds) {
      persistedBatchIds.add(batchId);
      durableBatchIds.add(batchId);
    }
    notifyState();
  });
  const unsubscribeChannelErrors = channel.subscribeErrors(notifyError);

  const handleStorageEvent = (event: StorageEvent): void => {
    if (
      closed ||
      storage === null ||
      event.key !== storageKey ||
      event.storageArea !== storage ||
      mode === PERSISTENCE_COORDINATOR_MODE.MemoryOnly
    ) {
      return;
    }
    refreshFromStorage();
  };
  sourceEventApi?.addEventListener("storage", handleStorageEvent);

  if (storage === null) {
    disablePersistence(PERSISTENCE_FAILURE_REASON.StorageUnavailable);
  } else if (refreshFromStorage()) {
    try {
      collection = createPersistenceCollection(
        options.roomId,
        options.peerId,
        storageKey,
        storage,
        eventBridge.api,
      );
      await collection.stateWhenReady();
      mode = PERSISTENCE_COORDINATOR_MODE.Persistent;
      notifyState();
    } catch (error) {
      disablePersistence(
        PERSISTENCE_FAILURE_REASON.StorageError,
        error instanceof Error
          ? error
          : new Error("Failed to initialize persistence collection"),
      );
    }
  }

  const unsubscribeLeader = election.subscribe((next) => {
    leaderSnapshot = next;
    if (next.status === "unsupported") {
      disablePersistence(PERSISTENCE_FAILURE_REASON.WebLocksUnsupported);
      return;
    }
    if (next.status === "error") {
      disablePersistence(
        PERSISTENCE_FAILURE_REASON.StorageError,
        new Error(next.errorMessage ?? "Persistence leader election failed"),
      );
      return;
    }
    notifyState();
    if (!next.isLeader || mode !== PERSISTENCE_COORDINATOR_MODE.Persistent) {
      return;
    }

    refreshFromStorage();
    channel.requestRepair();
    if (repairTimer) clearTimeout(repairTimer);
    repairTimer = setTimeout(scheduleFlush, repairDelayMs);
  });
  election.start();
  channel.requestRepair();

  return {
    publishBatch: (batch) => {
      if (closed) return false;
      return channel.publishBatch(batch);
    },
    requestRepair: () => channel.requestRepair(),
    flushPending,
    getKnownBatches: () => channel.getKnownBatches(),
    getSnapshot,
    subscribeBatches: (listener) => {
      batchListeners.add(listener);
      return () => batchListeners.delete(listener);
    },
    subscribeState: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeErrors: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      if (repairTimer) clearTimeout(repairTimer);
      unsubscribeLeader();
      unsubscribeBatches();
      unsubscribeAcks();
      unsubscribeChannelErrors();
      sourceEventApi?.removeEventListener("storage", handleStorageEvent);
      await flushPromise;
      await election.stop();
      leaderSnapshot = election.getSnapshot();
      await collection?.cleanup();
      collection = null;
      channel.close();
      eventBridge.close();
      mode = PERSISTENCE_COORDINATOR_MODE.Closed;
      notifyState();
      stateListeners.clear();
      batchListeners.clear();
      errorListeners.clear();
    },
  };
};
