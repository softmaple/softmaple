/**
 * WebSocket adapter for presence system
 *
 * Ready handshake:
 *   disconnected → connecting → authenticating → syncing → connected
 *
 * `connect()` resolves only when presence is ready (`connected`), not merely
 * when the TCP/WebSocket socket opens.
 */

import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
} from "../../core/protocol";
import {
  type AttentionAction,
  type AttentionResult,
  normalizeCollaborationState,
} from "../../protocol/attention";
import { isRecord } from "../../protocol/envelope";
import {
  PRESENCE_EVENT,
  type PresenceEvent,
  type PresenceEventPayload,
} from "../../types/events";
import {
  createConnectionId,
  createPresenceUser,
  markUserActivity,
  type PresenceUser,
  type PresenceUserPatch,
} from "../../types/presence";
import { setPresenceUser, updateState } from "../adapter-state";
import { createSubscriptionManager } from "../subscription-manager";
import type {
  AdapterConnectionState,
  PresenceAdapter,
  Unsubscribe,
} from "../types";
import { DEFAULT_RECONNECT_CONFIG } from "../types";
import {
  cancelReconnect,
  cleanupWebSocket,
  clearConnectionTimeout,
  handleHeartbeatAck,
  resetReconnectState,
  scheduleReconnect,
  sendWebSocketMessage,
  startHeartbeat,
  stopHeartbeat,
} from "./connection";
import { parseMessage, processMessage } from "./message";
import { createInternalState } from "./state";
import {
  DEFAULT_WS_CONFIG,
  type WebSocketAdapterConfig,
  type WebSocketMessage,
  WS_MESSAGE,
} from "./types";
import {
  isJoinPayload,
  isLeavePayload,
  isPresenceSyncPayload,
  isPresenceUpdatePayload,
} from "./validation";

const LEAVE_FLUSH_TIMEOUT_MS = 100;

const buildUrl = (baseUrl: string, roomId: string): string => {
  const url = new URL(baseUrl);
  url.searchParams.set("roomId", roomId);
  return url.toString();
};

const waitForBufferFlush = (
  socket: WebSocket | null,
  timeoutMs: number,
): Promise<void> =>
  new Promise((resolve) => {
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const checkBuffer = (): void => {
      if (
        socket.bufferedAmount === 0 ||
        Date.now() - startTime >= timeoutMs ||
        socket.readyState !== WebSocket.OPEN
      ) {
        resolve();
        return;
      }
      setTimeout(checkBuffer, 10);
    };
    checkBuffer();
  });

const presenceEventFromMessage = (
  message: WebSocketMessage,
): PresenceEvent | null => {
  switch (message.type) {
    case WS_MESSAGE.JOIN: {
      if (!isJoinPayload(message.payload)) return null;
      return {
        type: PRESENCE_EVENT.JOIN,
        payload: { type: PRESENCE_EVENT.JOIN, user: message.payload.user },
        timestamp: message.timestamp,
      };
    }
    case WS_MESSAGE.LEAVE: {
      if (!isLeavePayload(message.payload)) return null;
      return {
        type: PRESENCE_EVENT.LEAVE,
        payload: {
          type: PRESENCE_EVENT.LEAVE,
          connectionId: message.payload.connectionId,
          userId: message.payload.userId,
        },
        timestamp: message.timestamp,
      };
    }
    case WS_MESSAGE.PRESENCE_UPDATE: {
      if (!isPresenceUpdatePayload(message.payload)) return null;
      return {
        type: PRESENCE_EVENT.UPDATE,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          connectionId: message.payload.connectionId,
          userId: message.payload.userId,
          clock: message.payload.clock,
          updates: message.payload.updates,
        },
        timestamp: message.timestamp,
      };
    }
    case WS_MESSAGE.PRESENCE_SYNC:
    case WS_MESSAGE.PRESENCE_SYNC_RESPONSE: {
      if (!isPresenceSyncPayload(message.payload)) return null;
      return {
        type: PRESENCE_EVENT.SYNC,
        payload: { type: PRESENCE_EVENT.SYNC, users: message.payload.users },
        timestamp: message.timestamp,
      };
    }
    default:
      return null;
  }
};

const READY_STATES: ReadonlySet<AdapterConnectionState> = new Set([
  "connected",
]);

/**
 * Create a WebSocket presence adapter
 */
