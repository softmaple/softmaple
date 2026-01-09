/**
 * WebSocket adapter for presence system
 * Handles real-time presence synchronization over WebSocket connections
 */

import type { PresenceEvent, PresenceEventPayload } from "../types/events";
import type { PresenceUser } from "../types/presence";
import { createPresenceUser, updatePresenceUser } from "../types/presence";
import type { AdapterState } from "./adapter-state";
import {
  createInitialState,
  setPresenceUser,
  updateState,
} from "./adapter-state";
import { createSubscriptionManager } from "./subscription-manager";
import type {
  AdapterConnectionState,
  PresenceAdapter,
  Unsubscribe,
} from "./types";
import { DEFAULT_RECONNECT_CONFIG } from "./types";
import {
  createMessage,
  parseMessage,
  processMessage,
  serializeMessage,
} from "./websocket-message";
import type { ReconnectState, WebSocketAdapterConfig } from "./websocket-types";
import {
  calculateReconnectDelay,
  createReconnectState,
  DEFAULT_WS_CONFIG,
  WS_MESSAGE_TYPE,
} from "./websocket-types";

/**
 * Internal mutable state for WebSocket adapter
 */
interface InternalState {
  socket: WebSocket | null;
  state: AdapterState;
  reconnect: ReconnectState;
  heartbeatIntervalId: ReturnType<typeof setInterval> | null;
  connectionTimeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Create a WebSocket presence adapter
 */
export const createWebSocketAdapter = (
  config: WebSocketAdapterConfig,
): PresenceAdapter => {
  const subscriptions = createSubscriptionManager();
  const reconnectConfig = config.reconnect ?? DEFAULT_RECONNECT_CONFIG;
  const heartbeatIntervalMs =
    config.heartbeatIntervalMs ?? DEFAULT_WS_CONFIG.heartbeatIntervalMs;
  const connectionTimeoutMs =
    config.connectionTimeoutMs ?? DEFAULT_WS_CONFIG.connectionTimeoutMs;

  const internal: InternalState = {
    socket: null,
    state: createInitialState(),
    reconnect: createReconnectState(reconnectConfig),
    heartbeatIntervalId: null,
    connectionTimeoutId: null,
  };

  /**
   * Update internal state and notify if needed
   */
  const setState = (
    updates: Partial<AdapterState>,
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

  /**
   * Send a message through WebSocket
   */
  const sendMessage = (
    type: ReturnType<typeof createMessage>["type"],
    payload?: unknown,
  ): void => {
    if (
      internal.socket === null ||
      internal.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const message = createMessage(
      type,
      config.roomId,
      config.userInfo.userId,
      payload,
    );
    internal.socket.send(serializeMessage(message));
  };

  /**
   * Start heartbeat interval
   */
  const startHeartbeat = (): void => {
    stopHeartbeat();
    internal.heartbeatIntervalId = setInterval(() => {
      sendMessage(WS_MESSAGE_TYPE.HEARTBEAT);
    }, heartbeatIntervalMs);
  };

  /**
   * Stop heartbeat interval
   */
  const stopHeartbeat = (): void => {
    if (internal.heartbeatIntervalId !== null) {
      clearInterval(internal.heartbeatIntervalId);
      internal.heartbeatIntervalId = null;
    }
  };

  /**
   * Clear connection timeout
   */
  const clearConnectionTimeout = (): void => {
    if (internal.connectionTimeoutId !== null) {
      clearTimeout(internal.connectionTimeoutId);
      internal.connectionTimeoutId = null;
    }
  };

  /**
   * Handle WebSocket open event
   */
  const handleOpen = (): void => {
    clearConnectionTimeout();
    internal.reconnect = createReconnectState(reconnectConfig);

    // Create self user
    const self = createPresenceUser({
      userId: config.userInfo.userId,
      name: config.userInfo.name,
      color: config.userInfo.color,
      avatarUrl: config.userInfo.avatarUrl,
    });

    const newPresence = setPresenceUser(internal.state.presence, self);
    setState(
      {
        connectionState: "connected",
        self,
        presence: newPresence,
      },
      true,
    );

    // Send join message
    sendMessage(WS_MESSAGE_TYPE.JOIN, { user: self });

    // Request presence sync from server
    sendMessage(WS_MESSAGE_TYPE.PRESENCE_SYNC);

    // Start heartbeat
    startHeartbeat();
  };

  /**
   * Handle WebSocket message event
   */
  const handleMessage = (event: MessageEvent): void => {
    const message = parseMessage(event.data as string);
    if (message === null || message.roomId !== config.roomId) {
      return;
    }

    const result = processMessage(
      internal.state,
      message,
      config.userInfo.userId,
    );

    internal.state = result.state;

    if (result.shouldNotifyPresence) {
      subscriptions.notifyPresenceChange(internal.state.presence);
    }

    if (result.error !== undefined) {
      subscriptions.notifyError(result.error);
    }

    // Notify event subscribers
    const presenceEvent: PresenceEvent = {
      type: message.type as PresenceEvent["type"],
      payload: message.payload as PresenceEventPayload,
      timestamp: message.timestamp,
    };
    subscriptions.notifyEvent(presenceEvent);
  };

  /**
   * Handle WebSocket close event
   */
  const handleClose = (): void => {
    stopHeartbeat();
    clearConnectionTimeout();

    if (
      reconnectConfig.enabled &&
      internal.reconnect.attempts < reconnectConfig.maxAttempts
    ) {
      setState({ connectionState: "reconnecting" });
      scheduleReconnect();
    } else {
      setState({ connectionState: "disconnected" });
    }
  };

  /**
   * Handle WebSocket error event
   */
  const handleError = (event: Event): void => {
    const error = new Error(
      event instanceof ErrorEvent ? event.message : "WebSocket error",
    );
    subscriptions.notifyError(error);
    setState({ connectionState: "error" });
  };

  /**
   * Schedule reconnection attempt
   */
  const scheduleReconnect = (): void => {
    const delay = calculateReconnectDelay(internal.reconnect);
    internal.reconnect = {
      ...internal.reconnect,
      attempts: internal.reconnect.attempts + 1,
      timeoutId: setTimeout(() => {
        connectInternal();
      }, delay),
    };
  };

  /**
   * Cancel scheduled reconnection
   */
  const cancelReconnect = (): void => {
    if (internal.reconnect.timeoutId !== null) {
      clearTimeout(internal.reconnect.timeoutId);
      internal.reconnect = {
        ...internal.reconnect,
        timeoutId: null,
      };
    }
  };

  /**
   * Build WebSocket URL with auth token
   */
  const buildUrl = (): string => {
    const url = new URL(config.url);
    url.searchParams.set("roomId", config.roomId);
    if (config.authToken !== undefined) {
      url.searchParams.set("token", config.authToken);
    }
    return url.toString();
  };

  /**
   * Internal connect implementation
   */
  const connectInternal = (): void => {
    if (
      internal.socket !== null &&
      internal.socket.readyState === WebSocket.OPEN
    ) {
      return;
    }

    setState({ connectionState: "connecting" });

    // Set connection timeout
    internal.connectionTimeoutId = setTimeout(() => {
      if (internal.socket !== null) {
        internal.socket.close();
      }
      const error = new Error("Connection timeout");
      subscriptions.notifyError(error);
      handleClose();
    }, connectionTimeoutMs);

    internal.socket = new WebSocket(buildUrl());
    internal.socket.addEventListener("open", handleOpen);
    internal.socket.addEventListener("message", handleMessage);
    internal.socket.addEventListener("close", handleClose);
    internal.socket.addEventListener("error", handleError);
  };

  /**
   * Clean up WebSocket connection
   */
  const cleanup = (): void => {
    stopHeartbeat();
    clearConnectionTimeout();
    cancelReconnect();

    if (internal.socket !== null) {
      internal.socket.removeEventListener("open", handleOpen);
      internal.socket.removeEventListener("message", handleMessage);
      internal.socket.removeEventListener("close", handleClose);
      internal.socket.removeEventListener("error", handleError);
      internal.socket.close();
      internal.socket = null;
    }
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

        const onConnected: Unsubscribe = subscriptions.onConnectionChange(
          (state) => {
            if (state === "connected") {
              onConnected();
              onError();
              resolve();
            }
          },
        );

        const onError: Unsubscribe = subscriptions.onError((error) => {
          onConnected();
          onError();
          reject(error);
        });

        connectInternal();
      }),

    disconnect: (): Promise<void> =>
      new Promise((resolve) => {
        if (
          internal.socket === null ||
          internal.socket.readyState === WebSocket.CLOSED
        ) {
          setState({ connectionState: "disconnected" });
          resolve();
          return;
        }

        // Send leave message before disconnecting
        sendMessage(WS_MESSAGE_TYPE.LEAVE, {
          userId: config.userInfo.userId,
        });

        cleanup();
        setState(
          {
            connectionState: "disconnected",
            self: null,
            presence: new Map(),
          },
          true,
        );
        resolve();
      }),

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

      sendMessage(WS_MESSAGE_TYPE.PRESENCE_UPDATE, {
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

      // Send through WebSocket
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
      internal.state.presence,

    getSelf: (): PresenceUser | null => internal.state.self,
  };
};
