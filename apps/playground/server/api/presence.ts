/**
 * WebSocket presence server for `@softmaple/awareness` `createWebSocketAdapter`.
 *
 * Frame contract matches protocol v2 in `packages/awareness` (connectionId keys,
 * auth_ok, clock ordering, heartbeat pingId ACK).
 */

import { defineWebSocketHandler } from "nitro";
import type { EventHandler } from "nitro/h3";
import {
  buildCloseLeaveMessage,
  createPresenceRoomStore,
  handlePresenceFrame,
  parsePresenceMessage,
  type PeerSession,
  startPresenceRoomMaintenance,
} from "./presence-room";

const ROOM_TOPIC = "presence";

const store = createPresenceRoomStore();
const stopMaintenance = startPresenceRoomMaintenance(store);

if (typeof process !== "undefined" && typeof process.on === "function") {
  const shutdown = (): void => {
    stopMaintenance();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

const roomIdFromPeer = (peer: {
  context: PeerSession;
  request?: { url?: string };
}): string | null => {
  if (typeof peer.context.roomId === "string" && peer.context.roomId.length > 0) {
    return peer.context.roomId;
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
      namespace: `presence:${roomId}`,
      context: { roomId } satisfies PeerSession,
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

    const parsed = parsePresenceMessage(message.text());
    if (parsed === null) return;

    const result = handlePresenceFrame(store, roomId, parsed, peer.context);
    if (result.session !== undefined) {
      if (result.session.connectionId !== undefined) {
        peer.context.connectionId = result.session.connectionId;
      }
      if (result.session.userId !== undefined) {
        peer.context.userId = result.session.userId;
      }
    }
    for (const outbound of result.outbound) {
      try {
        peer.send(outbound);
      } catch {
        // Do not block publish when a direct reply fails.
      }
    }
    if (result.publish !== null) {
      peer.publish(ROOM_TOPIC, result.publish);
    }
  },

  close(peer) {
    const roomId = roomIdFromPeer(peer);
    const connectionId = peer.context.connectionId;
    const userId = peer.context.userId;
    peer.unsubscribe(ROOM_TOPIC);
    if (
      !roomId ||
      typeof connectionId !== "string" ||
      typeof userId !== "string"
    ) {
      return;
    }
    if (!store.leave(roomId, connectionId)) return;
    peer.publish(
      ROOM_TOPIC,
      buildCloseLeaveMessage(roomId, connectionId, userId),
    );
    store.deleteRoomIfEmpty(roomId);
  },
});

export default handler;
