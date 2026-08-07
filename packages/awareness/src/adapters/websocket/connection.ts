/**
 * WebSocket connection management utilities
 */

import type { SubscriptionManager } from "../subscription-manager";
import { createMessage, serializeMessage } from "./message";
import type { InternalState } from "./state";
import type { WebSocketAdapterConfig } from "./types";
import {
  calculateReconnectDelay,
  DEFAULT_WS_CONFIG,
  WS_MESSAGE,
} from "./types";

const nextPingId = (internal: InternalState): string => {
  internal.pingCounter += 1;
  return `ping-${Date.now()}-${internal.pingCounter}`;
};

/**
 * Send a message through WebSocket
 */
export const sendWebSocketMessage = (
  internal: InternalState,
  config: WebSocketAdapterConfig,
  type: string,
  payload: unknown | undefined,
  senderId: string,
): void => {
  if (
    internal.socket === null ||
    internal.socket.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  const message = createMessage(type, config.roomId, senderId, payload);
  internal.socket.send(serializeMessage(message));
};

/**
 * Clear all pending heartbeat ACK timeouts
 */
export const clearHeartbeatAckTimeouts = (internal: InternalState): void => {
  for (const timeoutId of internal.heartbeatAckTimeouts.values()) {
    clearTimeout(timeoutId);
  }
  internal.heartbeatAckTimeouts.clear();
};

/** @deprecated Use clearHeartbeatAckTimeouts */
export const clearHeartbeatAckTimeout = clearHeartbeatAckTimeouts;

/**
 * Stop heartbeat interval and ACK timeouts
 */
export const stopHeartbeat = (internal: InternalState): void => {
  if (internal.heartbeatIntervalId !== null) {
    clearInterval(internal.heartbeatIntervalId);
    internal.heartbeatIntervalId = null;
  }
  clearHeartbeatAckTimeouts(internal);
};

/**
 * Start heartbeat with ACK deadline. On repeated missed ACKs, force-close
 * the socket so reconnect can heal half-open NAT/proxy connections.
 *
 * Each ping keeps its own ACK deadline; later pings do not cancel earlier ones.
 */
export const startHeartbeat = (
  internal: InternalState,
  config: WebSocketAdapterConfig,
  sendMessage: (type: string, payload?: unknown) => void,
  onMissedAcks: () => void = () => {
    if (internal.socket !== null) {
      try {
        internal.socket.close();
      } catch {
        // ignore
      }
    }
  },
): void => {
  stopHeartbeat(internal);

  const heartbeatIntervalMs =
    config.heartbeatIntervalMs ?? DEFAULT_WS_CONFIG.heartbeatIntervalMs;
  const ackTimeoutMs =
    config.heartbeatAckTimeoutMs ?? DEFAULT_WS_CONFIG.heartbeatAckTimeoutMs;
  const missedLimit =
    config.heartbeatMissedAckLimit ?? DEFAULT_WS_CONFIG.heartbeatMissedAckLimit;

  const sendPing = (): void => {
    const pingId = nextPingId(internal);
    sendMessage(WS_MESSAGE.HEARTBEAT, { pingId });

    const timeoutId = setTimeout(() => {
      if (!internal.heartbeatAckTimeouts.has(pingId)) return;
      internal.heartbeatAckTimeouts.delete(pingId);
      internal.missedHeartbeatAcks += 1;
      if (internal.missedHeartbeatAcks >= missedLimit) {
        onMissedAcks();
      }
    }, ackTimeoutMs);
    internal.heartbeatAckTimeouts.set(pingId, timeoutId);
  };

  // Immediate ping so we detect half-open sockets quickly after connect
  sendPing();
  internal.heartbeatIntervalId = setInterval(sendPing, heartbeatIntervalMs);
};

/**
 * Record a heartbeat ACK. Clears the matching ping deadline when pingId is
 * known; clears all outstanding deadlines when pingId is omitted.
 */
export const handleHeartbeatAck = (
  internal: InternalState,
  pingId: string | undefined,
): void => {
  if (pingId !== undefined) {
    const timeoutId = internal.heartbeatAckTimeouts.get(pingId);
    if (timeoutId === undefined) {
      return;
    }
    clearTimeout(timeoutId);
    internal.heartbeatAckTimeouts.delete(pingId);
  } else {
    clearHeartbeatAckTimeouts(internal);
  }
  internal.missedHeartbeatAcks = 0;
  internal.lastHeartbeatAckAt = Date.now();
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
  internal.handshakeComplete = false;
  internal.missedHeartbeatAcks = 0;
  internal.lastHeartbeatAckAt = null;

  if (internal.socket !== null) {
    internal.socket.removeEventListener("open", handlers.onOpen);
    internal.socket.removeEventListener("message", handlers.onMessage);
    internal.socket.removeEventListener("close", handlers.onClose);
    internal.socket.removeEventListener("error", handlers.onError);
    if (
      internal.socket.readyState === WebSocket.OPEN ||
      internal.socket.readyState === WebSocket.CONNECTING
    ) {
      internal.socket.close();
    }
    internal.socket = null;
  }
};