export const createWebSocketAdapter = (
  config: WebSocketAdapterConfig,
): PresenceAdapter => {
  const subscriptions = createSubscriptionManager();
  const reconnectConfig = config.reconnect ?? DEFAULT_RECONNECT_CONFIG;
  const connectionTimeoutMs =
    config.connectionTimeoutMs ?? DEFAULT_WS_CONFIG.connectionTimeoutMs;
  const connectionId =
    config.connectionId ?? createConnectionId(config.userInfo.userId);
  const requireAuthAck =
    config.requireAuthAck ?? config.authToken !== undefined;

  const internal = createInternalState(reconnectConfig);
  let attentionSupported = false;
  let serverOffset = 0;
  const pendingAttention = new Map<
    string,
    {
      readonly finish: (result: AttentionResult) => void;
      readonly timer: ReturnType<typeof setTimeout>;
      readonly retry: ReturnType<typeof setTimeout>;
    }
  >();
  const clearAttention = () => {
    attentionSupported = false;
    for (const [id, pending] of pendingAttention) {
      clearTimeout(pending.timer);
      clearTimeout(pending.retry);
      pending.finish({
        id,
        ok: false,
        message: "Connection interrupted. The action could not be confirmed.",
      });
    }
    pendingAttention.clear();
  };

  const setState = (
    updates: Parameters<typeof updateState>[1],
    notifyPresence = false,
  ): void => {
    internal.state = updateState(internal.state, updates);
    if (updates.connectionState !== undefined) {
      subscriptions.notifyConnectionChange(updates.connectionState);
    }
    if (notifyPresence) {
      subscriptions.notifyPresenceChange(internal.state.presence);
    }
  };

  const sendMessage = (type: string, payload?: unknown): void => {
    sendWebSocketMessage(internal, config, type, payload, connectionId);
  };

  const forceReconnectFromHeartbeat = (): void => {
    subscriptions.notifyError(
      new Error("Heartbeat ACK deadline exceeded; forcing reconnect"),
    );
    if (internal.socket !== null) {
      try {
        internal.socket.close();
      } catch {
        // close() may throw if already closing
      }
    }
  };

  const beginPresenceSync = (self: PresenceUser): void => {
    setState({ connectionState: "syncing" });
    sendMessage(WS_MESSAGE.JOIN, { user: self });
    sendMessage(WS_MESSAGE.PRESENCE_SYNC);
  };

  const markConnected = (self: PresenceUser): void => {
    if (internal.handshakeComplete) return;
    internal.handshakeComplete = true;
    clearConnectionTimeout(internal);
    resetReconnectState(internal);

    const newPresence = setPresenceUser(internal.state.presence, self);
    setState(
      { connectionState: "connected", self, presence: newPresence },
      true,
    );
    startHeartbeat(internal, config, sendMessage, forceReconnectFromHeartbeat);
  };

  const handleOpen = (): void => {
    const self = createPresenceUser({
      connectionId,
      userId: config.userInfo.userId,
      name: config.userInfo.name,
      color: config.userInfo.color,
      avatarUrl: config.userInfo.avatarUrl,
    });
    const newPresence = setPresenceUser(internal.state.presence, self);
    setState({ self, presence: newPresence }, true);

    if (requireAuthAck) {
      setState({ connectionState: "authenticating" });
      sendMessage(WS_MESSAGE.AUTH, {
        token: config.authToken ?? "",
        protocolVersion: PRESENCE_PROTOCOL_VERSION,
        capabilities: PRESENCE_CAPABILITIES,
        connectionId,
        userId: config.userInfo.userId,
        ...(config.sharedAttention && config.sessionId
          ? { extensions: { sharedAttention: 1, sessionId: config.sessionId } }
          : {}),
      });
      return;
    }

    beginPresenceSync(self);
  };

  const handleMessage = (event: MessageEvent): void => {
    const message = parseMessage(event.data as string);
    if (message === null) return;
    if (message.roomId !== config.roomId) return;
    if (
      message.type === WS_MESSAGE.AUTH_OK &&
      message.senderId === "server" &&
      internal.state.connectionState === "authenticating"
    ) {
      attentionSupported =
        config.sharedAttention === true &&
        isRecord(message.payload) &&
        isRecord(message.payload.extensions) &&
        message.payload.extensions.sharedAttention === 1;
      serverOffset = message.timestamp - Date.now();
    }
    if (message.type === WS_MESSAGE.ATTENTION_STATE) {
      if (!attentionSupported || !isRecord(message.payload)) return;
      const payload = message.payload;
      const incoming = isRecord(payload.member) ? payload.member : null;
      if (
        incoming !== null &&
        typeof incoming.connectionId === "string" &&
        incoming.connectionId === message.senderId
      ) {
        const current = internal.state.presence.get(incoming.connectionId);
        const collaboration = normalizeCollaborationState(
          incoming.collaboration,
        );
        if (
          current !== undefined &&
          collaboration !== null &&
          collaboration.revision > (current.collaboration?.revision ?? -1)
        ) {
          const next: PresenceUser = { ...current, collaboration };
          setState(
            {
              presence: setPresenceUser(internal.state.presence, next),
              ...(next.connectionId === connectionId ? { self: next } : {}),
            },
            true,
          );
        }
      }
      if (
        typeof payload.id === "string" &&
        (message.senderId === connectionId || message.senderId === "server")
      ) {
        const pending = pendingAttention.get(payload.id);
        if (pending !== undefined) {
          clearTimeout(pending.timer);
          clearTimeout(pending.retry);
          pendingAttention.delete(payload.id);
          pending.finish({
            id: payload.id,
            ok: payload.ok === true,
            ...(typeof payload.message === "string"
              ? { message: payload.message }
              : {}),
          });
        }
      }
      return;
    }

    const result = processMessage(internal.state, message, connectionId);

    internal.state = result.state;

    if (message.type === WS_MESSAGE.HEARTBEAT_ACK) {
      handleHeartbeatAck(internal, result.heartbeatAckPingId);
    }

    if (result.authOk === true && internal.state.self !== null) {
      beginPresenceSync(internal.state.self);
    }

    if (result.syncCompleted === true && internal.state.self !== null) {
      markConnected(internal.state.self);
    }

    if (result.shouldNotifyPresence) {
      subscriptions.notifyPresenceChange(result.state.presence);
    }
    const presenceEvent = presenceEventFromMessage(message);
    if (presenceEvent !== null && result.shouldNotifyPresence) {
      subscriptions.notifyEvent(presenceEvent);
    }
    if (result.error !== undefined) {
      subscriptions.notifyError(result.error);
      if (message.type === WS_MESSAGE.AUTH_ERROR) {
        setState({ connectionState: "error" });
        cleanupWebSocket(internal, handlers);
      }
    }
  };

  const beginReconnect = (): void => {
    const { enabled, maxAttempts } = internal.reconnect.config;
    if (enabled && internal.reconnect.attempts < maxAttempts) {
      setState({ connectionState: "reconnecting" });
      scheduleReconnect(internal, subscriptions, connectInternal);
      return;
    }
    if (enabled) {
      setState({ connectionState: "error" });
      subscriptions.notifyError(
        new Error(`Max reconnect attempts (${maxAttempts}) reached`),
      );
      return;
    }
    setState({ connectionState: "disconnected" });
  };

  const handleClose = (): void => {
    clearAttention();
    stopHeartbeat(internal);
    clearConnectionTimeout(internal);
    internal.handshakeComplete = false;
    beginReconnect();
  };

  const handleError = (): void => {
    subscriptions.notifyError(new Error("WebSocket connection error"));
  };

  const handlers = {
    onOpen: handleOpen,
    onMessage: handleMessage,
    onClose: handleClose,
    onError: handleError,
  };

  const connectInternal = (): void => {
    cleanupWebSocket(internal, handlers);
    internal.handshakeComplete = false;
    setState({
      connectionState:
        internal.reconnect.isReconnecting || internal.reconnect.attempts > 0
          ? "reconnecting"
          : "connecting",
    });

    const wsUrl = buildUrl(config.url, config.roomId);
    internal.socket = new WebSocket(wsUrl);
    internal.socket.addEventListener("open", handleOpen);
    internal.socket.addEventListener("message", handleMessage);
    internal.socket.addEventListener("close", handleClose);
    internal.socket.addEventListener("error", handleError);

    internal.connectionTimeoutId = setTimeout(() => {
      if (!READY_STATES.has(internal.state.connectionState)) {
        subscriptions.notifyError(new Error("Connection timeout"));
        cleanupWebSocket(internal, handlers);
        beginReconnect();
      }
    }, connectionTimeoutMs);
  };

  return {
    connect: (): Promise<void> =>
      new Promise((resolve, reject) => {
        if (
          internal.socket !== null &&
          internal.socket.readyState === WebSocket.OPEN &&
          internal.state.connectionState === "connected"
        ) {
          resolve();
          return;
        }

        let unsubscribeConnected: Unsubscribe;
        let unsubscribeError: Unsubscribe;

        unsubscribeConnected = subscriptions.onConnectionChange((state) => {
          if (state === "connected") {
            unsubscribeConnected();
            unsubscribeError();
            resolve();
          }
        });

        unsubscribeError = subscriptions.onError((error) => {
          // Heartbeat / transient errors should not reject an in-flight connect
          // once we are past ready — only fail connect on hard errors while
          // handshake is incomplete.
          if (
            internal.state.connectionState === "error" ||
            !internal.handshakeComplete
          ) {
            unsubscribeConnected();
            unsubscribeError();
            reject(error);
          }
        });

        connectInternal();
      }),

    disconnect: async (): Promise<void> => {
      clearAttention();
      cancelReconnect(internal);

      if (
        internal.socket === null ||
        internal.socket.readyState === WebSocket.CLOSED
      ) {
        cleanupWebSocket(internal, handlers);
        setState(
          { connectionState: "disconnected", self: null, presence: new Map() },
          true,
        );
        return;
      }

      sendMessage(WS_MESSAGE.LEAVE, {
        connectionId,
        userId: config.userInfo.userId,
      });

      await waitForBufferFlush(internal.socket, LEAVE_FLUSH_TIMEOUT_MS);

      cleanupWebSocket(internal, handlers);
      setState(
        { connectionState: "disconnected", self: null, presence: new Map() },
        true,
      );
    },

    getConnectionState: (): AdapterConnectionState =>
      internal.state.connectionState,

    supportsAttention: () =>
      attentionSupported && internal.state.connectionState === "connected",
    getServerTime: () => Date.now() + serverOffset,
    sendAttention: (action: AttentionAction): Promise<AttentionResult> => {
      const id = crypto.randomUUID();
      if (
        !attentionSupported ||
        internal.state.connectionState !== "connected" ||
        pendingAttention.size >= 4
      ) {
        return Promise.resolve({
          id,
          ok: false,
          message:
            "Shared attention is unavailable. Check your connection and try again.",
        });
      }
      return new Promise((finish) => {
        const command = { id, action };
        const timer = setTimeout(() => {
          const pending = pendingAttention.get(id);
          if (pending === undefined) return;
          clearTimeout(pending.retry);
          pendingAttention.delete(id);
          finish({
            id,
            ok: false,
            message:
              "Delivery could not be confirmed. Try again when connected.",
          });
        }, 4_000);
        const retry = setTimeout(() => {
          if (internal.state.connectionState === "connected")
            sendMessage(WS_MESSAGE.ATTENTION_COMMAND, command);
        }, 1_000);
        pendingAttention.set(id, { finish, timer, retry });
        sendMessage(WS_MESSAGE.ATTENTION_COMMAND, command);
      });
    },

    updatePresence: (updates: PresenceUserPatch): void => {
      if (internal.state.self === null) return;

      // Drop stale cursor frames when the socket buffer is backed up —
      // cursor is latest-value-wins.
      if (
        updates.cursor !== undefined &&
        internal.socket !== null &&
        internal.socket.bufferedAmount >
          DEFAULT_WS_CONFIG.cursorBackpressureBytes
      ) {
        return;
      }

      const updatedSelf = markUserActivity(
        internal.state.self,
        Date.now(),
        updates,
      );

      const newPresence = setPresenceUser(internal.state.presence, updatedSelf);
      setState({ self: updatedSelf, presence: newPresence }, true);
      sendMessage(WS_MESSAGE.PRESENCE_UPDATE, {
        connectionId: updatedSelf.connectionId,
        userId: updatedSelf.userId,
        clock: updatedSelf.clock,
        updates: {
          ...updates,
          lastActivityAt: updatedSelf.lastActivityAt,
          lastSeenAt: updatedSelf.lastSeenAt,
        },
      });
    },

    broadcast: (payload: PresenceEventPayload): void => {
      if (internal.state.self === null) return;

      const event: PresenceEvent = {
        type: payload.type,
        payload,
        timestamp: Date.now(),
      };

      sendMessage(payload.type, payload);
      subscriptions.notifyEvent(event);
    },

    onPresenceChange: (callback) => {
      const unsubscribe = subscriptions.onPresenceChange(callback);
      callback(internal.state.presence);
      return unsubscribe;
    },

    onEvent: subscriptions.onEvent,

    onConnectionChange: (callback) => {
      const unsubscribe = subscriptions.onConnectionChange(callback);
      callback(internal.state.connectionState);
      return unsubscribe;
    },

    onError: subscriptions.onError,

    getPresence: (): ReadonlyMap<string, PresenceUser> =>
      new Map(internal.state.presence),

    getSelf: (): PresenceUser | null => internal.state.self,
  };
};

/**
 * Factory function for creating WebSocket adapters
 */
export const webSocketAdapterFactory = (
  config: WebSocketAdapterConfig,
): PresenceAdapter => createWebSocketAdapter(config);
