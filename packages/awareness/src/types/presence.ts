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
 * Opaque, JSON-serializable anchor encoded by the editor integration.
 * Awareness stores and forwards it, but never inspects the contents.
 */
export type PositionAnchor = string;

/**
 * Cursor position within the document
 */
export interface CursorPosition {
  /** Block/node ID where cursor is located */
  readonly blockId: string;
  /** Character offset within the block */
  readonly offset: number;
  /**
   * Optional editor-specific anchor. Receivers should prefer a resolved anchor
   * over `offset` when a resolver is configured.
   */
  readonly anchor?: PositionAnchor;
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
  /** Optional editor-specific anchor for `from`. */
  readonly fromAnchor?: PositionAnchor;
  /** Optional editor-specific anchor for `to`. */
  readonly toAnchor?: PositionAnchor;
}

/**
 * Pointer position within an explicit coordinate space. Pointers are not
 * document cursors and are never transformed by document edits.
 */
export interface PointerPosition {
  readonly x: number;
  readonly y: number;
  readonly space: "viewport" | "document";
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
  /** Current pointer position (optional) */
  readonly pointer?: PointerPosition;
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
 * Options for creating a new PresenceUser
 */
export interface CreatePresenceUserOptions {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  readonly status?: PresenceStatus;
  readonly lastActiveAt?: number;
  readonly avatarUrl?: string;
  readonly cursor?: CursorPosition;
  readonly selection?: SelectionRange;
  readonly pointer?: PointerPosition;
  readonly meta?: PresenceMeta;
}

/**
 * Create a new PresenceUser from options object
 */
export const createPresenceUser = (
  options: CreatePresenceUserOptions,
): PresenceUser => ({
  userId: options.userId,
  name: options.name,
  color: options.color,
  status: options.status ?? "active",
  lastActiveAt: options.lastActiveAt ?? Date.now(),
  avatarUrl: options.avatarUrl,
  cursor: options.cursor,
  selection: options.selection,
  pointer: options.pointer,
  meta: options.meta,
});
