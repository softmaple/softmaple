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
 * Legacy cursor position using a volatile character offset.
 * Prefer {@link StableCursorPosition} for concurrent editing.
 */
export interface OffsetCursorPosition {
  readonly blockId: string;
  readonly offset: number;
}

/**
 * Cursor position anchored to a stable sequence identity so concurrent
 * edits do not invalidate the remote caret.
 */
export interface StableCursorPosition {
  readonly blockId: string;
  readonly anchor: SequenceAnchor;
  /**
   * Optional resolved offset for surfaces that still need a numeric caret
   * for rendering (e.g. textarea). Not authoritative across concurrent edits.
   */
  readonly offset?: number;
}

/**
 * Cursor position within the document. Offset-based and stable-anchor forms
 * are both accepted so textarea demos and EG-walker surfaces can coexist.
 */
export type CursorPosition = OffsetCursorPosition | StableCursorPosition;

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

/** Validate an offset-based (legacy) cursor. */
export const isOffsetCursorPosition = (
  value: unknown,
): value is OffsetCursorPosition =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  isOffset(value.offset) &&
  value.anchor === undefined;

/** Validate a stable-anchor cursor. */
export const isStableCursorPosition = (
  value: unknown,
): value is StableCursorPosition =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  isSequenceAnchor(value.anchor) &&
  (value.offset === undefined || isOffset(value.offset));

/** Validate either supported cursor representation. */
export const isCursorPosition = (value: unknown): value is CursorPosition =>
  isOffsetCursorPosition(value) || isStableCursorPosition(value);

/** True when the cursor carries a stable sequence anchor. */
export const isStableCursor = (
  cursor: CursorPosition,
): cursor is StableCursorPosition =>
  "anchor" in cursor && cursor.anchor != null;

/** Resolve a numeric offset from either cursor form when available. */
export const getCursorOffset = (cursor: CursorPosition): number | undefined =>
  "offset" in cursor ? cursor.offset : undefined;

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
 * Validate and copy a cursor received across a JSON boundary.
 */
