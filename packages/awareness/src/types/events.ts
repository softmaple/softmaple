/**
 * Event types for presence system
 * Based on docs/design/awareness-and-presence.md
 */

import type {
  CursorPosition,
  PresenceSelection,
  PresenceUser,
} from "./presence";

export const PRESENCE_EVENT = {
  JOIN: "presence:join",
  LEAVE: "presence:leave",
  UPDATE: "presence:update",
  SYNC: "presence:sync",
} as const;

export type PresenceEventType =
  (typeof PRESENCE_EVENT)[keyof typeof PRESENCE_EVENT];

export const ACTIVITY_TYPE = {
  JOIN: "join",
  LEAVE: "leave",
  CURSOR: "cursor",
  SELECTION: "selection",
  TYPING: "typing",
  IDLE: "idle",
} as const;

export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

/**
 * Activity event representing a user action
 */
export interface ActivityEvent {
  /** User who performed the activity */
  readonly userId: string;
  /** Timestamp of the activity (ms since epoch) */
  readonly timestamp: number;
  /** Type of activity */
  readonly type: ActivityType;
  /** Additional event-specific data */
  readonly data?: ActivityEventData;
}

/**
 * Union type for activity event data
 */
export type ActivityEventData =
  | JoinEventData
  | LeaveEventData
  | CursorEventData
  | SelectionEventData
  | TypingEventData
  | IdleEventData;

export interface JoinEventData {
  readonly type: typeof ACTIVITY_TYPE.JOIN;
  readonly user: PresenceUser;
}

export interface LeaveEventData {
  readonly type: typeof ACTIVITY_TYPE.LEAVE;
  readonly userId: string;
}

export interface CursorEventData {
  readonly type: typeof ACTIVITY_TYPE.CURSOR;
  readonly position: CursorPosition | null;
}

export interface SelectionEventData {
  readonly type: typeof ACTIVITY_TYPE.SELECTION;
  readonly range: PresenceSelection | null;
}

export interface TypingEventData {
  readonly type: typeof ACTIVITY_TYPE.TYPING;
  readonly isTyping: boolean;
}

/**
 * Idle event data - indicates user transitioned to idle state
 */
export interface IdleEventData {
  readonly type: typeof ACTIVITY_TYPE.IDLE;
}

/**
 * Presence event payload
 */
export interface PresenceEvent {
  readonly type: PresenceEventType;
  readonly payload: PresenceEventPayload;
  readonly timestamp: number;
}

/**
 * Union type for presence event payloads
 */
export type PresenceEventPayload =
  | PresenceJoinPayload
  | PresenceLeavePayload
  | PresenceUpdatePayload
  | PresenceSyncPayload;

export interface PresenceJoinPayload {
  readonly type: typeof PRESENCE_EVENT.JOIN;
  readonly user: PresenceUser;
}

export interface PresenceLeavePayload {
  readonly type: typeof PRESENCE_EVENT.LEAVE;
  readonly userId: string;
}

/**
 * Updates for presence - excludes userId to prevent patching the authoritative ID
 */
export type PresenceUserUpdates = Partial<Omit<PresenceUser, "userId">>;

export interface PresenceUpdatePayload {
  readonly type: typeof PRESENCE_EVENT.UPDATE;
  /** Authoritative user ID - cannot be changed via updates */
  readonly userId: string;
  /** Partial updates excluding userId */
  readonly updates: PresenceUserUpdates;
}

export interface PresenceSyncPayload {
  readonly type: typeof PRESENCE_EVENT.SYNC;
  readonly users: ReadonlyArray<PresenceUser>;
}

/**
 * Create an activity event (pure function)
 */
export const createActivityEvent = (
  userId: string,
  type: ActivityType,
  data?: ActivityEventData,
): ActivityEvent => ({
  userId,
  timestamp: Date.now(),
  type,
  data,
});

/**
 * Create a presence event (pure function)
 */
export const createPresenceEvent = (
  type: PresenceEventType,
  payload: PresenceEventPayload,
): PresenceEvent => ({
  type,
  payload,
  timestamp: Date.now(),
});
