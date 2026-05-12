/**
 * Presence state types
 * Based on docs/design/awareness-and-presence.md
 */

import type { ActivityEvent } from "./events";
import type { PresenceUser } from "./presence";

/**
 * Immutable presence state
 * Uses ReadonlyMap and ReadonlyArray for immutability
 */
export interface PresenceState {
  /** Map of userId to PresenceUser */
  readonly users: ReadonlyMap<string, PresenceUser>;
  /** Recent activity events (bounded, oldest first) */
  readonly activities: ReadonlyArray<ActivityEvent>;
  /** Current connection status */
  readonly connectionStatus: ConnectionStatus;
  /** Local user's ID (if connected) */
  readonly selfId: string | null;
}

/**
 * Connection status for the presence system
 */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * Configuration for presence state
 */
export interface PresenceStateConfig {
  /** Maximum number of activity events to retain */
  readonly maxActivities: number;
  /** Idle timeout in milliseconds (default: 60000) */
  readonly idleTimeoutMs: number;
  /** Offline timeout in milliseconds (default: 120000) */
  readonly offlineTimeoutMs: number;
  /** Cursor update throttle in milliseconds (default: 50) */
  readonly cursorThrottleMs: number;
}
