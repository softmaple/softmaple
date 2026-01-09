/**
 * Event types for presence system
 * Based on docs/design/awareness-and-presence.md
 */

import type { CursorPosition, PresenceUser, SelectionRange } from "./presence";

/**
 * Types of user activity events
 */
export type ActivityType =
  | "join"
  | "leave"
  | "cursor"
  | "selection"
  | "typing"
  | "idle";

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
  | TypingEventData;

export interface JoinEventData {
  readonly type: "join";
  readonly user: PresenceUser;
}

export interface LeaveEventData {
  readonly type: "leave";
  readonly userId: string;
}

export interface CursorEventData {
  readonly type: "cursor";
  readonly position: CursorPosition | null;
}

export interface SelectionEventData {
  readonly type: "selection";
  readonly range: SelectionRange | null;
}

export interface TypingEventData {
  readonly type: "typing";
  readonly isTyping: boolean;
}

/**
 * Presence event types for pub/sub
 */
export type PresenceEventType =
  | "presence:join"
  | "presence:leave"
  | "presence:update"
  | "presence:sync";

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
  readonly type: "presence:join";
  readonly user: PresenceUser;
}

export interface PresenceLeavePayload {
  readonly type: "presence:leave";
  readonly userId: string;
}

export interface PresenceUpdatePayload {
  readonly type: "presence:update";
  readonly userId: string;
  readonly updates: Partial<PresenceUser>;
}

export interface PresenceSyncPayload {
  readonly type: "presence:sync";
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
