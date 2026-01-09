/**
 * WebSocket connection management utilities
 */

import type { SubscriptionManager } from "./subscription-manager";
import { createMessage, serializeMessage } from "./websocket-message";
import type { InternalState } from "./websocket-state";
import type { WebSocketAdapterConfig } from "./websocket-types";
import {
  calculateReconnectDelay,
  DEFAULT_WS_CONFIG,
  WS_MESSAGE_TYPE,
} from "./websocket-types";

/**
 * Send a message through WebSocket
 */
export const sendWebSocketMessage = (
  internal: InternalState,
  config: WebSocketAdapterConfig,
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
export const startHeartbeat = (
  internal: InternalState,
  config: WebSocketAdapterConfig,
  sendMessage: (type: string, payload?: unknown) => void,
): void => {
  stopHeartbeat(internal);
  const heartbeatIntervalMs =
    config.heartbeatIntervalMs ?? DEFAULT_WS_CONFIG.heartbeatIntervalMs;
  internal.heartbeatIntervalId = setInterval(() => {
    sendMessage(WS_MESSAGE_TYPE.HEARTBEAT);
  }, heartbeatIntervalMs);
};

/**
 * Stop heartbeat interval
 */
export const stopHeartbeat = (internal: InternalState): void => {
  if (internal.heartbeatIntervalId !== null) {
    clearInterval(internal.heartbeatIntervalId);
    internal.heartbeatIntervalId = null;
  }
};

/**
 * Clear connection timeout
 */
export const clearConnectionTimeout = (internal: InternalState): void => {
  if (internal.connectionTimeoutId !== null) {
    clearTimeout(internal.connectionTimeoutId);
    internal.connectionTimeoutId = null;
  }
};

/**
 * Schedule reconnection attempt
 */
export const scheduleReconnect = (
  internal: InternalState,
  subscriptions: SubscriptionManager,
  connectFn: () => void,
): void => {
  if (!internal.reconnect.config.enabled) return;
  if (internal.reconnect.attempts >= internal.reconnect.config.maxAttempts) {
    subscriptions.notifyError(
      new Error(
        `Max reconnect attempts (${internal.reconnect.config.maxAttempts}) reached`,
      ),
    );
    return;
  }

  const delay = calculateReconnectDelay(internal.reconnect);
  internal.reconnect = {
    ...internal.reconnect,
    attempts: internal.reconnect.attempts + 1,
    lastAttemptAt: Date.now(),
    isReconnecting: true,
    timeoutId: setTimeout(connectFn, delay),
  };
};

/**
 * Cancel pending reconnection
 */
export const cancelReconnect = (internal: InternalState): void => {
  if (internal.reconnect.timeoutId !== null) {
    clearTimeout(internal.reconnect.timeoutId);
    internal.reconnect = {
      ...internal.reconnect,
      timeoutId: null,
      isReconnecting: false,
    };
  }
};

/**
 * Reset reconnect state after successful connection
 */
export const resetReconnectState = (internal: InternalState): void => {
  internal.reconnect = {
    ...internal.reconnect,
    attempts: 0,
    isReconnecting: false,
  };
};

/**
 * Cleanup all WebSocket resources
 */
export const cleanupWebSocket = (
  internal: InternalState,
  handlers: {
    onOpen: () => void;
    onMessage: (event: MessageEvent) => void;
    onClose: () => void;
    onError: () => void;
  },
): void => {
  stopHeartbeat(internal);
  clearConnectionTimeout(internal);
  cancelReconnect(internal);

  if (internal.socket !== null) {
    internal.socket.removeEventListener("open", handlers.onOpen);
    internal.socket.removeEventListener("message", handlers.onMessage);
    internal.socket.removeEventListener("close", handlers.onClose);
    internal.socket.removeEventListener("error", handlers.onError);
    internal.socket.close();
    internal.socket = null;
  }
};
