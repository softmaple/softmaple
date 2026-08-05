/**
 * WebSocket presence server for `@softmaple/awareness` `createWebSocketAdapter`.
 *
 * Frame contract matches `packages/awareness/src/adapters/websocket/types.ts`.
 */

import { defineWebSocketHandler } from "nitro";

const ROOM_TOPIC = "presence";

type PresenceUser = {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  readonly [key: string]: unknown;
};

type PresenceMessage = {
  readonly type: string;
  readonly roomId: string;
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload?: unknown;
};

type PeerContext = {
  roomId?: string;
  userId?: string;
};

const rooms = new Map<string, Map<string, PresenceUser>>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseMessage = (raw: string): PresenceMessage | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.type !== "string") return null;
    if (typeof parsed.roomId !== "string") return null;
    if (typeof parsed.senderId !== "string") return null;
    if (typeof parsed.timestamp !== "number") return null;
    return parsed as unknown as PresenceMessage;
  } catch {
    return null;
  }
};

const getRoomUsers = (roomId: string): Map<string, PresenceUser> => {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const created = new Map<string, PresenceUser>();
  rooms.set(roomId, created);
  return created;
};

const roomIdFromPeer = (peer: {
  context: PeerContext;
  request?: { url?: string };
}): string | null => {
  if (typeof peer.context.roomId === "string" && peer.context.roomId.length > 0) {
    return peer.context.roomId;
  }
  const url = peer.request?.url;
  if (typeof url !== "string") return null;
  return new URL(url).searchParams.get("roomId");
};

const send = (
  peer: { send: (data: unknown) => void },
  message: PresenceMessage,
): void => {
  peer.send(message);
};

export default defineWebSocketHandler({
  upgrade(request) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId")?.trim();
    if (!roomId) {
      throw new Response("roomId query parameter is required", { status: 400 });
    }
    return {
      namespace: `presence:${roomId}`,
      context: { roomId } satisfies PeerContext,
    };
  },

  open(peer) {
    const roomId = roomIdFromPeer(peer);
    if (!roomId) {
      peer.close(1008, "Missing roomId");
      return;
    }
    peer.context.roomId = roomId;
    peer.subscribe(ROOM_TOPIC);
  },

  message(peer, message) {
    const roomId = roomIdFromPeer(peer);
    if (!roomId) return;

    const parsed = parseMessage(message.text());
    if (parsed === null) return;

    // Demo auth handshake — accept any token and ignore the frame.
    if (parsed.type === "auth") return;

    if (parsed.roomId !== roomId) return;

    const users = getRoomUsers(roomId);

    switch (parsed.type) {
      case "join": {
        if (!isRecord(parsed.payload) || !isRecord(parsed.payload.user)) return;
        const user = parsed.payload.user as PresenceUser;
        if (typeof user.userId !== "string") return;
        users.set(user.userId, user);
        peer.context.userId = user.userId;
        peer.publish(ROOM_TOPIC, parsed);
        send(peer, {
          type: "presence:sync-response",
          roomId,
          senderId: "server",
          timestamp: Date.now(),
          payload: { users: [...users.values()] },
        });
        return;
      }
      case "leave": {
        const userId =
          isRecord(parsed.payload) && typeof parsed.payload.userId === "string"
            ? parsed.payload.userId
            : parsed.senderId;
        users.delete(userId);
        peer.publish(ROOM_TOPIC, parsed);
        return;
      }
      case "presence:update": {
        if (!isRecord(parsed.payload)) return;
        const userId =
          typeof parsed.payload.userId === "string"
            ? parsed.payload.userId
            : parsed.senderId;
        const existing = users.get(userId);
        if (!existing || !isRecord(parsed.payload.updates)) return;
        users.set(userId, {
          ...existing,
          ...(parsed.payload.updates as Partial<PresenceUser>),
        });
        peer.publish(ROOM_TOPIC, parsed);
        return;
      }
      case "presence:sync":
        send(peer, {
          type: "presence:sync-response",
          roomId,
          senderId: "server",
          timestamp: Date.now(),
          payload: { users: [...users.values()] },
        });
        return;
      case "heartbeat":
        send(peer, {
          type: "heartbeat:ack",
          roomId,
          senderId: "server",
          timestamp: Date.now(),
        });
        return;
      default:
        return;
    }
  },

  close(peer) {
    const roomId = roomIdFromPeer(peer);
    const userId = peer.context.userId;
    peer.unsubscribe(ROOM_TOPIC);
    if (!roomId || typeof userId !== "string") return;
    const users = rooms.get(roomId);
    if (!users?.has(userId)) return;
    users.delete(userId);
    peer.publish(ROOM_TOPIC, {
      type: "leave",
      roomId,
      senderId: "server",
      timestamp: Date.now(),
      payload: { userId },
    });
  },
});
