/**
 * Core presence types for awareness system
 * Based on docs/design/awareness-and-presence.md
 */

/**
 * User presence status
 * - active: User performed an action in last N seconds
 * - idle: Connected but no recent activity
 * - offline: Disconnected or heartbeat expired
 */
export type PresenceStatus = "active" | "idle" | "offline";

/**
 * Cursor position within the document
 */
export interface CursorPosition {
  /** Block/node ID where cursor is located */
  readonly blockId: string;
  /** Character offset within the block */
  readonly offset: number;
}

/**
 * Text selection range within the document
 */
export interface SelectionRange {
  /** Block/node ID where selection exists */
  readonly blockId: string;
  /** Start offset of selection */
  readonly from: number;
  /** End offset of selection */
  readonly to: number;
}

/**
 * Additional metadata about user activity
 */
export interface PresenceMeta {
  /** Whether user is currently typing */
  readonly isTyping?: boolean;
  /** Custom metadata for extensibility */
  readonly [key: string]: unknown;
}

/**
 * Represents a remote user's presence in the document
 * Immutable by design - create new objects for updates
 */
export interface PresenceUser {
  /** Unique user identifier */
  readonly userId: string;
  /** Display name */
  readonly name: string;
  /** Avatar URL (optional) */
  readonly avatarUrl?: string;
  /** Assigned color for cursor/selection highlighting */
  readonly color: string;
  /** Current presence status */
  readonly status: PresenceStatus;
  /** Timestamp of last activity (ms since epoch) */
  readonly lastActiveAt: number;
  /** Current cursor position (optional) */
  readonly cursor?: CursorPosition;
  /** Current selection range (optional) */
  readonly selection?: SelectionRange;
  /** Additional metadata */
  readonly meta?: PresenceMeta;
}

/**
 * Local user's presence (self)
 * Extends PresenceUser with mutable update capabilities
 */
export interface SelfPresence extends PresenceUser {
  /** Whether this is the local user */
  readonly isSelf: true;
}

/**
 * Create a new PresenceUser with updated fields (immutable update)
 */
export const updatePresenceUser = (
  user: PresenceUser,
  updates: Partial<Omit<PresenceUser, "userId">>,
): PresenceUser => ({
  ...user,
  ...updates,
  lastActiveAt: updates.lastActiveAt ?? Date.now(),
});

/**
 * Create a new PresenceUser
 */
export const createPresenceUser = (
  userId: string,
  name: string,
  color: string,
  options?: Partial<Omit<PresenceUser, "userId" | "name" | "color">>,
): PresenceUser => ({
  userId,
  name,
  color,
  status: "active",
  lastActiveAt: Date.now(),
  ...options,
});
