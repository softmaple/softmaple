import { z } from "zod";
import { type WireBatch, WireBatchSchema } from "./schema";

export const PERSISTENCE_CHANNEL_PROTOCOL_VERSION = 1 as const;
export const PERSISTENCE_CHANNEL_MESSAGE_TYPE = {
  DurableAck: "durable-ack",
  Event: "event",
  RepairRequest: "repair-request",
  RepairResponse: "repair-response",
} as const;

const MessageBaseSchema = z.object({
  protocolVersion: z.literal(PERSISTENCE_CHANNEL_PROTOCOL_VERSION),
  roomId: z.string().trim().min(1),
  senderId: z.string().trim().min(1),
});

const EventMessageSchema = MessageBaseSchema.extend({
  type: z.literal(PERSISTENCE_CHANNEL_MESSAGE_TYPE.Event),
  batch: WireBatchSchema,
}).strict();

const RepairRequestMessageSchema = MessageBaseSchema.extend({
  type: z.literal(PERSISTENCE_CHANNEL_MESSAGE_TYPE.RepairRequest),
  requestId: z.string().trim().min(1),
  knownBatchIds: z.array(z.string().trim().min(1)),
}).strict();

const RepairResponseMessageSchema = MessageBaseSchema.extend({
  type: z.literal(PERSISTENCE_CHANNEL_MESSAGE_TYPE.RepairResponse),
  requestId: z.string().trim().min(1),
  recipientId: z.string().trim().min(1),
  batches: z.array(WireBatchSchema),
}).strict();

const DurableAckMessageSchema = MessageBaseSchema.extend({
  type: z.literal(PERSISTENCE_CHANNEL_MESSAGE_TYPE.DurableAck),
  batchIds: z.array(z.string().trim().min(1)),
}).strict();

export const PersistenceChannelMessageSchema = z.discriminatedUnion("type", [
  EventMessageSchema,
  RepairRequestMessageSchema,
  RepairResponseMessageSchema,
  DurableAckMessageSchema,
]);

export type PersistenceChannelMessage = z.infer<
  typeof PersistenceChannelMessageSchema
>;
export type BatchDeliverySource = "local" | "remote" | "repair" | "storage";
export type BatchListener = (
  batch: WireBatch,
  source: BatchDeliverySource,
) => void;
export type DurableAckListener = (batchIds: ReadonlyArray<string>) => void;
export type ChannelErrorListener = (error: Error) => void;

export interface BroadcastMessageEvent {
  readonly data: unknown;
}

