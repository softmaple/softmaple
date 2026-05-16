/**
 * BroadcastChannel message types and handlers
 */

import {
  PRESENCE_EVENT,
  type PresenceEvent,
  type PresenceJoinPayload,
  type PresenceLeavePayload,
  type PresenceUpdatePayload,
  type PresenceUserUpdates,
} from "../../types/events";
import type {
  CursorPosition,
  PointerPosition,
  PresenceUser,
  SelectionRange,
} from "../../types/presence";
import { updatePresenceUser } from "../../types/presence";
import {
  type AdapterState,
  removePresenceUser,
  setPresenceUser,
  updateState,
} from "../adapter-state";
import type { SubscriptionManager } from "../subscription-manager";

export const BROADCAST_MESSAGE = {
  ANNOUNCE: "presence:announce",
  SYNC_REQUEST: "presence:sync-request",
  SYNC_RESPONSE: "presence:sync-response",
  UPDATE: "presence:update",
  LEAVE: "presence:leave",
} as const;

export type BroadcastMessageType =
  (typeof BROADCAST_MESSAGE)[keyof typeof BROADCAST_MESSAGE];

export interface BroadcastMessage {
  readonly type: BroadcastMessageType;
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload: unknown;
}

/**
 * Type guard for plain objects
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCursorPosition = (value: unknown): value is CursorPosition =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  typeof value.offset === "number" &&
  (value.anchor === undefined || typeof value.anchor === "string");

const isSelectionRange = (value: unknown): value is SelectionRange =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  typeof value.from === "number" &&
  typeof value.to === "number" &&
  (value.fromAnchor === undefined || typeof value.fromAnchor === "string") &&
  (value.toAnchor === undefined || typeof value.toAnchor === "string");

const isPointerPosition = (value: unknown): value is PointerPosition =>
  isRecord(value) &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  (value.space === "viewport" || value.space === "document");

/**
 * Type guard for PresenceUser payload
 */
const isPresenceUser = (value: unknown): value is PresenceUser => {
  if (!isRecord(value)) return false;
  if (typeof value.userId !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.color !== "string") return false;
  if (
    value.status !== "active" &&
    value.status !== "idle" &&
    value.status !== "offline"
  ) {
    return false;
  }
  if (typeof value.lastActiveAt !== "number") return false;
  if (value.avatarUrl !== undefined && typeof value.avatarUrl !== "string") {
    return false;
  }
  if (
    value.cursor !== undefined &&
    value.cursor !== null &&
    !isCursorPosition(value.cursor)
  ) {
    return false;
  }
  if (
    value.selection !== undefined &&
    value.selection !== null &&
    !isSelectionRange(value.selection)
  ) {
    return false;
  }
  if (
    value.pointer !== undefined &&
    value.pointer !== null &&
    !isPointerPosition(value.pointer)
  ) {
    return false;
  }
  if (
    value.meta !== undefined &&
    value.meta !== null &&
    !isRecord(value.meta)
  ) {
    return false;
  }
  return true;
};

/**
 * Type guard for update payload shape
 */
const isUpdatePayload = (
  value: unknown,
): value is { userId: string; updates: PresenceUserUpdates } => {
  if (!isRecord(value)) return false;
  if (typeof value.userId !== "string") return false;
  if (!isRecord(value.updates)) return false;

  const updates = value.updates;
  if (
    updates.cursor !== undefined &&
    updates.cursor !== null &&
    !isCursorPosition(updates.cursor)
  ) {
    return false;
  }
  if (
    updates.selection !== undefined &&
    updates.selection !== null &&
    !isSelectionRange(updates.selection)
  ) {
    return false;
  }
  if (
    updates.pointer !== undefined &&
    updates.pointer !== null &&
    !isPointerPosition(updates.pointer)
  ) {
    return false;
  }
  return true;
};

/**
 * Type guard for leave payload (userId string)
 */
const isLeavePayload = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Create a broadcast message
 */
export const createBroadcastMessage = (
  type: BroadcastMessageType,
  senderId: string,
  payload: unknown,
): BroadcastMessage => ({
  type,
  senderId,
  timestamp: Date.now(),
  payload,
});

/**
 * Send a message through a BroadcastChannel
 */
export const sendBroadcastMessage = (
  channel: BroadcastChannel | null,
  message: BroadcastMessage,
  onError: (error: Error) => void,
): void => {
  if (channel === null) return;

  try {
    channel.postMessage(message);
  } catch (error) {
    onError(
      error instanceof Error
        ? error
        : new Error("Failed to send broadcast message"),
    );
  }
};

