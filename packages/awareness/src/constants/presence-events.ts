/**
 * Presence event type constants
 * Single source of truth for all presence-related event types
 */

/**
 * Presence event types for internal and external use
 */
export const PRESENCE_EVENT = {
  JOIN: "presence:join",
  LEAVE: "presence:leave",
  UPDATE: "presence:update",
  SYNC: "presence:sync",
} as const;

export type PresenceEventType =
  (typeof PRESENCE_EVENT)[keyof typeof PRESENCE_EVENT];

/**
 * BroadcastChannel message types
 */
export const BROADCAST_MESSAGE = {
  ANNOUNCE: "presence:announce",
  SYNC_REQUEST: "presence:sync-request",
  SYNC_RESPONSE: "presence:sync-response",
  UPDATE: "presence:update",
  LEAVE: "presence:leave",
} as const;

export type BroadcastMessageType =
  (typeof BROADCAST_MESSAGE)[keyof typeof BROADCAST_MESSAGE];

/**
 * WebSocket message types
 */
export const WS_MESSAGE = {
  JOIN: "join",
  LEAVE: "leave",
  PRESENCE_UPDATE: "presence:update",
  PRESENCE_SYNC: "presence:sync",
  PRESENCE_SYNC_RESPONSE: "presence:sync-response",
  HEARTBEAT: "heartbeat",
  HEARTBEAT_ACK: "heartbeat:ack",
  ERROR: "error",
} as const;

export type WebSocketMessageType = (typeof WS_MESSAGE)[keyof typeof WS_MESSAGE];

/**
 * Activity event types
 */
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
 * Channel name prefix for BroadcastChannel
 */
export const BROADCAST_CHANNEL_PREFIX = "softmaple-presence";

/**
 * Create channel name from room ID
 */
export const createChannelName = (roomId: string): string =>
  `${BROADCAST_CHANNEL_PREFIX}:${roomId}`;
