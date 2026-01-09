/**
 * BroadcastChannel message types and handlers
 */

import type {
  PresenceEvent,
  PresenceJoinPayload,
  PresenceLeavePayload,
  PresenceUpdatePayload,
} from "../types/events";
import { type PresenceUser, updatePresenceUser } from "../types/presence";
import {
  type AdapterState,
  removePresenceUser,
  setPresenceUser,
  updateState,
} from "./adapter-state";
import type { SubscriptionManager } from "./subscription-manager";

/**
 * Internal message types for BroadcastChannel communication
 */
export type BroadcastMessageType =
  | "presence:announce"
  | "presence:sync-request"
  | "presence:sync-response"
  | "presence:update"
  | "presence:leave";

export interface BroadcastMessage {
  readonly type: BroadcastMessageType;
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload: unknown;
}

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
  const user = message.payload as PresenceUser;
  const newState = updateState(state, {
    presence: setPresenceUser(state.presence, user),
  });

  subscriptions.notifyPresenceChange(newState.presence);

  const joinPayload: PresenceJoinPayload = {
    type: "presence:join",
    user,
  };
  const event: PresenceEvent = {
    type: "presence:join",
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
  const user = message.payload as PresenceUser;
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
  const updates = message.payload as {
    userId: string;
    updates: Partial<PresenceUser>;
  };
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
    type: "presence:update",
    userId: updates.userId,
    updates: updates.updates,
  };
  const event: PresenceEvent = {
    type: "presence:update",
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
  const userId = message.payload as string;

  if (!state.presence.has(userId)) {
    return state;
  }

  const newState = updateState(state, {
    presence: removePresenceUser(state.presence, userId),
  });

  subscriptions.notifyPresenceChange(newState.presence);

  const leavePayload: PresenceLeavePayload = {
    type: "presence:leave",
    userId,
  };
  const event: PresenceEvent = {
    type: "presence:leave",
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
    case "presence:announce":
      return handleAnnounce(message, state, subscriptions, sendSyncResponse);

    case "presence:sync-request":
      if (state.self !== null) {
        sendSyncResponse(state.self);
      }
      return state;

    case "presence:sync-response":
      return handleSyncResponse(message, state, subscriptions);

    case "presence:update":
      return handleUpdate(message, state, subscriptions);

    case "presence:leave":
      return handleLeave(message, state, subscriptions);

    default:
      return state;
  }
};
