import {
  COLLAB_PROTOCOL_VERSION,
  CollabErrorCode,
  CollabMessageSchema,
  CollabMessageType,
  DEFAULT_REPAIR_PAGE_SIZE,
  type CollabMessage,
  type WireBatch,
  type WorkspaceRole,
  parseWireBatch,
} from "@softmaple/collab-protocol";
import {
  createCollabStorage,
  type CollabStorage,
  type StoredBatchRow,
} from "./storage";

export const CollabConnectionState = {
  Connecting: "connecting",
  Authenticating: "authenticating",
  Repairing: "repairing",
  Ready: "ready",
  Reconnecting: "reconnecting",
  Offline: "offline",
  Error: "error",
  Closed: "closed",
} as const;

export type CollabConnectionState =
  (typeof CollabConnectionState)[keyof typeof CollabConnectionState];

export const CollabDurability = {
  Loading: "loading",
  Pending: "pending",
  Saved: "saved",
  OfflinePending: "offline-pending",
} as const;

export type CollabDurability =
  (typeof CollabDurability)[keyof typeof CollabDurability];

export type BatchDeliverySource = "local" | "remote" | "repair" | "storage";

export interface CollabSessionSnapshot {
  readonly connectionState: CollabConnectionState;
  readonly durability: CollabDurability;
  readonly role: WorkspaceRole | null;
  readonly canWrite: boolean;
  readonly userId: string | null;
  readonly pendingBatchIds: ReadonlyArray<string>;
  readonly durableBatchIds: ReadonlyArray<string>;
  readonly ready: boolean;
  readonly error: Error | null;
}

export type BatchListener = (
  batch: WireBatch,
  source: BatchDeliverySource,
) => void;
export type SnapshotListener = (snapshot: CollabSessionSnapshot) => void;
export type ErrorListener = (error: Error) => void;

export interface CreateCollabSessionOptions {
  readonly documentId: string;
  readonly replicaId: string;
  readonly wsUrl: string;
  readonly getAccessToken: () => Promise<string>;
  readonly storage?: CollabStorage;
  readonly parseBatch?: (input: unknown) => WireBatch;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly repairPageSize?: number;
  readonly reconnectBaseDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
  readonly authTimeoutMs?: number;
}

export interface CollabSession {
  start(): Promise<void>;
  publishBatch(batch: WireBatch): boolean;
  reauth(): Promise<void>;
  getKnownBatches(): ReadonlyArray<WireBatch>;
  getSnapshot(): CollabSessionSnapshot;
  subscribeBatches(listener: BatchListener): () => void;
  subscribeSnapshot(listener: SnapshotListener): () => void;
  subscribeErrors(listener: ErrorListener): () => void;
  close(): void;
}

type RepairPage = {
  batches: ReadonlyArray<{ cursor: string; batch: WireBatch }>;
  nextCursor: string | null;
  hasMore: boolean;
};

const serializeBatch = (batch: WireBatch): string => JSON.stringify(batch);

