/**
 * WebSocket-specific types for presence adapter
 */

import type { PresenceUser, PresenceUserPatch } from "../../types/presence";
import type { AdapterConfig, ReconnectConfig } from "../types";
import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
} from "../../core/protocol";

export const WS_MESSAGE = {
  JOIN: "join",
  LEAVE: "leave",
  PRESENCE_UPDATE: "presence:update",
  PRESENCE_SYNC: "presence:sync",
  PRESENCE_SYNC_RESPONSE: "presence:sync-response",
  HEARTBEAT: "heartbeat",
  HEARTBEAT_ACK: "heartbeat:ack",
  AUTH: "auth",
  AUTH_OK: "auth_ok",
  AUTH_ERROR: "auth_error",
  ERROR: "error",
} as const;

export type WebSocketMessageType = (typeof WS_MESSAGE)[keyof typeof WS_MESSAGE];

/**
 * WebSocket adapter configuration
 */
export interface WebSocketAdapterConfig extends AdapterConfig {
  /** WebSocket server URL */
  readonly url: string;
  /** Optional authentication token */
  readonly authToken?: string;
  /**
   * When true (default if authToken is set), wait for auth_ok before syncing.
   * When false, skip authenticating and go straight to syncing after open.
   */
  readonly requireAuthAck?: boolean;
  /** Heartbeat interval in ms (default: 10000) */
  readonly heartbeatIntervalMs?: number;
  /**
   * Max time to wait for a heartbeat ACK before counting a miss (default: 20000)
   */
  readonly heartbeatAckTimeoutMs?: number;
  /** Missed ACK count before force-reconnect (default: 2) */
  readonly heartbeatMissedAckLimit?: number;
  /** Connection / handshake timeout in ms (default: 10000) */
  readonly connectionTimeoutMs?: number;
  /** Stable connection id for this tab/session; generated when omitted */
  readonly connectionId?: string;
}

/**
 * WebSocket message structure
 */
export interface WebSocketMessage {
  readonly type: WebSocketMessageType | (string & {});
  readonly roomId: string;
  /** connectionId of the sender */
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload?: unknown;
}

/**
 * Join message payload
 */
export interface JoinPayload {
  readonly user: PresenceUser;
}

/**
 * Leave message payload
 */
export interface LeavePayload {
  readonly connectionId: string;
  readonly userId: string;
}

/**
 * Presence update payload (wire)
 */
export interface PresenceUpdatePayload {
  readonly connectionId: string;
  readonly userId: string;
  readonly clock: number;
  readonly updates: PresenceUserPatch & {
    readonly lastActivityAt?: number;
    readonly lastSeenAt?: number;
  };
}

/**
 * Presence sync payload (server sends full state)
 */
export interface PresenceSyncPayload {
  readonly users: ReadonlyArray<PresenceUser>;
}

/**
 * Error payload
 */
export interface ErrorPayload {
  readonly code: string;
  readonly message: string;
}

/**
 * Heartbeat payload with ping correlation id
 */
export interface HeartbeatPayload {
  readonly pingId: string;
}

/**
 * Auth handshake payload
 */
export interface AuthPayload {
  readonly token: string;
  readonly protocolVersion: typeof PRESENCE_PROTOCOL_VERSION;
  readonly capabilities: typeof PRESENCE_CAPABILITIES;
  readonly connectionId: string;
  readonly userId: string;
}

/**
 * Default WebSocket configuration values
 */
export const DEFAULT_WS_CONFIG = {
  heartbeatIntervalMs: 10_000,
  heartbeatAckTimeoutMs: 20_000,
  heartbeatMissedAckLimit: 2,
  connectionTimeoutMs: 10_000,
  /** Drop cursor updates when the socket send buffer exceeds this many bytes. */
  cursorBackpressureBytes: 64_000,
} as const;

/**
 * WebSocket reconnect state
 */
export interface ReconnectState {
  readonly attempts: number;
  readonly config: ReconnectConfig;
  readonly timeoutId: ReturnType<typeof setTimeout> | null;
  readonly lastAttemptAt: number | null;
  readonly isReconnecting: boolean;
}

/**
 * Create initial reconnect state
 */
export const createReconnectState = (
  config: ReconnectConfig,
): ReconnectState => ({
  attempts: 0,
  config,
  timeoutId: null,
  lastAttemptAt: null,
  isReconnecting: false,
});

/**
 * Calculate next reconnect delay with exponential backoff
 */
export const calculateReconnectDelay = (state: ReconnectState): number => {
  const delay = Math.min(
    state.config.baseDelayMs * 2 ** state.attempts,
    state.config.maxDelayMs,
  );
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
};
