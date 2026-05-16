/**
 * WebSocket message handling utilities
 */

import type { PresenceUser } from "../../types/presence";
import { updatePresenceUser } from "../../types/presence";
import type { AdapterState } from "../adapter-state";
import {
  removePresenceUser,
  setPresenceUser,
  updateState,
} from "../adapter-state";
import {
  type ErrorPayload,
  type JoinPayload,
  type LeavePayload,
  type PresenceSyncPayload,
  type PresenceUpdatePayload,
  type WebSocketMessage,
  WS_MESSAGE,
} from "./types";
import {
  isErrorPayload,
  isJoinPayload,
  isLeavePayload,
  isPresenceSyncPayload,
  isPresenceUpdatePayload,
  isRecord,
} from "./validation";

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
 * Accepts WebSocketMessageType or custom string types (e.g., 'auth')
 */
export const createMessage = (
  type: string,
  roomId: string,
  senderId: string,
  payload?: unknown,
): WebSocketMessage => ({
  type: type as WebSocketMessage["type"],
  roomId,
  senderId,
  timestamp: Date.now(),
  payload,
});

/**
 * Serialize message for sending.
 *
 * For `PRESENCE_UPDATE`, JSON would silently drop `cursor: undefined`,
 * `selection: undefined`, and `pointer: undefined` keys, which makes a
 * "clear" update indistinguishable from "no change" on peers. We rewrite
 * those fields to `null` so the intent survives the wire. The receiver
 * (`processPresenceUpdate`) normalizes `null` back to `undefined`.
 */
export const serializeMessage = (message: WebSocketMessage): string => {
  if (
    message.type === WS_MESSAGE.PRESENCE_UPDATE &&
    isRecord(message.payload) &&
    isRecord(message.payload.updates)
  ) {
    const updates = message.payload.updates as Record<string, unknown>;
    const normalizedUpdates: Record<string, unknown> = { ...updates };
    if ("cursor" in updates && updates.cursor === undefined) {
      normalizedUpdates.cursor = null;
    }
    if ("selection" in updates && updates.selection === undefined) {
      normalizedUpdates.selection = null;
    }
    if ("pointer" in updates && updates.pointer === undefined) {
      normalizedUpdates.pointer = null;
    }
    return JSON.stringify({
      ...message,
      payload: { ...message.payload, updates: normalizedUpdates },
    });
  }
  return JSON.stringify(message);
};

/**
 * Parse incoming WebSocket message
 */
export const parseMessage = (data: string): WebSocketMessage | null => {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.type !== "string") return null;
    if (typeof parsed.roomId !== "string") return null;
    if (typeof parsed.senderId !== "string") return null;
    if (typeof parsed.timestamp !== "number") return null;
    return parsed as unknown as WebSocketMessage;
  } catch {
    return null;
  }
};

/**
 * Map `null` cursor/selection/pointer (wire-level clear) back to `undefined` so
 * downstream state code, which treats `undefined` as "field absent", stays
 * the source of truth.
 */
const normalizeReceivedUpdates = (
  updates: PresenceUpdatePayload["updates"],
): PresenceUpdatePayload["updates"] => {
  // The wire shape may contain explicit `null` for cursor/selection; in the
  // in-memory model these are `undefined`. `PresenceUpdatePayload["updates"]`
  // has readonly fields, so we rebuild a fresh mutable object and then return
  // it as the readonly type.
  const wireUpdates = updates as Record<string, unknown>;
  const out: Record<string, unknown> = { ...wireUpdates };
  if (wireUpdates.cursor === null) {
    out.cursor = undefined;
  }
  if (wireUpdates.selection === null) {
    out.selection = undefined;
  }
  if (wireUpdates.pointer === null) {
    out.pointer = undefined;
  }
  return out as unknown as PresenceUpdatePayload["updates"];
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

  const normalizedUpdates = normalizeReceivedUpdates(payload.updates);
  const updatedUser = updatePresenceUser(existingUser, normalizedUpdates);
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
 * Process incoming WebSocket message.
 *
 * Every payload is validated against a runtime type guard. If validation
 * fails, the state is returned unchanged and an `error` is surfaced so
 * subscribers can log/telemetry-record the bad frame without crashing.
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
    case WS_MESSAGE.JOIN: {
      if (!isJoinPayload(message.payload)) {
        return {
          state,
          shouldNotifyPresence: false,
          error: new Error("Invalid JOIN payload"),
        };
      }
      return processJoin(state, message.payload);
    }

    case WS_MESSAGE.LEAVE: {
      if (!isLeavePayload(message.payload)) {
        return {
          state,
          shouldNotifyPresence: false,
          error: new Error("Invalid LEAVE payload"),
        };
      }
      return processLeave(state, message.payload);
    }

    case WS_MESSAGE.PRESENCE_UPDATE: {
      if (!isPresenceUpdatePayload(message.payload)) {
        return {
          state,
          shouldNotifyPresence: false,
          error: new Error("Invalid PRESENCE_UPDATE payload"),
        };
      }
      return processPresenceUpdate(state, message.payload);
    }

    case WS_MESSAGE.PRESENCE_SYNC:
    case WS_MESSAGE.PRESENCE_SYNC_RESPONSE: {
      if (!isPresenceSyncPayload(message.payload)) {
        return {
          state,
          shouldNotifyPresence: false,
          error: new Error("Invalid PRESENCE_SYNC payload"),
        };
      }
      return processPresenceSync(state, message.payload);
    }

    case WS_MESSAGE.ERROR: {
      if (!isErrorPayload(message.payload)) {
        return {
          state,
          shouldNotifyPresence: false,
          error: new Error("Invalid ERROR payload"),
        };
      }
      return processError(state, message.payload);
    }

    case WS_MESSAGE.HEARTBEAT_ACK:
      // Heartbeat ack is handled separately
      return { state, shouldNotifyPresence: false };

    default:
      return { state, shouldNotifyPresence: false };
  }
};
