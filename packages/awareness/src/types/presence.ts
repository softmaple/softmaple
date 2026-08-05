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
 * JSON-safe stable sequence anchor shape. This intentionally mirrors
 * `@softmaple/eg-walker/anchors` structurally without making awareness depend
 * on the EG-walker runtime.
 */
export type SequenceAnchorAffinity = "before" | "after";

export interface AtomSequenceAnchor {
  readonly type: "atom";
  readonly eventId: string;
  /** UTF-16 code-unit offset inside the creating insert event. */
  readonly offset: number;
  readonly affinity: SequenceAnchorAffinity;
}

export interface StartBoundarySequenceAnchor {
  readonly type: "boundary";
  readonly edge: "start";
  readonly affinity: "after";
}

export interface EndBoundarySequenceAnchor {
  readonly type: "boundary";
  readonly edge: "end";
  readonly affinity: "before";
}

export type BoundarySequenceAnchor =
  | StartBoundarySequenceAnchor
  | EndBoundarySequenceAnchor;

export type SequenceAnchor = AtomSequenceAnchor | BoundarySequenceAnchor;

/** One direction-preserving selection endpoint in a block document. */
export interface BlockSelectionPoint {
  readonly blockId: string;
  readonly anchor: SequenceAnchor;
}

/**
 * Directional selection supporting backwards and cross-block ranges.
 * `anchor` is the fixed end and `focus` is the moving end.
 */
export interface DirectionalSelectionRange {
  readonly anchor: BlockSelectionPoint;
  readonly focus: BlockSelectionPoint;
}

/** Legacy textarea ranges and stable rich-text ranges accepted by presence. */
export type PresenceSelection = SelectionRange | DirectionalSelectionRange;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isOffset = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Validate the dependency-free JSON representation of a sequence anchor. */
export const isSequenceAnchor = (value: unknown): value is SequenceAnchor => {
  if (!isRecord(value)) return false;

  if (value.type === "boundary") {
    return (
      (value.edge === "start" && value.affinity === "after") ||
      (value.edge === "end" && value.affinity === "before")
    );
  }

  return (
    value.type === "atom" &&
    typeof value.eventId === "string" &&
    value.eventId.length > 0 &&
    isOffset(value.offset) &&
    (value.affinity === "before" || value.affinity === "after")
  );
};

/** Validate the original single-block textarea selection representation. */
export const isLegacySelectionRange = (
  value: unknown,
): value is SelectionRange =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  isOffset(value.from) &&
  isOffset(value.to);

const isBlockSelectionPoint = (value: unknown): value is BlockSelectionPoint =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  isSequenceAnchor(value.anchor);

/** Validate a direction-preserving, potentially cross-block selection. */
export const isDirectionalSelectionRange = (
  value: unknown,
): value is DirectionalSelectionRange =>
  isRecord(value) &&
  isBlockSelectionPoint(value.anchor) &&
  isBlockSelectionPoint(value.focus);

/** Validate either supported presence selection representation. */
export const isPresenceSelection = (
  value: unknown,
): value is PresenceSelection =>
  isLegacySelectionRange(value) || isDirectionalSelectionRange(value);

const cloneSequenceAnchor = (anchor: SequenceAnchor): SequenceAnchor =>
  anchor.type === "atom"
    ? {
        type: anchor.type,
        eventId: anchor.eventId,
        offset: anchor.offset,
        affinity: anchor.affinity,
      }
    : anchor.edge === "start"
      ? { type: "boundary", edge: "start", affinity: "after" }
      : { type: "boundary", edge: "end", affinity: "before" };

/**
 * Whether a selection explicitly references a block. Directional ranges can
 * identify their two endpoint blocks; determining intermediate blocks remains
 * the responsibility of a document-order-aware binding.
 */
export const selectionReferencesBlock = (
  selection: unknown,
  blockId: string,
): boolean => {
  if (isLegacySelectionRange(selection)) {
    return selection.blockId === blockId;
  }
  if (!isDirectionalSelectionRange(selection)) return false;
  return (
    selection.anchor.blockId === blockId || selection.focus.blockId === blockId
  );
};

/**
 * Validate and copy a selection received across a JSON boundary. Unknown
 * fields are discarded; invalid data returns `null`.
 */
export const normalizePresenceSelection = (
  value: unknown,
): PresenceSelection | null => {
  if (isLegacySelectionRange(value)) {
    return { blockId: value.blockId, from: value.from, to: value.to };
  }
  if (!isDirectionalSelectionRange(value)) return null;

  return {
    anchor: {
      blockId: value.anchor.blockId,
      anchor: cloneSequenceAnchor(value.anchor.anchor),
    },
    focus: {
      blockId: value.focus.blockId,
      anchor: cloneSequenceAnchor(value.focus.anchor),
    },
  };
};

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
  readonly selection?: PresenceSelection;
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
  readonly selection?: PresenceSelection;
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
  meta: options.meta,
});
