/**
 * `BroadcastChannelLike` backed by a room-scoped WebSocket.
 *
 * Drop-in replacement for the native BroadcastChannel factory used by the
 * Lexical EG-walker persistence channel, so document sync can ride a real
 * network path instead of same-origin tabs only.
 */

import type {
  BroadcastChannelFactory,
  BroadcastChannelLike,
  BroadcastMessageEvent,
} from "@/modules/lexical-eg-walker/persistence/channel";

export interface WebSocketBroadcastChannelOptions {
  readonly url: string;
  readonly roomId: string;
  readonly reconnectDelayMs?: number;
  readonly webSocketFactory?: (url: string) => WebSocket;
}

const DEFAULT_RECONNECT_DELAY_MS = 1_000;

export const buildDocWebSocketUrl = (
  baseUrl: string,
  roomId: string,
): string => {
  const url = new URL(baseUrl);
  url.searchParams.set("roomId", roomId);
  return url.toString();
};

export const createWebSocketBroadcastChannel = (
  options: WebSocketBroadcastChannelOptions,
): BroadcastChannelLike => {
  const reconnectDelayMs =
    options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const webSocketFactory =
    options.webSocketFactory ?? ((url: string) => new WebSocket(url));
  const wsUrl = buildDocWebSocketUrl(options.url, options.roomId);

  let handler: ((event: BroadcastMessageEvent) => void) | null = null;
  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const outboundQueue: unknown[] = [];

  const clearReconnect = (): void => {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const flushQueue = (): void => {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    while (outboundQueue.length > 0) {
      const next = outboundQueue.shift();
      socket.send(JSON.stringify(next));
    }
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  };

  const connect = (): void => {
    if (closed) return;
    clearReconnect();
    try {
      socket = webSocketFactory(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", () => {
      flushQueue();
    });

    socket.addEventListener("message", (event) => {
      if (handler === null) return;
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        handler({ data });
      } catch {
        // Ignore malformed frames; the persistence channel validates payloads.
      }
    });

    socket.addEventListener("close", () => {
      socket = null;
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // `close` follows and triggers reconnect.
    });
  };

  connect();

  return {
    get onmessage() {
      return handler;
    },
    set onmessage(nextHandler) {
      handler = nextHandler;
    },
    postMessage: (message) => {
      if (closed) return;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return;
      }
      outboundQueue.push(message);
    },
    close: () => {
      if (closed) return;
      closed = true;
      clearReconnect();
      outboundQueue.length = 0;
      handler = null;
      const current = socket;
      socket = null;
      current?.close();
    },
  };
};

export const createWebSocketBroadcastChannelFactory = (
  baseUrl: string,
  roomId: string,
  options: Omit<WebSocketBroadcastChannelOptions, "url" | "roomId"> = {},
): BroadcastChannelFactory => {
  return () =>
    createWebSocketBroadcastChannel({
      ...options,
      url: baseUrl,
      roomId,
    });
};
