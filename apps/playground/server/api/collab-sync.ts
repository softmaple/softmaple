/**
 * WebSocket relay for the textarea online-collab `SyncAdapter` protocol
 * (`apps/playground/src/modules/collab-editor/types.ts`).
 *
 * Rooms are isolated by the `roomId` field on each SyncMessage. The server
 * also keeps a short in-memory event log so sync-request can be answered when
 * no peer is online.
 */

import { defineWebSocketHandler } from "nitro";
import type { EventHandler } from "nitro/h3";

const ROOM_TOPIC_PREFIX = "sync:";
const MAX_EVENTS_PER_ROOM = 500;

type WireGraphEvent = {
  readonly id: string;
  readonly [key: string]: unknown;
};

type SyncMessage = {
  readonly type: string;
  readonly roomId: string;
  readonly userId: string;
  readonly timestamp: number;
  readonly data?: unknown;
};

type RoomState = {
  readonly events: Map<string, WireGraphEvent>;
  readonly connections: Set<object>;
};

const rooms = new Map<string, RoomState>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRoom = (roomId: string): RoomState => {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const created: RoomState = { events: new Map(), connections: new Set() };
  rooms.set(roomId, created);
  return created;
};

const putEvent = (room: RoomState, event: WireGraphEvent): void => {
  if (room.events.has(event.id)) {
    room.events.set(event.id, event);
    return;
  }
  while (room.events.size >= MAX_EVENTS_PER_ROOM) {
    const oldest = room.events.keys().next().value;
    if (oldest === undefined) break;
    room.events.delete(oldest);
  }
  room.events.set(event.id, event);
};

const parseSyncMessage = (raw: string): SyncMessage | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.type !== "string") return null;
    if (typeof parsed.roomId !== "string" || parsed.roomId.length === 0)
      return null;
    if (typeof parsed.userId !== "string") return null;
    if (typeof parsed.timestamp !== "number") return null;
    return parsed as unknown as SyncMessage;
  } catch {
    return null;
  }
};

const topicFor = (roomId: string): string => `${ROOM_TOPIC_PREFIX}${roomId}`;

const handler: EventHandler = defineWebSocketHandler({
  open(peer) {
    peer.context.rooms = new Set<string>();
  },

  message(peer, message) {
    const parsed = parseSyncMessage(message.text());
    if (parsed === null) return;

    const room = getRoom(parsed.roomId);
    const topic = topicFor(parsed.roomId);
    const subscribed = peer.context.rooms as Set<string>;
    if (!subscribed.has(parsed.roomId)) {
      peer.subscribe(topic);
      subscribed.add(parsed.roomId);
      room.connections.add(peer);
    }

    switch (parsed.type) {
      case "join":
        peer.publish(topic, parsed);
        return;
      case "leave":
        peer.publish(topic, parsed);
        return;
      case "event": {
        if (isRecord(parsed.data) && typeof parsed.data.id === "string") {
          putEvent(room, parsed.data as WireGraphEvent);
        }
        peer.publish(topic, parsed);
        return;
      }
      case "sync-request": {
        peer.publish(topic, parsed);
        if (!isRecord(parsed.data)) return;
        const known = new Set(
          Array.isArray(parsed.data.knownEventIds)
            ? parsed.data.knownEventIds.filter(
                (id): id is string => typeof id === "string",
              )
            : [],
        );
        const missing = [...room.events.values()].filter(
          (event) => !known.has(event.id),
        );
        if (missing.length === 0) return;
        peer.send({
          type: "sync-response",
          roomId: parsed.roomId,
          userId: "server",
          timestamp: Date.now(),
          data: {
            frontier: missing.map((event) => event.id),
            knownEventIds: [...room.events.keys()],
            events: missing,
          },
        });
        return;
      }
      case "sync-response":
      case "presence":
        peer.publish(topic, parsed);
        return;
      default:
        return;
    }
  },

  close(peer) {
    const subscribed = peer.context.rooms as Set<string> | undefined;
    if (!subscribed) return;
    for (const roomId of subscribed) {
      peer.unsubscribe(topicFor(roomId));
      const room = rooms.get(roomId);
      if (!room) continue;
      room.connections.delete(peer);
      if (room.connections.size === 0) {
        rooms.delete(roomId);
      }
    }
    subscribed.clear();
  },
});

export default handler;