export const normalizeCursorPosition = (
  value: unknown,
): CursorPosition | null => {
  if (isStableCursorPosition(value)) {
    return {
      blockId: value.blockId,
      anchor: cloneSequenceAnchor(value.anchor),
      ...(value.offset !== undefined ? { offset: value.offset } : {}),
    };
  }
  if (isOffsetCursorPosition(value)) {
    return { blockId: value.blockId, offset: value.offset };
  }
  return null;
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
 * Fields that may be patched without implying user activity.
 * Timestamps and clock are owned by dedicated APIs.
 */
export type PresenceUserPatch = Partial<
  Omit<
    PresenceUser,
    "connectionId" | "userId" | "lastActivityAt" | "lastSeenAt" | "clock"
  >
>;

/**
 * Represents a remote user's presence session in the document.
 * Immutable by design - create new objects for updates.
 *
 * Identity:
 * - `userId` is the persistent account / actor identity
 * - `connectionId` is ephemeral per tab / device / socket
 *
 * Liveness vs activity:
 * - `lastSeenAt` advances on any transport frame / heartbeat
 * - `lastActivityAt` advances only on real user activity
 * - `status` is derived from those two clocks (see `derivePresenceStatus`)
 */
export interface PresenceUser {
  /** Ephemeral per-connection session identifier */
  readonly connectionId: string;
  /** Persistent user identifier */
  readonly userId: string;
  /** Display name */
  readonly name: string;
  /** Avatar URL (optional) */
  readonly avatarUrl?: string;
  /** Assigned color for cursor/selection highlighting */
  readonly color: string;
  /** Current presence status (derived; stored for consumers) */
  readonly status: PresenceStatus;
  /** Timestamp of last real user activity (ms since epoch) */
  readonly lastActivityAt: number;
  /** Timestamp of last transport liveness signal (ms since epoch) */
  readonly lastSeenAt: number;
  /** Monotonic per-connection revision for stale-update protection */
  readonly clock: number;
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
 * Patch presence fields without touching timestamps or clock.
 * Never use this for heartbeats or activity — use the dedicated APIs.
 */
export const patchPresenceUser = (
  user: PresenceUser,
  updates: PresenceUserPatch,
): PresenceUser => ({
  ...user,
  ...updates,
  connectionId: user.connectionId,
  userId: user.userId,
  lastActivityAt: user.lastActivityAt,
  lastSeenAt: user.lastSeenAt,
  clock: user.clock,
});

/**
 * @deprecated Use {@link patchPresenceUser} or activity/liveness APIs.
 * Kept as an alias that does **not** implicitly bump timestamps.
 */
export const updatePresenceUser = patchPresenceUser;

/**
 * Mark real user activity (input / edit / selection / cursor / typing).
 * Updates `lastActivityAt`, bumps `lastSeenAt`, sets status to active, and
 * increments the per-connection clock.
 */
export const markUserActivity = (
  user: PresenceUser,
  at: number = Date.now(),
  extras?: PresenceUserPatch,
): PresenceUser => ({
  ...user,
  ...extras,
  connectionId: user.connectionId,
  userId: user.userId,
  lastActivityAt: at,
  lastSeenAt: at,
  status: "active",
  clock: user.clock + 1,
});

/**
 * Record a liveness signal (heartbeat / any transport frame).
 * Updates `lastSeenAt` only — never touches `lastActivityAt`.
 * Does not bump clock (heartbeat is not presence state).
 * `lastSeenAt` is monotonic (never decreases).
 */
export const touchUserSeen = (
  user: PresenceUser,
  at: number = Date.now(),
): PresenceUser => ({
  ...user,
  lastSeenAt: Math.max(user.lastSeenAt, at),
});

/**
 * Apply a remote presence update only when `incomingClock` is newer.
 * Stale clocks still refresh liveness via `touchUserSeen`.
 * `lastSeenAt` is the max of the prior value, any wire timestamp, and local receipt.
 */
export const applyClockedPresenceUpdate = (
  user: PresenceUser,
  incomingClock: number,
  updates: PresenceUserPatch & {
    readonly lastActivityAt?: number;
    readonly lastSeenAt?: number;
  },
  seenAt: number = Date.now(),
): PresenceUser => {
  if (incomingClock <= user.clock) {
    // Still refresh liveness so a stale-but-alive peer is not offline'd.
    return touchUserSeen(user, seenAt);
  }

  const nextActivityAt = updates.lastActivityAt ?? user.lastActivityAt;
  const nextSeenAt = Math.max(
    user.lastSeenAt,
    updates.lastSeenAt ?? seenAt,
    seenAt,
  );

  const { lastActivityAt: _a, lastSeenAt: _s, ...patch } = updates;

  return {
    ...user,
    ...patch,
    connectionId: user.connectionId,
    userId: user.userId,
    clock: incomingClock,
    lastActivityAt: nextActivityAt,
    lastSeenAt: nextSeenAt,
  };
};

/**
 * Options for creating a new PresenceUser
 */
export interface CreatePresenceUserOptions {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  /** Ephemeral connection id; generated when omitted */
  readonly connectionId?: string;
  readonly status?: PresenceStatus;
  readonly lastActivityAt?: number;
  readonly lastSeenAt?: number;
  readonly clock?: number;
  readonly avatarUrl?: string;
  readonly cursor?: CursorPosition;
  readonly selection?: PresenceSelection;
  readonly meta?: PresenceMeta;
}

let connectionIdCounter = 0;

/** Generate an ephemeral connection id for a local presence session. */
export const createConnectionId = (userId?: string): string => {
  connectionIdCounter += 1;
  let rand: string;
  const cryptoApi = globalThis.crypto;
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === "function") {
    rand = cryptoApi.randomUUID();
  } else if (
    cryptoApi !== undefined &&
    typeof cryptoApi.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(8);
    cryptoApi.getRandomValues(bytes);
    rand = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    rand = `${Date.now().toString(36)}-${connectionIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return userId !== undefined ? `${userId}:${rand}` : rand;
};

/**
 * Create a new PresenceUser from options object
 */
export const createPresenceUser = (
  options: CreatePresenceUserOptions,
): PresenceUser => {
  const now = Date.now();
  const lastActivityAt = options.lastActivityAt ?? now;
  const lastSeenAt = options.lastSeenAt ?? lastActivityAt;
  return {
    connectionId: options.connectionId ?? createConnectionId(options.userId),
    userId: options.userId,
    name: options.name,
    color: options.color,
    status: options.status ?? "active",
    lastActivityAt,
    lastSeenAt,
    clock: options.clock ?? 0,
    avatarUrl: options.avatarUrl,
    cursor: options.cursor,
    selection: options.selection,
    meta: options.meta,
  };
};
