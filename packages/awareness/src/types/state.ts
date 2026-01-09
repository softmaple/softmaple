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

/**
 * Default presence state configuration
 */
export const DEFAULT_PRESENCE_CONFIG: PresenceStateConfig = {
  maxActivities: 100,
  idleTimeoutMs: 60_000,
  offlineTimeoutMs: 120_000,
  cursorThrottleMs: 50,
} as const;

/**
 * Create initial presence state (pure function)
 */
export const createInitialPresenceState = (): PresenceState => ({
  users: new Map(),
  activities: [],
  connectionStatus: "disconnected",
  selfId: null,
});

/**
 * Get array of users from state (pure function)
 */
export const getUsersArray = (
  state: PresenceState,
): ReadonlyArray<PresenceUser> => Array.from(state.users.values());

/**
 * Get online users (active or idle) from state (pure function)
 */
export const getOnlineUsers = (
  state: PresenceState,
): ReadonlyArray<PresenceUser> =>
  getUsersArray(state).filter((user) => user.status !== "offline");

/**
 * Get user by ID from state (pure function)
 */
export const getUserById = (
  state: PresenceState,
  userId: string,
): PresenceUser | undefined => state.users.get(userId);

/**
 * Get self user from state (pure function)
 */
export const getSelfUser = (state: PresenceState): PresenceUser | undefined =>
  state.selfId ? state.users.get(state.selfId) : undefined;

/**
 * Get other users (excluding self) from state (pure function)
 */
export const getOtherUsers = (
  state: PresenceState,
): ReadonlyArray<PresenceUser> =>
  getUsersArray(state).filter((user) => user.userId !== state.selfId);
