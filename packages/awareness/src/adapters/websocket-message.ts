/**
 * WebSocket message handling utilities
 */

import { WS_MESSAGE } from "../constants/presence-events";
import type { PresenceUser } from "../types/presence";
import { updatePresenceUser } from "../types/presence";
import type { AdapterState } from "./adapter-state";
import {
  removePresenceUser,
  setPresenceUser,
  updateState,
} from "./adapter-state";
import type {
  ErrorPayload,
  JoinPayload,
  LeavePayload,
  PresenceSyncPayload,
  PresenceUpdatePayload,
  WebSocketMessage,
} from "./websocket-types";

/**
 * Result of processing a message
 */
export interface MessageProcessResult {
  readonly state: AdapterState;
  readonly shouldNotifyPresence: boolean;
  readonly error?: Error;
}

/**
 * Create a WebSocket message
 */
export const createMessage = (
  type: WebSocketMessage["type"],
  roomId: string,
  senderId: string,
  payload?: unknown,
): WebSocketMessage => ({
  type,
  roomId,
  senderId,
  timestamp: Date.now(),
  payload,
});

/**
 * Serialize message for sending
 */
export const serializeMessage = (message: WebSocketMessage): string =>
  JSON.stringify(message);

/**
 * Parse incoming WebSocket message
 */
export const parseMessage = (data: string): WebSocketMessage | null => {
  try {
    return JSON.parse(data) as WebSocketMessage;
  } catch {
    return null;
  }
};

/**
 * Process join message
 */
const processJoin = (
  state: AdapterState,
  payload: JoinPayload,
): MessageProcessResult => {
  const newPresence = setPresenceUser(state.presence, payload.user);
  return {
    state: updateState(state, { presence: newPresence }),
    shouldNotifyPresence: true,
  };
};

/**
 * Process leave message
 */
const processLeave = (
  state: AdapterState,
  payload: LeavePayload,
): MessageProcessResult => {
  const newPresence = removePresenceUser(state.presence, payload.userId);
  return {
    state: updateState(state, { presence: newPresence }),
    shouldNotifyPresence: true,
  };
};

/**
 * Process presence update message
 */
const processPresenceUpdate = (
  state: AdapterState,
  payload: PresenceUpdatePayload,
): MessageProcessResult => {
  const existingUser = state.presence.get(payload.userId);
  if (existingUser === undefined) {
    return { state, shouldNotifyPresence: false };
  }

  const updatedUser = updatePresenceUser(existingUser, payload.updates);
  const newPresence = setPresenceUser(state.presence, updatedUser);
  return {
    state: updateState(state, { presence: newPresence }),
    shouldNotifyPresence: true,
  };
};

/**
 * Process presence sync message (full state from server)
 */
const processPresenceSync = (
  state: AdapterState,
  payload: PresenceSyncPayload,
): MessageProcessResult => {
  const newPresence = new Map<string, PresenceUser>();
  for (const user of payload.users) {
    newPresence.set(user.userId, user);
  }
  // Preserve self in presence map
  if (state.self !== null) {
    newPresence.set(state.self.userId, state.self);
  }
  return {
    state: updateState(state, { presence: newPresence }),
    shouldNotifyPresence: true,
  };
};

/**
 * Process error message
 */
const processError = (
  state: AdapterState,
  payload: ErrorPayload,
): MessageProcessResult => ({
  state,
  shouldNotifyPresence: false,
  error: new Error(`[${payload.code}] ${payload.message}`),
});

/**
 * Process incoming WebSocket message
 */
export const processMessage = (
  state: AdapterState,
  message: WebSocketMessage,
  selfId: string,
): MessageProcessResult => {
  // Ignore own messages
  if (message.senderId === selfId) {
    return { state, shouldNotifyPresence: false };
  }

  switch (message.type) {
    case WS_MESSAGE.JOIN:
      return processJoin(state, message.payload as JoinPayload);

    case WS_MESSAGE.LEAVE:
      return processLeave(state, message.payload as LeavePayload);

    case WS_MESSAGE.PRESENCE_UPDATE:
      return processPresenceUpdate(
        state,
        message.payload as PresenceUpdatePayload,
      );

    case WS_MESSAGE.PRESENCE_SYNC:
    case WS_MESSAGE.PRESENCE_SYNC_RESPONSE:
      return processPresenceSync(state, message.payload as PresenceSyncPayload);

    case WS_MESSAGE.ERROR:
      return processError(state, message.payload as ErrorPayload);

    case WS_MESSAGE.HEARTBEAT_ACK:
      // Heartbeat ack is handled separately
      return { state, shouldNotifyPresence: false };

    default:
      return { state, shouldNotifyPresence: false };
  }
};
