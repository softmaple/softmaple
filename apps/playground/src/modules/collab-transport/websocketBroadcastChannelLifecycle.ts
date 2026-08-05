import type {
  BroadcastMessageEvent,
  TransportConnectionState,
} from "@/modules/lexical-eg-walker/persistence/channel";

const MAX_RECONNECT_DELAY_MS = 30_000;

export interface WebSocketLifecycleOptions {
  readonly wsUrl: string;
  readonly reconnectDelayMs: number;
  readonly maxReconnectAttempts: number;
  readonly webSocketFactory: (url: string) => WebSocket;
  readonly isClosed: () => boolean;
  readonly getConnectionState: () => TransportConnectionState;
  readonly setConnectionState: (next: TransportConnectionState) => void;
  readonly getMessageHandler: () =>
    | ((event: BroadcastMessageEvent) => void)
    | null;
  readonly getOpenHandler: () => (() => void) | null;
  readonly outboundQueue: unknown[];
  readonly onSocket: (socket: WebSocket | null) => void;
}

export interface WebSocketLifecycle {
  readonly connect: () => void;
  readonly clearReconnect: () => void;
  readonly scheduleReconnect: () => void;
}

const flushQueue = (
  socket: WebSocket | null,
  outboundQueue: unknown[],
): void => {
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  while (outboundQueue.length > 0) {
    const next = outboundQueue.shift();
    socket.send(JSON.stringify(next));
  }
};

export const createWebSocketLifecycle = (
  options: WebSocketLifecycleOptions,
): WebSocketLifecycle => {
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let socket: WebSocket | null = null;

  const clearReconnect = (): void => {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = (): void => {
    if (options.isClosed() || reconnectTimer !== null) return;
    if (reconnectAttempts >= options.maxReconnectAttempts) {
      options.setConnectionState("error");
      return;
    }

    options.setConnectionState("reconnecting");
    const attempt = reconnectAttempts;
    reconnectAttempts += 1;
    const exponential = Math.min(
      MAX_RECONNECT_DELAY_MS,
      options.reconnectDelayMs * 2 ** attempt,
    );
    const jitter = Math.floor(
      Math.random() * Math.min(250, Math.max(1, exponential * 0.2)),
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, exponential + jitter);
  };

  const connect = (): void => {
    if (options.isClosed()) return;
    clearReconnect();
    if (options.getConnectionState() !== "reconnecting") {
      options.setConnectionState("connecting");
    }

    let currentSocket: WebSocket;
    try {
      currentSocket = options.webSocketFactory(options.wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    socket = currentSocket;
    options.onSocket(currentSocket);

    currentSocket.addEventListener("open", () => {
      if (socket !== currentSocket) return;
      reconnectAttempts = 0;
      options.setConnectionState("connected");
      flushQueue(socket, options.outboundQueue);
      options.getOpenHandler()?.();
    });

    currentSocket.addEventListener("message", (event) => {
      const messageHandler = options.getMessageHandler();
      if (messageHandler === null || socket !== currentSocket) return;
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        messageHandler({ data });
      } catch {
        // Ignore malformed frames; the persistence channel validates payloads.
      }
    });

    currentSocket.addEventListener("close", () => {
      if (options.isClosed()) return;
      if (socket !== currentSocket) return;
      socket = null;
      options.onSocket(null);
      scheduleReconnect();
    });

    currentSocket.addEventListener("error", () => {
      // `close` follows and triggers reconnect.
    });
  };

  return { connect, clearReconnect, scheduleReconnect };
};
