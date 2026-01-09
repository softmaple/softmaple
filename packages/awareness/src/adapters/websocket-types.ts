/**
 * WebSocket-specific types for presence adapter
 */

import type { PresenceUser } from "../types/presence";
import type { AdapterConfig, ReconnectConfig } from "./types";

/**
 * WebSocket adapter configuration
 */
export interface WebSocketAdapterConfig extends AdapterConfig {
  /** WebSocket server URL */
  readonly url: string;
  /** Optional authentication token */
  readonly authToken?: string;
  /** Heartbeat interval in ms (default: 30000) */
  readonly heartbeatIntervalMs?: number;
  /** Connection timeout in ms (default: 10000) */
  readonly connectionTimeoutMs?: number;
}

/**
 * WebSocket message types
 */
export const WS_MESSAGE_TYPE = {
  JOIN: "join",
  LEAVE: "leave",
  PRESENCE_UPDATE: "presence:update",
  PRESENCE_SYNC: "presence:sync",
  PRESENCE_SYNC_RESPONSE: "presence:sync-response",
  HEARTBEAT: "heartbeat",
  HEARTBEAT_ACK: "heartbeat:ack",
  ERROR: "error",
} as const;

export type WebSocketMessageType =
  (typeof WS_MESSAGE_TYPE)[keyof typeof WS_MESSAGE_TYPE];

/**
 * WebSocket message structure
 */
export interface WebSocketMessage {
  readonly type: WebSocketMessageType;
  readonly roomId: string;
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
  readonly userId: string;
}

/**
 * Presence update payload
 */
export interface PresenceUpdatePayload {
  readonly userId: string;
  readonly updates: Partial<Omit<PresenceUser, "userId">>;
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
 * Default WebSocket configuration values
 */
export const DEFAULT_WS_CONFIG = {
  heartbeatIntervalMs: 30_000,
  connectionTimeoutMs: 10_000,
} as const;

/**
 * WebSocket reconnect state
 */
export interface ReconnectState {
  readonly attempts: number;
  readonly config: ReconnectConfig;
  readonly timeoutId: ReturnType<typeof setTimeout> | null;
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
