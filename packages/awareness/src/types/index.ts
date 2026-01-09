/**
 * Awareness and Presence Types
 * Based on docs/design/awareness-and-presence.md
 */

// Event types
export type {
  ActivityEvent,
  ActivityEventData,
  ActivityType,
  CursorEventData,
  JoinEventData,
  LeaveEventData,
  PresenceEvent,
  PresenceEventPayload,
  PresenceEventType,
  PresenceJoinPayload,
  PresenceLeavePayload,
  PresenceSyncPayload,
  PresenceUpdatePayload,
  SelectionEventData,
  TypingEventData,
} from "./events";
export { createActivityEvent, createPresenceEvent } from "./events";
// Presence types
export type {
  CursorPosition,
  PresenceMeta,
  PresenceStatus,
  PresenceUser,
  SelectionRange,
  SelfPresence,
} from "./presence";
export { createPresenceUser, updatePresenceUser } from "./presence";

// State types
export type {
  ConnectionStatus,
  PresenceState,
  PresenceStateConfig,
} from "./state";

export {
  createInitialPresenceState,
  DEFAULT_PRESENCE_CONFIG,
  getOnlineUsers,
  getOtherUsers,
  getSelfUser,
  getUserById,
  getUsersArray,
} from "./state";
