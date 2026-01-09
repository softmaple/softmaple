/**
 * Event types for presence system
 * Based on docs/design/awareness-and-presence.md
 */

import {
  ACTIVITY_TYPE,
  type ActivityType,
  PRESENCE_EVENT,
  type PresenceEventType,
} from "../constants/presence-events";
import type { CursorPosition, PresenceUser, SelectionRange } from "./presence";

export { ACTIVITY_TYPE, PRESENCE_EVENT };
export type { ActivityType, PresenceEventType };

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
  readonly range: SelectionRange | null;
}

export interface TypingEventData {
  readonly type: typeof ACTIVITY_TYPE.TYPING;
  readonly isTyping: boolean;
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

export interface PresenceUpdatePayload {
  readonly type: typeof PRESENCE_EVENT.UPDATE;
  readonly userId: string;
  readonly updates: Partial<PresenceUser>;
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