/**
 * Handle presence:announce message
 */
const handleAnnounce = (
  message: BroadcastMessage,
  state: AdapterState,
  subscriptions: SubscriptionManager,
  sendResponse: (self: PresenceUser) => void,
): AdapterState => {
  if (!isPresenceUser(message.payload)) {
    return state;
  }

  const user = message.payload;
  const newState = updateState(state, {
    presence: setPresenceUser(state.presence, user),
  });

  subscriptions.notifyPresenceChange(newState.presence);

  const joinPayload: PresenceJoinPayload = {
    type: PRESENCE_EVENT.JOIN,
    user,
  };
  const event: PresenceEvent = {
    type: PRESENCE_EVENT.JOIN,
    payload: joinPayload,
    timestamp: message.timestamp,
  };
  subscriptions.notifyEvent(event);

  if (state.self !== null) {
    sendResponse(state.self);
  }

  return newState;
};

/**
 * Handle presence:sync-response message
 */
const handleSyncResponse = (
  message: BroadcastMessage,
  state: AdapterState,
  subscriptions: SubscriptionManager,
): AdapterState => {
  if (!isPresenceUser(message.payload)) {
    return state;
  }

  const user = message.payload;
  const newState = updateState(state, {
    presence: setPresenceUser(state.presence, user),
  });
  subscriptions.notifyPresenceChange(newState.presence);
  return newState;
};

/**
 * Handle presence:update message
 */
const handleUpdate = (
  message: BroadcastMessage,
  state: AdapterState,
  subscriptions: SubscriptionManager,
): AdapterState => {
  if (!isUpdatePayload(message.payload)) {
    return state;
  }

  const updates = message.payload;
  const existingUser = state.presence.get(updates.userId);

  if (existingUser === undefined) {
    return state;
  }

  const updatedUser = updatePresenceUser(existingUser, updates.updates);
  const newState = updateState(state, {
    presence: setPresenceUser(state.presence, updatedUser),
  });

  subscriptions.notifyPresenceChange(newState.presence);

  const updatePayload: PresenceUpdatePayload = {
    type: PRESENCE_EVENT.UPDATE,
    userId: updates.userId,
    updates: updates.updates,
  };
  const event: PresenceEvent = {
    type: PRESENCE_EVENT.UPDATE,
    payload: updatePayload,
    timestamp: message.timestamp,
  };
  subscriptions.notifyEvent(event);

  return newState;
};

/**
 * Handle presence:leave message
 */
const handleLeave = (
  message: BroadcastMessage,
  state: AdapterState,
  subscriptions: SubscriptionManager,
): AdapterState => {
  if (!isLeavePayload(message.payload)) {
    return state;
  }

  const userId = message.payload;

  if (!state.presence.has(userId)) {
    return state;
  }

  const newState = updateState(state, {
    presence: removePresenceUser(state.presence, userId),
  });

  subscriptions.notifyPresenceChange(newState.presence);

  const leavePayload: PresenceLeavePayload = {
    type: PRESENCE_EVENT.LEAVE,
    userId,
  };
  const event: PresenceEvent = {
    type: PRESENCE_EVENT.LEAVE,
    payload: leavePayload,
    timestamp: message.timestamp,
  };
  subscriptions.notifyEvent(event);

  return newState;
};

/**
 * Process an incoming broadcast message
 * Returns the updated state
 */
export const processBroadcastMessage = (
  message: BroadcastMessage,
  state: AdapterState,
  subscriptions: SubscriptionManager,
  sendSyncResponse: (self: PresenceUser) => void,
): AdapterState => {
  switch (message.type) {
    case BROADCAST_MESSAGE.ANNOUNCE:
      return handleAnnounce(message, state, subscriptions, sendSyncResponse);

    case BROADCAST_MESSAGE.SYNC_REQUEST:
      if (state.self !== null) {
        sendSyncResponse(state.self);
      }
      return state;

    case BROADCAST_MESSAGE.SYNC_RESPONSE:
      return handleSyncResponse(message, state, subscriptions);

    case BROADCAST_MESSAGE.UPDATE:
      return handleUpdate(message, state, subscriptions);

    case BROADCAST_MESSAGE.LEAVE:
      return handleLeave(message, state, subscriptions);

    default:
      return state;
  }
};
