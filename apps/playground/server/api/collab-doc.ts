/**
 * WebSocket relay for Lexical EG-walker document sync.
 *
 * Speaks the playground persistence-channel protocol
 * (`apps/playground/src/modules/lexical-eg-walker/persistence/channel.ts`):
 * event / repair-request / repair-response / durable-ack.
 *
 * Keeps an in-memory batch log per room so late joiners can repair even when
 * no other browser tab is online.
 */

import { defineWebSocketHandler } from "nitro";
import type { EventHandler } from "nitro/h3";

const ROOM_TOPIC = "doc";
const MAX_BATCHES_PER_ROOM = 500;

type WireBatch = {
  readonly batchId: string;
  readonly [key: string]: unknown;
};

type DocMessage = {
  readonly protocolVersion: number;
  readonly type: string;
  readonly roomId: string;
  readonly senderId: string;
  readonly batch?: WireBatch;
  readonly requestId?: string;
  readonly recipientId?: string;
  readonly knownBatchIds?: ReadonlyArray<string>;
  readonly batches?: ReadonlyArray<WireBatch>;
  readonly batchIds?: ReadonlyArray<string>;
};

type RoomState = {
  readonly batches: Map<string, WireBatch>;
  readonly peers: Set<object>;
};

const rooms = new Map<string, RoomState>();

const getRoom = (roomId: string): RoomState => {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const created: RoomState = { batches: new Map(), peers: new Set() };
  rooms.set(roomId, created);
  return created;
};

const putBatch = (room: RoomState, batch: WireBatch): void => {
  if (room.batches.has(batch.batchId)) {
    room.batches.set(batch.batchId, batch);
    return;
  }
  while (room.batches.size >= MAX_BATCHES_PER_ROOM) {
    const oldest = room.batches.keys().next().value;
    if (oldest === undefined) break;
    room.batches.delete(oldest);
  }
  room.batches.set(batch.batchId, batch);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === "string" && item.length > 0);

const parseDocMessage = (raw: string): DocMessage | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.protocolVersion !== "number") return null;
    if (typeof parsed.type !== "string") return null;
    if (typeof parsed.roomId !== "string" || parsed.roomId.length === 0)
      return null;
    if (typeof parsed.senderId !== "string" || parsed.senderId.length === 0)
      return null;
    if (
      parsed.knownBatchIds !== undefined &&
      !isStringArray(parsed.knownBatchIds)
    ) {
      return null;
    }
    return parsed as unknown as DocMessage;
  } catch {
    return null;
  }
};

const roomIdFromPeer = (peer: {
  context: Record<string, unknown>;
  request?: { url?: string };
}): string | null => {
  const fromContext = peer.context.roomId;
  if (typeof fromContext === "string" && fromContext.length > 0) {
    return fromContext;
  }
  const url = peer.request?.url;
  if (typeof url !== "string") return null;
  return new URL(url).searchParams.get("roomId");
};

const handler: EventHandler = defineWebSocketHandler({
  upgrade(request) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId")?.trim();
    if (!roomId) {
      throw new Response("roomId query parameter is required", { status: 400 });
    }
    return {
      namespace: `collab-doc:${roomId}`,
      context: { roomId },
    };
  },

  open(peer) {
    const roomId = roomIdFromPeer(peer);
    if (!roomId) {
      peer.close(1008, "Missing roomId");
      return;
    }
    peer.context.roomId = roomId;
    getRoom(roomId).peers.add(peer);
    peer.subscribe(ROOM_TOPIC);
  },

  message(peer, message) {
    const roomId = roomIdFromPeer(peer);
    if (!roomId) return;

    const parsed = parseDocMessage(message.text());
    if (parsed === null || parsed.roomId !== roomId) return;

    const room = getRoom(roomId);

    switch (parsed.type) {
      case "event": {
        if (parsed.batch && typeof parsed.batch.batchId === "string") {
          putBatch(room, parsed.batch);
        }
        peer.publish(ROOM_TOPIC, parsed);
        return;
      }
      case "repair-request": {
        const known = new Set(parsed.knownBatchIds ?? []);
        const missing = [...room.batches.values()].filter(
          (batch) => !known.has(batch.batchId),
        );
        // Always relay so peer-held history can still help.
        peer.publish(ROOM_TOPIC, parsed);
        if (missing.length === 0 || typeof parsed.requestId !== "string") {
          return;
        }
        peer.send({
          protocolVersion: parsed.protocolVersion,
          type: "repair-response",
          roomId,
          senderId: "server",
          recipientId: parsed.senderId,
          requestId: parsed.requestId,
          batches: missing,
        });
        return;
      }
      case "repair-response":
      case "durable-ack":
        peer.publish(ROOM_TOPIC, parsed);
        return;
      default:
        return;
    }
  },

  close(peer) {
    peer.unsubscribe(ROOM_TOPIC);
    const roomId = roomIdFromPeer(peer);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.peers.delete(peer);
    if (room.peers.size === 0) {
      rooms.delete(roomId);
    }
  },
});

export default handler;
