/**
 * Presence state types
 * Based on docs/design/awareness-and-presence.md
 */

import type { ActivityEvent } from "./events";
import type { PresenceUser } from "./presence";

/**
 * Immutable presence state
 * Uses ReadonlyMap and ReadonlyArray for immutability
 *
 * `users` is keyed by `connectionId` (ephemeral session), not `userId`.
 * `selfId` is the local session's `connectionId`.
 */
export interface PresenceState {
  /** Map of connectionId to PresenceUser */
  readonly users: ReadonlyMap<string, PresenceUser>;
  /** Recent activity events (bounded, oldest first) */
  readonly activities: ReadonlyArray<ActivityEvent>;
  /** Current connection status */
  readonly connectionStatus: ConnectionStatus;
  /** Local session connectionId (if connected) */
  readonly selfId: string | null;
}

/**
 * Connection status for the presence system.
 *
 * WebSocket readiness handshake:
 *   disconnected → connecting → authenticating → syncing → connected
 * Reconnect path uses `reconnecting` in place of `connecting`.
 */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "syncing"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * Configuration for presence state
 */
export interface PresenceStateConfig {
  /** Maximum number of activity events to retain */
  readonly maxActivities: number;
  /**
   * Idle timeout in milliseconds (default: 60000).
   * Compared against `lastActivityAt`.
   */
  readonly idleTimeoutMs: number;
  /**
   * Offline timeout in milliseconds (default: 120000).
   * Compared against `lastSeenAt` (heartbeat / transport liveness).
   */
  readonly offlineTimeoutMs: number;
  /**
   * Network cursor update throttle in milliseconds (default: 50).
   * Local rendering may run at 60fps independently.
   */
  readonly cursorThrottleMs: number;
}

/** Default presence timeouts and budgets */
export const DEFAULT_PRESENCE_CONFIG: PresenceStateConfig = {
  maxActivities: 100,
  idleTimeoutMs: 60_000,
  offlineTimeoutMs: 120_000,
  cursorThrottleMs: 50,
} as const;
