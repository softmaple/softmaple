import {
  BOOTSTRAP_BLOCK_ID,
  createBlockReplica,
  type BlockReplica,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import {
  COLLAB_ACCESS_MODE,
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  type ClientCollabMessage,
  type ServerCollabMessage,
} from "@softmaple/collab-protocol";
import {
  DEFAULT_DOCUMENT_ROOM_POLICY,
  ROOM_LEAVE_REASON,
  createDocumentRoom,
  type ConnectionLimiter,
  type DocumentRoom,
  type DocumentRoomScheduler,
  type DocumentSessionHooks,
  type RoomPeer,
} from "@softmaple/collab-runtime";
import { randomUUID } from "node:crypto";
import { createRealtimeRoomFanout } from "../../server/adapters/redis-room-fanout";
import {
  documentRealtimeChannel,
  LocalTopicHub,
  TopicBridge,
} from "../../server/utils/realtime";
import type {
  RealtimeBus,
  RealtimeHandler,
} from "../../server/utils/realtime/types";
import {
  createInMemoryEventStore,
  type InMemoryEventStore,
} from "./inMemoryEventStore";

const MAX_BATCHES_PER_SEND = 64;

type OutgoingQueue = {
  readonly add: (batches: ReadonlyArray<RichTextEventBatch>) => void;
  readonly flush: () => boolean;
  readonly acknowledge: (batchIds: ReadonlyArray<string>) => boolean;
  readonly resetInFlight: () => void;
  readonly peekPending: () => ReadonlyArray<RichTextEventBatch>;
  readonly hasPending: () => boolean;
  readonly hasInFlight: () => boolean;
};

/**
 * Minimal copy of the browser outgoing-queue invariant for harness clients.
 * Kept local so collab tests do not import apps/web modules.
 */
const createOutgoingQueue = (
  send: (batches: ReadonlyArray<RichTextEventBatch>) => boolean,
): OutgoingQueue => {
  const pending = new Map<string, RichTextEventBatch>();
  const inFlight = new Set<string>();

  const flush = (): boolean => {
    if (inFlight.size > 0 || pending.size === 0) return false;
    const chunk = [...pending.values()].slice(0, MAX_BATCHES_PER_SEND);
    if (chunk.length === 0 || !send(chunk)) return false;
    for (const batch of chunk) {
      inFlight.add(batch.batchId);
    }
    return true;
  };

  return {
    add(batches) {
      for (const batch of batches) {
        pending.set(batch.batchId, batch);
      }
    },
    flush,
    acknowledge(batchIds) {
      for (const batchId of batchIds) {
        pending.delete(batchId);
        inFlight.delete(batchId);
      }
      return flush();
    },
    resetInFlight() {
      inFlight.clear();
    },
    peekPending: () => [...pending.values()],
    hasPending: () => pending.size > 0,
    hasInFlight: () => inFlight.size > 0,
  };
};

type PendingDelivery = {
  readonly channel: string;
  readonly payload: unknown;
  readonly handler: RealtimeHandler;
};

/**
 * Shared bus that can defer/duplicate fan-out while keeping instance hubs
 * independently owned. Immediate mode matches MemoryRealtimeBus timing.
 */
class ControllableRealtimeBus implements RealtimeBus {
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly pending: PendingDelivery[] = [];
  private closed = false;
  deliveryMode: "immediate" | "deferred" = "immediate";

  async publish(channel: string, payload: unknown): Promise<void> {
    if (this.closed) throw new Error("Realtime bus is closed");
    const handlers = [...(this.handlers.get(channel) ?? [])];
    if (this.deliveryMode === "immediate") {
      await Promise.all(
        handlers.map(async (handler) => {
          await handler(payload);
        }),
      );
      return;
    }
    for (const handler of handlers) {
      this.pending.push({ channel, payload, handler });
    }
  }

  async subscribe(
    channel: string,
    handler: RealtimeHandler,
  ): Promise<() => Promise<void>> {
    if (this.closed) throw new Error("Realtime bus is closed");
    const existing = this.handlers.get(channel) ?? new Set<RealtimeHandler>();
    existing.add(handler);
    this.handlers.set(channel, existing);
    return async () => {
      const current = this.handlers.get(channel);
      current?.delete(handler);
      if (current?.size === 0) this.handlers.delete(channel);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
    this.pending.length = 0;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  async deliverNext(): Promise<boolean> {
    const next = this.pending.shift();
    if (next === undefined) return false;
    await next.handler(next.payload);
    return true;
  }

  async deliverAll(): Promise<number> {
    let count = 0;
    while (await this.deliverNext()) {
      count += 1;
    }
    return count;
  }

  /** Re-queue the front delivery so the same payload is applied twice. */
  duplicateNext(): boolean {
    const next = this.pending[0];
    if (next === undefined) return false;
    this.pending.splice(1, 0, { ...next });
    return true;
  }

  /** Move the front delivery behind the next one when both exist. */
  reorderNextPair(): boolean {
    if (this.pending.length < 2) return false;
    const [first, second, ...rest] = this.pending;
    this.pending.length = 0;
    this.pending.push(second, first, ...rest);
    return true;
  }
}

type WorkItem = () => Promise<void>;

class WorkQueue {
  private readonly items: WorkItem[] = [];
  private running = false;

  enqueue(work: WorkItem): void {
    this.items.push(work);
  }

  size(): number {
    return this.items.length;
  }

  async runOne(): Promise<boolean> {
    if (this.running || this.items.length === 0) return false;
    this.running = true;
    const work = this.items.shift();
    try {
      if (work) await work();
    } finally {
      this.running = false;
    }
    return true;
  }

  async runAll(): Promise<number> {
    let count = 0;
    while (await this.runOne()) {
      count += 1;
    }
    return count;
  }
}

export type HarnessConflict = {
  readonly code: typeof COLLAB_ERROR_CODE.Conflict;
  readonly message: string;
  readonly retryable: boolean;
};

export type HarnessClient = {
  readonly id: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly instanceName: string;
  readonly replica: BlockReplica;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly isConnected: () => boolean;
  readonly isSynced: () => boolean;
  readonly localInsert: (text: string, offset?: number) => RichTextEventBatch;
  readonly flushOutgoing: () => Promise<void>;
  readonly waitUntilSynced: () => Promise<void>;
  readonly waitUntilIdle: () => Promise<void>;
  readonly pendingBatchIds: () => ReadonlyArray<string>;
  readonly acknowledgedBatchIds: () => ReadonlySet<string>;
  readonly knownBatchIds: () => ReadonlySet<string>;
  /** Event batch IDs enqueued on the current connection generation. */
  readonly sentBatchIdsSinceConnect: () => ReadonlyArray<string>;
  readonly conflicts: () => ReadonlyArray<HarnessConflict>;
  readonly repairRequestCount: () => number;
  readonly documentFingerprint: () => string;
};

type ConnectedPeer = RoomPeer & {
  client?: HarnessClientInternal;
  readonly generation: number;
};

type HarnessClientInternal = HarnessClient & {
  readonly receive: (message: ServerCollabMessage) => Promise<void>;
  readonly enqueueClientMessage: (message: ClientCollabMessage) => void;
};

export type CollabInstance = {
  readonly name: string;
  readonly hub: LocalTopicHub;
  readonly bridge: TopicBridge;
  readonly room: DocumentRoom;
  readonly localPeerCount: (documentId: string) => number;
  readonly connectClient: (options: {
    readonly id: string;
    readonly actorId: string;
  }) => Promise<HarnessClient>;
  readonly close: () => Promise<void>;
};

export type CollabConsistencyHarness = {
  readonly documentId: string;
  readonly store: InMemoryEventStore;
  readonly bus: ControllableRealtimeBus;
  readonly createInstance: (name: string) => CollabInstance;
  readonly setDeliveryMode: (mode: "immediate" | "deferred") => void;
  readonly deliverNext: () => Promise<boolean>;
  readonly deliverAll: () => Promise<number>;
  readonly duplicateNextDelivery: () => boolean;
  readonly reorderNextDeliveryPair: () => boolean;
  readonly pendingDeliveries: () => number;
  /** Drain protocol work + deferred fan-out until quiescent. */
  readonly settle: () => Promise<void>;
  /**
   * Run a bounded number of protocol queue turns without draining fan-out.
   * Used to interleave repair pages with live commits.
   */
  readonly pumpProtocol: (maxTurns?: number) => Promise<number>;
  /**
   * Advance the protocol queue one turn at a time until `predicate` holds.
   * Fails clearly when the turn budget is exhausted.
   */
  readonly pumpUntil: (
    predicate: () => boolean,
    maxTurns?: number,
  ) => Promise<number>;
  readonly protocolQueueSize: () => number;
  readonly assertReplicasConverged: (
    clients: ReadonlyArray<HarnessClient>,
  ) => void;
  readonly close: () => Promise<void>;
};

const HARNESS_SCHEDULER: DocumentRoomScheduler = {
  now: () => Date.now(),
  repeat: () => ({ cancel() {} }),
};

const HARNESS_CONNECTIONS: ConnectionLimiter = {
  async acquire() {
    let released = false;
    return {
      accepted: true,
      lease: {
        async refresh() {
          return !released;
        },
        async release() {
          released = true;
        },
      },
    };
  },
};

const fingerprintDocument = (replica: BlockReplica): string =>
  JSON.stringify(replica.getDocument());

const waitFor = async (
  predicate: () => boolean,
  label: string,
  timeoutMs = 2_000,
): Promise<void> => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    // Macrotask yield so timer-/IO-backed work can progress between polls.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

export const createCollabConsistencyHarness = (options?: {
  readonly documentId?: string;
  readonly pageSize?: number;
}): CollabConsistencyHarness => {
  const documentId =
    options?.documentId ?? "00000000-0000-4000-8000-000000000099";
  const store = createInMemoryEventStore({
    pageSize: options?.pageSize ?? 100,
  });
  const bus = new ControllableRealtimeBus();
  const protocolQueue = new WorkQueue();
  const instances = new Map<string, CollabInstance>();
  const actorByPeerId = new Map<string, string>();
  const sessions: DocumentSessionHooks = {
    async authorize({ peerId }) {
      const actorId = actorByPeerId.get(peerId);
      if (actorId === undefined) return null;
      return {
        accessMode: COLLAB_ACCESS_MODE.Authenticated,
        actorId,
        role: "EDITOR",
        canWrite: true,
      };
    },
    async refresh({ session }) {
      if (session.accessMode !== COLLAB_ACCESS_MODE.Authenticated) return null;
      return {
        accessMode: COLLAB_ACCESS_MODE.Authenticated,
        actorId: session.actorId,
        role: "EDITOR",
        canWrite: true,
      };
    },
  };
  let settleInFlight: Promise<void> | null = null;

  const enqueueProtocol = (work: WorkItem): void => {
    protocolQueue.enqueue(work);
  };

  const isActivePeer = (
    peer: ConnectedPeer,
    generation: number,
    activeGeneration: () => number,
    currentPeer: () => ConnectedPeer | null,
  ): peer is ConnectedPeer & { readonly client: HarnessClientInternal } =>
    peer.generation === generation &&
    activeGeneration() === generation &&
    currentPeer() === peer &&
    peer.client !== undefined;

  const handleClientMessage = async (
    instance: { readonly room: DocumentRoom },
    peer: ConnectedPeer,
    message: ClientCollabMessage,
    generation: number,
    activeGeneration: () => number,
    currentPeer: () => ConnectedPeer | null,
  ): Promise<void> => {
    if (!isActivePeer(peer, generation, activeGeneration, currentPeer)) {
      return;
    }
    await instance.room.receive(peer, message);
  };

  const createClient = (
    instance: CollabInstance,
    clientOptions: { readonly id: string; readonly actorId: string },
  ): HarnessClientInternal => {
    const replica = createBlockReplica(clientOptions.id);
    const knownBatches = new Map(
      replica.exportEvents().map((batch) => [batch.batchId, batch] as const),
    );
    const acknowledged = new Set<string>();
    const conflicts: HarnessConflict[] = [];
    const sentSinceConnect: string[] = [];
    let peer: ConnectedPeer | null = null;
    let peerGeneration = 0;
    let synced = false;
    let connected = false;
    let activeRepairRequestId: string | null = null;
    let repairCursor: string | null = null;
    let repairRequests = 0;

    const applyBatches = (batches: ReadonlyArray<RichTextEventBatch>): void => {
      for (const batch of batches) {
        if (knownBatches.has(batch.batchId)) continue;
        knownBatches.set(batch.batchId, batch);
        replica.applyRemoteEvents(batch);
      }
    };

    const enqueueClientMessage = (message: ClientCollabMessage): void => {
      if (peer === null || !connected) {
        throw new Error(`Client ${clientOptions.id} is not connected`);
      }
      const activePeer = peer;
      const generation = activePeer.generation;
      if (message.type === COLLAB_MESSAGE_TYPE.Event) {
        for (const batch of message.batches) {
          sentSinceConnect.push(batch.batchId);
        }
      }
      enqueueProtocol(async () => {
        await handleClientMessage(
          instance,
          activePeer,
          message,
          generation,
          () => peerGeneration,
          () => peer,
        );
      });
    };

    const outgoing = createOutgoingQueue((batches) => {
      enqueueClientMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Event,
        batches,
      });
      return true;
    });

    const requestRepair = (afterCursor: string): void => {
      const requestId = randomUUID();
      activeRepairRequestId = requestId;
      repairRequests += 1;
      enqueueClientMessage({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.RepairRequest,
        requestId,
        afterCursor,
      });
    };

    const publishPending = (): void => {
      if (!synced) return;
      outgoing.flush();
    };

    const client: HarnessClientInternal = {
      id: clientOptions.id,
      actorId: clientOptions.actorId,
      sessionId: randomUUID(),
      instanceName: instance.name,
      replica,
      enqueueClientMessage,
      async connect() {
        if (connected) return;
        peerGeneration += 1;
        sentSinceConnect.length = 0;
        const nextPeer: ConnectedPeer = {
          id: `${instance.name}:${clientOptions.id}:${peerGeneration}:${randomUUID()}`,
          generation: peerGeneration,
          close() {
            connected = false;
            synced = false;
          },
          send(message: ServerCollabMessage) {
            const generation = nextPeer.generation;
            enqueueProtocol(async () => {
              if (
                !isActivePeer(
                  nextPeer,
                  generation,
                  () => peerGeneration,
                  () => peer,
                )
              ) {
                return;
              }
              await client.receive(message);
            });
          },
        };
        nextPeer.client = client;
        peer = nextPeer;
        connected = true;
        actorByPeerId.set(nextPeer.id, clientOptions.actorId);
        await instance.room.join(nextPeer);
        enqueueClientMessage({
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Auth,
          credential: { kind: "access-token", token: "test-token" },
          documentId,
          sessionId: client.sessionId,
        });
      },
      async disconnect() {
        if (!connected || peer === null) return;
        const disconnecting = peer;
        // Invalidate queued work for this connection generation first.
        peerGeneration += 1;
        peer = null;
        connected = false;
        synced = false;
        activeRepairRequestId = null;
        outgoing.resetInFlight();
        actorByPeerId.delete(disconnecting.id);
        await instance.room.leave(
          disconnecting,
          ROOM_LEAVE_REASON.ConnectionClosed,
        );
      },
      isConnected: () => connected,
      isSynced: () => synced,
      localInsert(text, offset = 0) {
        const batch = replica.transact((transaction) => {
          transaction.insertText(BOOTSTRAP_BLOCK_ID, offset, text);
        });
        if (batch === null) {
          throw new Error("expected local batch from insert");
        }
        knownBatches.set(batch.batchId, batch);
        outgoing.add([batch]);
        publishPending();
        return batch;
      },
      async flushOutgoing() {
        publishPending();
        await settleLoop();
        await waitFor(
          () => !outgoing.hasPending() && !outgoing.hasInFlight(),
          `client ${clientOptions.id} outgoing drain`,
        );
      },
      async waitUntilSynced() {
        await settleLoop();
        await waitFor(() => synced, `client ${clientOptions.id} sync`);
      },
      async waitUntilIdle() {
        await settleLoop();
        await waitFor(
          () => synced && !outgoing.hasPending() && !outgoing.hasInFlight(),
          `client ${clientOptions.id} idle`,
        );
      },
      pendingBatchIds: () =>
        outgoing.peekPending().map((batch) => batch.batchId),
      acknowledgedBatchIds: () => acknowledged,
      knownBatchIds: () => new Set(knownBatches.keys()),
      sentBatchIdsSinceConnect: () => [...sentSinceConnect],
      conflicts: () => [...conflicts],
      repairRequestCount: () => repairRequests,
      documentFingerprint: () => fingerprintDocument(replica),
      async receive(message) {
        switch (message.type) {
          case COLLAB_MESSAGE_TYPE.Ready:
            synced = false;
            requestRepair(repairCursor ?? "0");
            return;
          case COLLAB_MESSAGE_TYPE.RepairResponse:
            if (message.requestId !== activeRepairRequestId) return;
            applyBatches(message.batches);
            if (
              repairCursor === null ||
              BigInt(message.nextCursor) > BigInt(repairCursor)
            ) {
              repairCursor = message.nextCursor;
            }
            if (!message.complete) {
              requestRepair(message.nextCursor);
              return;
            }
            activeRepairRequestId = null;
            synced = true;
            publishPending();
            return;
          case COLLAB_MESSAGE_TYPE.Event:
            applyBatches(message.batches);
            return;
          case COLLAB_MESSAGE_TYPE.DurableAck:
            for (const batchId of message.batchIds) {
              acknowledged.add(batchId);
            }
            outgoing.acknowledge(message.batchIds);
            return;
          case COLLAB_MESSAGE_TYPE.Error:
            if (message.code === COLLAB_ERROR_CODE.Conflict) {
              conflicts.push({
                code: COLLAB_ERROR_CODE.Conflict,
                message: message.message,
                retryable: message.retryable,
              });
              // Fatal conflicts do not auto-reconnect in this harness.
              synced = false;
              return;
            }
            return;
        }
      },
    };

    return client;
  };

  const settleLoop = (): Promise<void> => {
    if (settleInFlight !== null) return settleInFlight;
    settleInFlight = (async () => {
      try {
        for (let turn = 0; turn < 10_000; turn += 1) {
          const protocolWork = await protocolQueue.runAll();
          const fanoutWork =
            bus.deliveryMode === "deferred" ? await bus.deliverAll() : 0;
          if (protocolWork === 0 && fanoutWork === 0) return;
        }
        throw new Error("Harness settle exceeded turn budget");
      } finally {
        settleInFlight = null;
      }
    })();
    return settleInFlight;
  };

  const createInstance = (name: string): CollabInstance => {
    if (instances.has(name)) {
      throw new Error(`Instance ${name} already exists`);
    }
    const hub = new LocalTopicHub();
    const bridge = new TopicBridge(bus, hub);
    const room = createDocumentRoom(documentId, {
      connections: HARNESS_CONNECTIONS,
      events: store,
      fanout: createRealtimeRoomFanout({ bridge, bus, hub }),
      policy: DEFAULT_DOCUMENT_ROOM_POLICY,
      scheduler: HARNESS_SCHEDULER,
      sessions,
    });
    const instance: CollabInstance = {
      name,
      hub,
      bridge,
      room,
      localPeerCount: (id) =>
        hub.localSubscriberCount(
          documentRealtimeChannel(id, COLLAB_PROTOCOL_VERSION),
        ),
      async connectClient(connectOptions) {
        const client = createClient(instance, connectOptions);
        await client.connect();
        return client;
      },
      async close() {
        await room.close();
        await bridge.close();
        hub.clear();
        instances.delete(name);
      },
    };
    instances.set(name, instance);
    return instance;
  };

  return {
    documentId,
    store,
    bus,
    createInstance,
    setDeliveryMode: (mode) => {
      bus.deliveryMode = mode;
    },
    deliverNext: () => bus.deliverNext(),
    deliverAll: () => bus.deliverAll(),
    duplicateNextDelivery: () => bus.duplicateNext(),
    reorderNextDeliveryPair: () => bus.reorderNextPair(),
    pendingDeliveries: () => bus.pendingCount(),
    settle: settleLoop,
    pumpProtocol: (maxTurns = 1) => {
      let count = 0;
      const run = async (): Promise<number> => {
        while (count < maxTurns && (await protocolQueue.runOne())) {
          count += 1;
        }
        return count;
      };
      return run();
    },
    async pumpUntil(predicate, maxTurns = 100) {
      for (let turns = 0; turns < maxTurns; turns += 1) {
        if (predicate()) return turns;
        const advanced = await protocolQueue.runOne();
        if (!advanced) {
          if (predicate()) return turns;
          throw new Error(
            `pumpUntil exhausted with an empty protocol queue after ${turns} turns`,
          );
        }
      }
      if (predicate()) return maxTurns;
      throw new Error(`pumpUntil exceeded turn budget (${maxTurns})`);
    },
    protocolQueueSize: () => protocolQueue.size(),
    assertReplicasConverged(clients) {
      if (clients.length === 0) return;
      const expected = clients[0]!.documentFingerprint();
      for (const client of clients) {
        if (client.documentFingerprint() !== expected) {
          throw new Error(
            `Replicas diverged: ${client.id} !== ${clients[0]!.id}`,
          );
        }
      }
      const durableIds = new Set(store.listBatchIds(documentId));
      for (const client of clients) {
        for (const batchId of client.acknowledgedBatchIds()) {
          if (!durableIds.has(batchId)) {
            throw new Error(
              `Acknowledged batch ${batchId} missing from durable history`,
            );
          }
        }
      }
    },
    async close() {
      await Promise.all(
        [...instances.values()].map((instance) => instance.close()),
      );
      await bus.close();
    },
  };
};

/** Shared causal batch helper for consistency tests. */
export const createCausalBatches = (
  replicaId = "replica-a",
): {
  readonly first: RichTextEventBatch;
  readonly second: RichTextEventBatch;
} => {
  const replica = createBlockReplica(replicaId);
  const first = replica.transact((transaction) => {
    transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
  });
  const second = replica.transact((transaction) => {
    transaction.insertText(BOOTSTRAP_BLOCK_ID, 1, "B");
  });
  if (first === null || second === null) {
    throw new Error("expected local batches");
  }
  return { first, second };
};
