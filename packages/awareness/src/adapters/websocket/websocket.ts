/**
 * WebSocket adapter for presence system
 * Main adapter factory using modular connection management
 */

import {
  PRESENCE_EVENT,
  type PresenceEvent,
  type PresenceEventPayload,
} from "../../types/events";
import type { PresenceUser } from "../../types/presence";
import { createPresenceUser, updatePresenceUser } from "../../types/presence";
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

/**
 * Authentication message type for secure token handshake
 */
const AUTH_MESSAGE_TYPE = "auth" as const;

/**
 * Default timeout for waiting for LEAVE message to flush (ms)
 */
const LEAVE_FLUSH_TIMEOUT_MS = 100;

/**
 * Build WebSocket URL with roomId only (no auth token in URL for security)
 * Security Note: Auth tokens should never be passed in URLs as they may be
 * logged in server access logs, browser history, and proxy logs.
 */
const buildUrl = (baseUrl: string, roomId: string): string => {
  const url = new URL(baseUrl);
  url.searchParams.set("roomId", roomId);
  return url.toString();
};

/**
 * Wait for WebSocket buffer to flush with timeout
 */
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
        payload: { type: PRESENCE_EVENT.LEAVE, userId: message.payload.userId },
        timestamp: message.timestamp,
      };
    }
    case WS_MESSAGE.PRESENCE_UPDATE: {
      if (!isPresenceUpdatePayload(message.payload)) return null;
      return {
        type: PRESENCE_EVENT.UPDATE,
        payload: {
          type: PRESENCE_EVENT.UPDATE,
          userId: message.payload.userId,
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

  const internal = createInternalState(reconnectConfig);

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
    sendWebSocketMessage(internal, config, type, payload);
  };

  const handleOpen = (): void => {
    clearConnectionTimeout(internal);
    resetReconnectState(internal);

    // Send auth token as first message after connection opens (secure handshake)
    // This is more secure than passing token in URL query string
    if (config.authToken !== undefined) {
      sendMessage(AUTH_MESSAGE_TYPE, { token: config.authToken });
    }

    const self = createPresenceUser({
      userId: config.userInfo.userId,
      name: config.userInfo.name,
      color: config.userInfo.color,
      avatarUrl: config.userInfo.avatarUrl,
    });

    const newPresence = setPresenceUser(internal.state.presence, self);
    setState(
      { connectionState: "connected", self, presence: newPresence },
      true,
    );

    sendMessage(WS_MESSAGE.JOIN, { user: self });
    sendMessage(WS_MESSAGE.PRESENCE_SYNC);
    startHeartbeat(internal, config, sendMessage);
  };

  const handleMessage = (event: MessageEvent): void => {
    const message = parseMessage(event.data as string);
    if (message === null) return;

    const result = processMessage(
      internal.state,
      message,
      config.userInfo.userId,
    );

    internal.state = result.state;
    if (result.shouldNotifyPresence) {
      subscriptions.notifyPresenceChange(result.state.presence);
    }
    const presenceEvent = presenceEventFromMessage(message);
    if (presenceEvent !== null && result.shouldNotifyPresence) {
      subscriptions.notifyEvent(presenceEvent);
    }
    if (result.error !== undefined) {
      subscriptions.notifyError(result.error);
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
    stopHeartbeat(internal);
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
    setState({
      connectionState:
        internal.reconnect.isReconnecting || internal.reconnect.attempts > 0
          ? "reconnecting"
          : "connecting",
    });

    // Build URL with roomId only (auth handled via message after connect)
    const wsUrl = buildUrl(config.url, config.roomId);
    internal.socket = new WebSocket(wsUrl);
    internal.socket.addEventListener("open", handleOpen);
    internal.socket.addEventListener("message", handleMessage);
    internal.socket.addEventListener("close", handleClose);
    internal.socket.addEventListener("error", handleError);

    internal.connectionTimeoutId = setTimeout(() => {
      if (
        internal.state.connectionState === "connecting" ||
        internal.state.connectionState === "reconnecting"
      ) {
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
          internal.socket.readyState === WebSocket.OPEN
        ) {
          resolve();
          return;
        }

        // Declare variables first to avoid TDZ (Temporal Dead Zone) issues
        // Both callbacks reference each other for cleanup
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
          unsubscribeConnected();
          unsubscribeError();
          reject(error);
        });

        connectInternal();
      }),

    disconnect: async (): Promise<void> => {
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

      // Send LEAVE message
      sendMessage(WS_MESSAGE.LEAVE, { userId: config.userInfo.userId });

      // Wait for the message to be flushed before cleanup
      // This ensures the LEAVE message is sent before socket closes
      await waitForBufferFlush(internal.socket, LEAVE_FLUSH_TIMEOUT_MS);

      cleanupWebSocket(internal, handlers);
      setState(
        { connectionState: "disconnected", self: null, presence: new Map() },
        true,
      );
    },

    getConnectionState: (): AdapterConnectionState =>
      internal.state.connectionState,

    updatePresence: (updates): void => {
      if (internal.state.self === null) return;

      const updatedSelf = updatePresenceUser(internal.state.self, {
        ...updates,
        lastActiveAt: Date.now(),
      });

      const newPresence = setPresenceUser(internal.state.presence, updatedSelf);
      setState({ self: updatedSelf, presence: newPresence }, true);
      sendMessage(WS_MESSAGE.PRESENCE_UPDATE, {
        userId: updatedSelf.userId,
        updates: { ...updates, lastActiveAt: updatedSelf.lastActiveAt },
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