export interface BroadcastChannelLike {
  onmessage: ((event: BroadcastMessageEvent) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

export interface PersistenceChannel {
  publishBatch(batch: WireBatch): boolean;
  seedBatches(batches: ReadonlyArray<WireBatch>): void;
  requestRepair(): string;
  broadcastDurableAck(batchIds: ReadonlyArray<string>): void;
  getKnownBatches(): ReadonlyArray<WireBatch>;
  getKnownBatchIds(): ReadonlySet<string>;
  getDurableBatchIds(): ReadonlySet<string>;
  subscribeBatches(listener: BatchListener): () => void;
  subscribeDurableAcks(listener: DurableAckListener): () => void;
  subscribeErrors(listener: ChannelErrorListener): () => void;
  close(): void;
}

export interface CreatePersistenceChannelOptions {
  readonly roomId: string;
  readonly peerId: string;
  readonly channelFactory?: BroadcastChannelFactory;
  readonly createId?: () => string;
}

export const getPersistenceChannelName = (roomId: string): string =>
  `softmaple:lexical-eg-walker:v1:events:${encodeURIComponent(roomId)}`;

const createNativeBroadcastChannel: BroadcastChannelFactory = (name) => {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("BroadcastChannel is not supported in this environment");
  }
  const nativeChannel = new BroadcastChannel(name);
  let handler: ((event: BroadcastMessageEvent) => void) | null = null;
  nativeChannel.onmessage = (event) => handler?.({ data: event.data });
  return {
    get onmessage() {
      return handler;
    },
    set onmessage(nextHandler) {
      handler = nextHandler;
    },
    postMessage: (message) => nativeChannel.postMessage(message),
    close: () => nativeChannel.close(),
  };
};

const serializeBatch = (batch: WireBatch): string => JSON.stringify(batch);

export const createPersistenceChannel = ({
  roomId,
  peerId,
  channelFactory = createNativeBroadcastChannel,
  createId = () => crypto.randomUUID(),
}: CreatePersistenceChannelOptions): PersistenceChannel => {
  const channel = channelFactory(getPersistenceChannelName(roomId));
  const knownBatches = new Map<string, WireBatch>();
  const durableBatchIds = new Set<string>();
  const batchListeners = new Set<BatchListener>();
  const durableAckListeners = new Set<DurableAckListener>();
  const errorListeners = new Set<ChannelErrorListener>();
  let closed = false;

  const notifyError = (error: Error): void => {
    for (const listener of errorListeners) listener(error);
  };

  const acceptBatch = (
    candidate: WireBatch,
    source: BatchDeliverySource,
  ): boolean => {
    const batch = WireBatchSchema.parse(candidate);
    const existing = knownBatches.get(batch.batchId);
    if (existing) {
      if (serializeBatch(existing) !== serializeBatch(batch)) {
        notifyError(
          new Error(`Conflicting payloads received for batch ${batch.batchId}`),
        );
      }
      return false;
    }

    knownBatches.set(batch.batchId, batch);
    for (const listener of batchListeners) listener(batch, source);
    return true;
  };

  const markDurable = (batchIds: ReadonlyArray<string>): string[] => {
    const newlyDurable: string[] = [];
    for (const batchId of batchIds) {
      if (durableBatchIds.has(batchId)) continue;
      durableBatchIds.add(batchId);
      newlyDurable.push(batchId);
    }
    if (newlyDurable.length > 0) {
      for (const listener of durableAckListeners) listener(newlyDurable);
    }
    return newlyDurable;
  };

  const postMessage = (message: PersistenceChannelMessage): void => {
    if (closed) return;
    try {
      channel.postMessage(message);
    } catch (error) {
      notifyError(
        error instanceof Error
          ? error
          : new Error("Failed to send persistence channel message"),
      );
    }
  };

  channel.onmessage = (event) => {
    if (closed) return;
    const parsed = PersistenceChannelMessageSchema.safeParse(event.data);
    if (!parsed.success) {
      notifyError(
        new Error(
          `Invalid persistence channel message: ${parsed.error.message}`,
        ),
      );
      return;
    }

    const message = parsed.data;
    if (message.roomId !== roomId || message.senderId === peerId) return;

    switch (message.type) {
      case PERSISTENCE_CHANNEL_MESSAGE_TYPE.Event:
        acceptBatch(message.batch, "remote");
        return;
      case PERSISTENCE_CHANNEL_MESSAGE_TYPE.RepairRequest: {
        const requesterKnown = new Set(message.knownBatchIds);
        const missing = [...knownBatches.values()].filter(
          (batch) => !requesterKnown.has(batch.batchId),
        );
        if (missing.length === 0) return;
        postMessage({
          protocolVersion: PERSISTENCE_CHANNEL_PROTOCOL_VERSION,
          type: PERSISTENCE_CHANNEL_MESSAGE_TYPE.RepairResponse,
          roomId,
          senderId: peerId,
          recipientId: message.senderId,
          requestId: message.requestId,
          batches: missing,
        });
        return;
      }
      case PERSISTENCE_CHANNEL_MESSAGE_TYPE.RepairResponse:
        if (message.recipientId !== peerId) return;
        for (const batch of message.batches) acceptBatch(batch, "repair");
        return;
      case PERSISTENCE_CHANNEL_MESSAGE_TYPE.DurableAck:
        markDurable(message.batchIds);
        return;
    }
  };

  return {
    publishBatch: (candidate) => {
      const batch = WireBatchSchema.parse(candidate);
      if (!acceptBatch(batch, "local")) return false;
      postMessage({
        protocolVersion: PERSISTENCE_CHANNEL_PROTOCOL_VERSION,
        type: PERSISTENCE_CHANNEL_MESSAGE_TYPE.Event,
        roomId,
        senderId: peerId,
        batch,
      });
      return true;
    },
    seedBatches: (batches) => {
      for (const batch of batches) acceptBatch(batch, "storage");
    },
    requestRepair: () => {
      const requestId = createId();
      postMessage({
        protocolVersion: PERSISTENCE_CHANNEL_PROTOCOL_VERSION,
        type: PERSISTENCE_CHANNEL_MESSAGE_TYPE.RepairRequest,
        roomId,
        senderId: peerId,
        requestId,
        knownBatchIds: [...knownBatches.keys()],
      });
      return requestId;
    },
    broadcastDurableAck: (batchIds) => {
      const newlyDurable = markDurable(batchIds);
      if (newlyDurable.length === 0) return;
      postMessage({
        protocolVersion: PERSISTENCE_CHANNEL_PROTOCOL_VERSION,
        type: PERSISTENCE_CHANNEL_MESSAGE_TYPE.DurableAck,
        roomId,
        senderId: peerId,
        batchIds: newlyDurable,
      });
    },
    getKnownBatches: () => [...knownBatches.values()],
    getKnownBatchIds: () => new Set(knownBatches.keys()),
    getDurableBatchIds: () => new Set(durableBatchIds),
    subscribeBatches: (listener) => {
      batchListeners.add(listener);
      return () => batchListeners.delete(listener);
    },
    subscribeDurableAcks: (listener) => {
      durableAckListeners.add(listener);
      return () => durableAckListeners.delete(listener);
    },
    subscribeErrors: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    close: () => {
      if (closed) return;
      closed = true;
      channel.onmessage = null;
      channel.close();
      batchListeners.clear();
      durableAckListeners.clear();
      errorListeners.clear();
    },
  };
};
