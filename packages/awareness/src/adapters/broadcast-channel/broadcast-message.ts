/**
 * BroadcastChannel message types and handlers
 */

import type { StatusTimeouts } from "../../core/status";
import { withDerivedStatus } from "../../core/status";
import {
  PRESENCE_EVENT,
  type PresenceEvent,
  type PresenceJoinPayload,
  type PresenceLeavePayload,
  type PresenceUpdatePayload,
  type PresenceUserUpdates,
} from "../../types/events";
import {
  applyClockedPresenceUpdate,
  type PresenceUser,
  touchUserSeen,
} from "../../types/presence";
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
  /** connectionId of the sender */
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload: unknown;
}

const isPresenceUser = (value: unknown): value is PresenceUser => {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.connectionId === "string" &&
    typeof obj.userId === "string" &&
    typeof obj.name === "string" &&
    typeof obj.color === "string" &&
    (obj.status === "active" ||
      obj.status === "idle" ||
      obj.status === "offline") &&
    typeof obj.lastActivityAt === "number" &&
    typeof obj.lastSeenAt === "number" &&
    typeof obj.clock === "number"
  );
};

interface WireUpdatePayload {
  readonly connectionId: string;
  readonly userId: string;
  readonly clock: number;
  readonly updates: PresenceUserUpdates;
}

const isUpdatePayload = (value: unknown): value is WireUpdatePayload => {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.connectionId === "string" &&
    typeof obj.userId === "string" &&
    typeof obj.clock === "number" &&
    typeof obj.updates === "object" &&
    obj.updates !== null
  );
};

const isLeavePayload = (
  value: unknown,
): value is { connectionId: string; userId: string } => {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.connectionId === "string" && typeof obj.userId === "string"
  );
};

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

const handleUpdate = (
  message: BroadcastMessage,
  state: AdapterState,
  subscriptions: SubscriptionManager,
  statusTimeouts: StatusTimeouts,
): AdapterState => {
  if (!isUpdatePayload(message.payload)) {
    return state;
  }

  const wire = message.payload;
  const existingUser = state.presence.get(wire.connectionId);

  if (existingUser === undefined) {
    return state;
  }

  // Liveness-only updates (heartbeat) may omit activity fields and keep clock
  const isLivenessOnly =
    wire.updates.lastSeenAt !== undefined &&
    wire.updates.lastActivityAt === undefined &&
    wire.clock === existingUser.clock;

  let updatedUser: PresenceUser;
  if (isLivenessOnly) {
    updatedUser = withDerivedStatus(
      touchUserSeen(existingUser, wire.updates.lastSeenAt),
      statusTimeouts,
      message.timestamp,
    );
  } else {
    const applied = applyClockedPresenceUpdate(
      existingUser,
      wire.clock,
      wire.updates,
      message.timestamp,
    );
    updatedUser = withDerivedStatus(
      applied ?? existingUser,
      statusTimeouts,
      message.timestamp,
    );
  }

  const newState = updateState(state, {
    presence: setPresenceUser(state.presence, updatedUser),
  });

  subscriptions.notifyPresenceChange(newState.presence);

  const updatePayload: PresenceUpdatePayload = {
    type: PRESENCE_EVENT.UPDATE,
    connectionId: wire.connectionId,
    userId: wire.userId,
    clock: updatedUser.clock,
    updates: wire.updates,
  };
  const event: PresenceEvent = {
    type: PRESENCE_EVENT.UPDATE,
    payload: updatePayload,
    timestamp: message.timestamp,
  };
  subscriptions.notifyEvent(event);

  return newState;
};

const handleLeave = (
  message: BroadcastMessage,
  state: AdapterState,
  subscriptions: SubscriptionManager,
): AdapterState => {
  if (!isLeavePayload(message.payload)) {
    return state;
  }

  const { connectionId, userId } = message.payload;

  if (!state.presence.has(connectionId)) {
    return state;
  }

  const newState = updateState(state, {
    presence: removePresenceUser(state.presence, connectionId),
  });

  subscriptions.notifyPresenceChange(newState.presence);

  const leavePayload: PresenceLeavePayload = {
    type: PRESENCE_EVENT.LEAVE,
    connectionId,
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
 */
export const processBroadcastMessage = (
  message: BroadcastMessage,
  state: AdapterState,
  subscriptions: SubscriptionManager,
  sendSyncResponse: (self: PresenceUser) => void,
  statusTimeouts: StatusTimeouts = {
    idleTimeoutMs: 30_000,
    offlineTimeoutMs: 15_000,
  },
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
      return handleUpdate(message, state, subscriptions, statusTimeouts);

    case BROADCAST_MESSAGE.LEAVE:
      return handleLeave(message, state, subscriptions);

    default:
      return state;
  }
};
