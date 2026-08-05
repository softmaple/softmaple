/**
 * Transport selection for the Lexical EG-walker demo.
 *
 * Document sync and presence both default to same-origin WebSocket servers
 * under `/api/collab-doc` and `/api/presence`. Pass `?transport=broadcast` to
 * fall back to BroadcastChannel (same-origin tabs only).
 */

import {
  createBroadcastChannelAdapter,
  createWebSocketAdapter,
  type PresenceAdapter,
} from "@softmaple/awareness";
import {
  COLLAB_TRANSPORT,
  type CollabEndpoints,
  resolveBrowserCollabEndpoints,
} from "@/modules/collab-transport/urls";
import { createWebSocketBroadcastChannelFactory } from "@/modules/collab-transport/websocket-broadcast-channel";
import type { BroadcastChannelFactory } from "@/modules/lexical-eg-walker/persistence/channel";
import type { RoomIdentity } from "./presence";

export type LexicalCollabTransportMode = CollabEndpoints["transport"];

export interface LexicalRoomTransport {
  readonly mode: LexicalCollabTransportMode;
  readonly channelFactory: BroadcastChannelFactory | undefined;
  readonly createPresenceAdapter: (identity: RoomIdentity) => PresenceAdapter;
}

const presenceRoomId = (roomId: string): string =>
  `lexical-eg-walker:${roomId}`;

export const resolveLexicalRoomTransport = (
  roomId: string,
  endpoints: CollabEndpoints = resolveBrowserCollabEndpoints({
    envTransport: import.meta.env.VITE_COLLAB_TRANSPORT,
    docWsUrl: import.meta.env.VITE_COLLAB_DOC_WS_URL,
    presenceWsUrl: import.meta.env.VITE_COLLAB_PRESENCE_WS_URL,
  }),
): LexicalRoomTransport => {
  if (
    endpoints.transport === COLLAB_TRANSPORT.WebSocket &&
    endpoints.docWsUrl !== null &&
    endpoints.presenceWsUrl !== null
  ) {
    const docWsUrl = endpoints.docWsUrl;
    const presenceWsUrl = endpoints.presenceWsUrl;
    return {
      mode: COLLAB_TRANSPORT.WebSocket,
      channelFactory: createWebSocketBroadcastChannelFactory(docWsUrl, roomId),
      createPresenceAdapter: (identity) =>
        createWebSocketAdapter({
          url: presenceWsUrl,
          roomId: presenceRoomId(roomId),
          userInfo: identity,
          heartbeatIntervalMs: 2_000,
          reconnect: {
            enabled: true,
            baseDelayMs: 500,
            maxDelayMs: 8_000,
            maxAttempts: 50,
          },
        }),
    };
  }

  return {
    mode: COLLAB_TRANSPORT.Broadcast,
    channelFactory: undefined,
    createPresenceAdapter: (identity) =>
      createBroadcastChannelAdapter({
        roomId: presenceRoomId(roomId),
        userInfo: identity,
        heartbeatIntervalMs: 2_000,
        offlineTimeoutMs: 7_000,
        idleTimeoutMs: 30_000,
      }),
  };
};
