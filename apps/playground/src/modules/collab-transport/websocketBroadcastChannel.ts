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
  TransportConnectionListener,
  TransportConnectionState,
} from "@/modules/lexical-eg-walker/persistence/channel";
import { createWebSocketLifecycle } from "./websocketBroadcastChannelLifecycle";

export interface WebSocketBroadcastChannelOptions {
  readonly url: string;
  readonly roomId: string;
  readonly reconnectDelayMs?: number;
  readonly maxReconnectAttempts?: number;
  readonly maxOutboundQueue?: number;
  readonly connectionTimeoutMs?: number;
  readonly webSocketFactory?: (url: string) => WebSocket;
}

const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_MAX_OUTBOUND_QUEUE = 100;

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
  const maxReconnectAttempts =
    options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  const maxOutboundQueue =
    options.maxOutboundQueue ?? DEFAULT_MAX_OUTBOUND_QUEUE;
  const webSocketFactory =
    options.webSocketFactory ?? ((url: string) => new WebSocket(url));
  const wsUrl = buildDocWebSocketUrl(options.url, options.roomId);

  let messageHandler: ((event: BroadcastMessageEvent) => void) | null = null;
  let openHandler: (() => void) | null = null;
  let connectionHandler: TransportConnectionListener | null = null;
  let socket: WebSocket | null = null;
  let closed = false;
  let connectionState: TransportConnectionState = "connecting";
  const outboundQueue: unknown[] = [];

  const setConnectionState = (next: TransportConnectionState): void => {
    if (connectionState === next) return;
    connectionState = next;
    connectionHandler?.(next);
  };

  const lifecycle = createWebSocketLifecycle({
    wsUrl,
    reconnectDelayMs,
    maxReconnectAttempts,
    connectionTimeoutMs: options.connectionTimeoutMs,
    webSocketFactory,
    isClosed: () => closed,
    getConnectionState: () => connectionState,
    setConnectionState,
    getMessageHandler: () => messageHandler,
    getOpenHandler: () => openHandler,
    outboundQueue,
    onSocket: (next) => {
      socket = next;
    },
  });

  lifecycle.connect();

  return {
    get onmessage() {
      return messageHandler;
    },
    set onmessage(nextHandler) {
      messageHandler = nextHandler;
    },
    get onopen() {
      return openHandler;
    },
    set onopen(nextHandler) {
      openHandler = nextHandler ?? null;
    },
    get onconnectionchange() {
      return connectionHandler;
    },
    set onconnectionchange(nextHandler) {
      connectionHandler = nextHandler ?? null;
      // Replay current state so subscribers see the latest value immediately.
      connectionHandler?.(connectionState);
    },
    postMessage: (message) => {
      if (closed) return;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return;
      }
      if (outboundQueue.length >= maxOutboundQueue) {
        outboundQueue.shift();
      }
      outboundQueue.push(message);
    },
    close: () => {
      if (closed) return;
      closed = true;
      lifecycle.clearReconnect();
      outboundQueue.length = 0;
      setConnectionState("disconnected");
      messageHandler = null;
      openHandler = null;
      connectionHandler = null;
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
