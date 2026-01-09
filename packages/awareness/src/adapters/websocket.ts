/**
 * WebSocket adapter for presence system
 * Main adapter factory using modular connection management
 */

import { WS_MESSAGE } from "../constants/presence-events";
import type { PresenceEvent, PresenceEventPayload } from "../types/events";
import type { PresenceUser } from "../types/presence";
import { createPresenceUser, updatePresenceUser } from "../types/presence";
import { setPresenceUser, updateState } from "./adapter-state";
import { createSubscriptionManager } from "./subscription-manager";
import type {
  AdapterConnectionState,
  PresenceAdapter,
  Unsubscribe,
} from "./types";
import { DEFAULT_RECONNECT_CONFIG } from "./types";
import {
  cleanupWebSocket,
  clearConnectionTimeout,
  resetReconnectState,
  scheduleReconnect,
  sendWebSocketMessage,
  startHeartbeat,
  stopHeartbeat,
} from "./websocket-connection";
import { parseMessage, processMessage } from "./websocket-message";
import { createInternalState } from "./websocket-state";
import type { WebSocketAdapterConfig } from "./websocket-types";
import { DEFAULT_WS_CONFIG } from "./websocket-types";

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
    if (result.error !== undefined) {
      subscriptions.notifyError(result.error);
    }
  };

  const handleClose = (): void => {
    stopHeartbeat(internal);
    setState({ connectionState: "disconnected" });
    scheduleReconnect(internal, subscriptions, connectInternal);
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
    setState({ connectionState: "connecting" });

    internal.socket = new WebSocket(config.url);
    internal.socket.addEventListener("open", handleOpen);
    internal.socket.addEventListener("message", handleMessage);
    internal.socket.addEventListener("close", handleClose);
    internal.socket.addEventListener("error", handleError);

    internal.connectionTimeoutId = setTimeout(() => {
      if (internal.state.connectionState === "connecting") {
        subscriptions.notifyError(new Error("Connection timeout"));
        cleanupWebSocket(internal, handlers);
        scheduleReconnect(internal, subscriptions, connectInternal);
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

        sendMessage(WS_MESSAGE.LEAVE, { userId: config.userInfo.userId });
        cleanupWebSocket(internal, handlers);
        setState(
          { connectionState: "disconnected", self: null, presence: new Map() },
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
      internal.state.presence,

    getSelf: (): PresenceUser | null => internal.state.self,
  };
};