export const createCollabSession = (
  options: CreateCollabSessionOptions,
): CollabSession => {
  const parseBatch = options.parseBatch ?? parseWireBatch;
  const ownsStorage = options.storage === undefined;
  const storage = options.storage ?? createCollabStorage();
  const WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  const repairPageSize = options.repairPageSize ?? DEFAULT_REPAIR_PAGE_SIZE;
  const reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 500;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 8_000;
  const authTimeoutMs = options.authTimeoutMs ?? 10_000;

  const knownBatches = new Map<string, WireBatch>();
  const durableBatchIds = new Set<string>();
  const pendingPublish = new Set<string>();
  const batchListeners = new Set<BatchListener>();
  const snapshotListeners = new Set<SnapshotListener>();
  const errorListeners = new Set<ErrorListener>();
  const pendingRepair = new Map<
    string,
    { resolve: (value: RepairPage) => void; reject: (error: Error) => void }
  >();

  let socket: WebSocket | null = null;
  let closed = false;
  let started = false;
  let ready = false;
  let authenticated = false;
  let connectionState: CollabConnectionState = CollabConnectionState.Connecting;
  let role: WorkspaceRole | null = null;
  let canWrite = false;
  let userId: string | null = null;
  let error: Error | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let authWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  const notifyError = (next: Error): void => {
    error = next;
    for (const listener of errorListeners) listener(next);
    emitSnapshot();
  };

  const resolveDurability = (): CollabDurability => {
    if (!ready && knownBatches.size === 0) return CollabDurability.Loading;
    if (pendingPublish.size > 0) {
      return connectionState === CollabConnectionState.Ready
        ? CollabDurability.Pending
        : CollabDurability.OfflinePending;
    }
    return CollabDurability.Saved;
  };

  const getSnapshot = (): CollabSessionSnapshot => ({
    connectionState,
    durability: resolveDurability(),
    role,
    canWrite,
    userId,
    pendingBatchIds: [...pendingPublish],
    durableBatchIds: [...durableBatchIds],
    ready,
    error,
  });

  const emitSnapshot = (): void => {
    const snapshot = getSnapshot();
    for (const listener of snapshotListeners) listener(snapshot);
  };

  const setConnectionState = (next: CollabConnectionState): void => {
    if (connectionState === next) return;
    connectionState = next;
    emitSnapshot();
  };

  const acceptBatch = (
    candidate: unknown,
    source: BatchDeliverySource,
  ): WireBatch | null => {
    let batch: WireBatch;
    try {
      batch = parseBatch(candidate);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Invalid batch payload";
      notifyError(new Error(`Invalid collab batch: ${message}`));
      return null;
    }
    const existing = knownBatches.get(batch.batchId);
    if (existing) {
      if (serializeBatch(existing) !== serializeBatch(batch)) {
        notifyError(
          new Error(`Conflicting payloads for batch ${batch.batchId}`),
        );
      }
      return null;
    }
    knownBatches.set(batch.batchId, batch);
    void storage.putBatch(
      options.documentId,
      batch,
      durableBatchIds.has(batch.batchId),
    );
    for (const listener of batchListeners) listener(batch, source);
    return batch;
  };

  const markDurable = (batchIds: ReadonlyArray<string>): void => {
    let changed = false;
    for (const batchId of batchIds) {
      if (!durableBatchIds.has(batchId)) {
        durableBatchIds.add(batchId);
        changed = true;
      }
      if (pendingPublish.delete(batchId)) changed = true;
    }
    if (!changed) return;
    void storage.markDurable(options.documentId, batchIds);
    emitSnapshot();
  };

  const send = (message: CollabMessage): void => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  };

  const flushPending = (): void => {
    for (const batchId of pendingPublish) {
      const batch = knownBatches.get(batchId);
      if (!batch) continue;
      send({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: CollabMessageType.Event,
        documentId: options.documentId,
        senderId: options.replicaId,
        batch,
      });
    }
  };

  const requestRepairPage = (
    requestId: string,
    afterCursor: string | null,
  ): Promise<RepairPage> =>
    new Promise((resolve, reject) => {
      pendingRepair.set(requestId, { resolve, reject });
      send({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: CollabMessageType.RepairRequest,
        documentId: options.documentId,
        senderId: options.replicaId,
        requestId,
        afterCursor,
        limit: repairPageSize,
      });
    });

  const runRepair = async (): Promise<void> => {
    setConnectionState(CollabConnectionState.Repairing);
    let afterCursor = await storage.getRepairCursor(options.documentId);
    let hasMore = true;
    while (hasMore && !closed) {
      const requestId = crypto.randomUUID();
      const response = await requestRepairPage(requestId, afterCursor);
      for (const envelope of response.batches) {
        acceptBatch(envelope.batch, "repair");
        markDurable([envelope.batch.batchId]);
        afterCursor = envelope.cursor;
      }
      await storage.setRepairCursor(options.documentId, afterCursor);
      hasMore = response.hasMore;
      if (hasMore) afterCursor = response.nextCursor;
    }
  };

  const settleAuthWaiters = (err: Error | null): void => {
    const waiters = authWaiters;
    authWaiters = [];
    for (const waiter of waiters) {
      if (err) waiter.reject(err);
      else waiter.resolve();
    }
  };

  const waitForAuthOk = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (authenticated) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for auth-ok"));
      }, authTimeoutMs);
      authWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (cause) => {
          clearTimeout(timer);
          reject(cause);
        },
      });
    });

  const handleServerMessage = (raw: unknown): void => {
    const parsed = CollabMessageSchema.safeParse(raw);
    if (!parsed.success) {
      notifyError(new Error(`Invalid collab message: ${parsed.error.message}`));
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case CollabMessageType.AuthOk:
        role = message.role;
        canWrite = message.canWrite;
        userId = message.userId;
        authenticated = true;
        settleAuthWaiters(null);
        emitSnapshot();
        return;
      case CollabMessageType.Event:
        if (message.senderId === options.replicaId) return;
        acceptBatch(message.batch, "remote");
        return;
      case CollabMessageType.RepairResponse: {
        if (message.recipientId !== options.replicaId) return;
        const pending = pendingRepair.get(message.requestId);
        if (!pending) return;
        pendingRepair.delete(message.requestId);
        pending.resolve({
          batches: message.batches,
          nextCursor: message.nextCursor,
          hasMore: message.hasMore,
        });
        return;
      }
      case CollabMessageType.DurableAck:
        markDurable(message.batchIds);
        return;
      case CollabMessageType.Error: {
        const err = new Error(`${message.code}: ${message.message}`);
        if (!authenticated) settleAuthWaiters(err);
        if (
          message.code === CollabErrorCode.Unauthorized ||
          message.code === CollabErrorCode.Forbidden
        ) {
          setConnectionState(CollabConnectionState.Error);
        }
        notifyError(err);
        for (const [, pending] of pendingRepair) pending.reject(err);
        pendingRepair.clear();
        return;
      }
      default:
        return;
    }
  };

  const authenticate = async (): Promise<void> => {
    authenticated = false;
    setConnectionState(CollabConnectionState.Authenticating);
    const accessToken = await options.getAccessToken();
    if (closed) return;
    send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: CollabMessageType.Auth,
      accessToken,
      documentId: options.documentId,
      replicaId: options.replicaId,
    });
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer) return;
    const delay = Math.min(
      reconnectMaxDelayMs,
      reconnectBaseDelayMs * 2 ** reconnectAttempt,
    );
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  };

  const openSocket = (): void => {
    if (closed) return;
    setConnectionState(
      reconnectAttempt > 0
        ? CollabConnectionState.Reconnecting
        : CollabConnectionState.Connecting,
    );
    socket = new WebSocketImpl(options.wsUrl);
    socket.addEventListener("open", () => {
      void (async () => {
        try {
          await authenticate();
          await waitForAuthOk();
          await runRepair();
          if (closed) return;
          ready = true;
          setConnectionState(CollabConnectionState.Ready);
          reconnectAttempt = 0;
          flushPending();
          emitSnapshot();
        } catch (cause) {
          const next =
            cause instanceof Error ? cause : new Error("Collab auth failed");
          notifyError(next);
          socket?.close();
        }
      })();
    });
    socket.addEventListener("message", (event) => {
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        handleServerMessage(data);
      } catch (cause) {
        notifyError(
          cause instanceof Error
            ? cause
            : new Error("Failed to parse collab message"),
        );
      }
    });
    socket.addEventListener("close", () => {
      socket = null;
      ready = false;
      authenticated = false;
      if (closed) {
        setConnectionState(CollabConnectionState.Closed);
        return;
      }
      setConnectionState(CollabConnectionState.Offline);
      scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (!closed) setConnectionState(CollabConnectionState.Error);
    });
  };

  return {
    start: async () => {
      if (started) return;
      started = true;
      const rows: ReadonlyArray<StoredBatchRow> = await storage.loadBatches(
        options.documentId,
      );
      for (const row of rows) {
        knownBatches.set(row.batchId, row.batch);
        if (row.durable) durableBatchIds.add(row.batchId);
        else pendingPublish.add(row.batchId);
        for (const listener of batchListeners) listener(row.batch, "storage");
      }
      emitSnapshot();
      openSocket();
    },

    publishBatch: (candidate) => {
      if (role !== null && !canWrite) {
        notifyError(
          new Error(`${CollabErrorCode.ReadOnly}: document is read-only`),
        );
        return false;
      }
      const batch = acceptBatch(candidate, "local");
      if (batch === null) return false;
      pendingPublish.add(batch.batchId);
      emitSnapshot();
      send({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: CollabMessageType.Event,
        documentId: options.documentId,
        senderId: options.replicaId,
        batch,
      });
      return true;
    },

    reauth: async () => {
      const accessToken = await options.getAccessToken();
      send({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: CollabMessageType.Reauth,
        accessToken,
      });
    },

    getKnownBatches: () => [...knownBatches.values()],
    getSnapshot,
    subscribeBatches: (listener) => {
      batchListeners.add(listener);
      return () => {
        batchListeners.delete(listener);
      };
    },
    subscribeSnapshot: (listener) => {
      snapshotListeners.add(listener);
      listener(getSnapshot());
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    subscribeErrors: (listener) => {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      settleAuthWaiters(new Error("Session closed"));
      for (const [, pending] of pendingRepair) {
        pending.reject(new Error("Session closed"));
      }
      pendingRepair.clear();
      socket?.close();
      socket = null;
      if (ownsStorage) storage.close();
      setConnectionState(CollabConnectionState.Closed);
    },
  };
};
