/**
 * WebSocket-specific types for presence adapter
 *
 * `WS_MESSAGE`, `WebSocketMessage`, and every payload type moved to
 * `../../protocol/messages` — the source of truth moved there so
 * `@softmaple/awareness/protocol` can be a dependency-free subpath; this
 * file keeps re-exporting them so `./adapters/websocket`'s public surface
 * does not change.
 */

import type { AdapterConfig, ReconnectConfig } from "../types";

export {
  type AuthPayload,
  type ErrorPayload,
  type HeartbeatPayload,
  type JoinPayload,
  type LeavePayload,
  type PresenceSyncPayload,
  type PresenceUpdatePayload,
  type WebSocketMessage,
  type WebSocketMessageType,
  WS_MESSAGE,
} from "../../protocol/messages";

/**
 * WebSocket adapter configuration
 */
export interface WebSocketAdapterConfig extends AdapterConfig {
  /** Opt-in extension. Keep stable when refreshing credentials in the same tab. */
  readonly sessionId?: string;
  readonly sharedAttention?: boolean;
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
