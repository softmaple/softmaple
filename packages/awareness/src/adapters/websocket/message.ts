/**
 * WebSocket message handling utilities
 */

import {
  applyClockedPresenceUpdate,
  type PresenceUser,
} from "../../types/presence";
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
  isHeartbeatPayload,
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
  /** True when this frame completes the initial presence sync */
  readonly syncCompleted?: boolean;
  /** True when auth succeeded */
  readonly authOk?: boolean;
  /**
   * Set on an auth-error frame: true when the server reported the failure as
   * a transient dependency outage rather than a rejected credential, so the
   * adapter should reconnect instead of failing permanently.
   */
  readonly authErrorRetryable?: boolean;
  /** Heartbeat ack pingId when applicable */
  readonly heartbeatAckPingId?: string;
}

/**
 * Create a WebSocket message
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
 * For `PRESENCE_UPDATE`, JSON would silently drop `cursor: undefined` /
 * `selection: undefined` keys. Rewrite those fields to `null` so clear intent
 * survives the wire.
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

const normalizeReceivedUpdates = (
  updates: PresenceUpdatePayload["updates"],
): PresenceUpdatePayload["updates"] => {
  const wireUpdates = updates as Record<string, unknown>;
  const out: Record<string, unknown> = { ...wireUpdates };
  if (wireUpdates.cursor === null) {
    out.cursor = undefined;
  }
  if (wireUpdates.selection === null) {
    out.selection = undefined;
  }
  return out as unknown as PresenceUpdatePayload["updates"];
};

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

const processLeave = (
  state: AdapterState,
  payload: LeavePayload,
): MessageProcessResult => {
  const newPresence = removePresenceUser(state.presence, payload.connectionId);
  return {
    state: updateState(state, { presence: newPresence }),
    shouldNotifyPresence: true,
  };
};

const processPresenceUpdate = (
  state: AdapterState,
  payload: PresenceUpdatePayload,
  seenAt: number = Date.now(),
): MessageProcessResult => {
  const existingUser = state.presence.get(payload.connectionId);
  if (existingUser === undefined) {
    return { state, shouldNotifyPresence: false };
  }

  const normalizedUpdates = normalizeReceivedUpdates(payload.updates);
  const updatedUser = applyClockedPresenceUpdate(
    existingUser,
    payload.clock,
    normalizedUpdates,
    seenAt,
  );
  const newPresence = setPresenceUser(state.presence, updatedUser);
  return {
    state: updateState(state, { presence: newPresence }),
    shouldNotifyPresence: true,
  };
};

const processPresenceSync = (
  state: AdapterState,
  payload: PresenceSyncPayload,
  syncCompleted: boolean,
): MessageProcessResult => {
  const newPresence = new Map<string, PresenceUser>();
  for (const user of payload.users) {
    newPresence.set(user.connectionId, user);
  }
  if (state.self !== null) {
    newPresence.set(state.self.connectionId, state.self);
  }
  return {
    state: updateState(state, { presence: newPresence }),
    shouldNotifyPresence: true,
    syncCompleted,
  };
};

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
 * Self-suppression uses connectionId (`senderId`), not userId, so multiple
 * tabs of the same account do not drop each other's frames.
 */
export const processMessage = (
  state: AdapterState,
  message: WebSocketMessage,
  selfConnectionId: string,
): MessageProcessResult => {
  if (message.senderId === selfConnectionId) {
    // Own heartbeat acks still need to be observed by the connection layer.
    if (message.type === WS_MESSAGE.HEARTBEAT_ACK) {
      const pingId = isHeartbeatPayload(message.payload)
        ? message.payload.pingId
        : undefined;
      return {
        state,
        shouldNotifyPresence: false,
        heartbeatAckPingId: pingId,
      };
    }
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
      // Liveness uses the receiver clock; message.timestamp remains for events.
      return processPresenceUpdate(state, message.payload, Date.now());
    }

    case WS_MESSAGE.PRESENCE_SYNC: {
      if (!isPresenceSyncPayload(message.payload)) {
        return {
          state,
          shouldNotifyPresence: false,
          error: new Error("Invalid PRESENCE_SYNC payload"),
        };
      }
      // Inbound sync requests must not mark the local connection ready.
      return processPresenceSync(state, message.payload, false);
    }

    case WS_MESSAGE.PRESENCE_SYNC_RESPONSE: {
      if (!isPresenceSyncPayload(message.payload)) {
        return {
          state,
          shouldNotifyPresence: false,
          error: new Error("Invalid PRESENCE_SYNC payload"),
        };
      }
      return processPresenceSync(state, message.payload, true);
    }

    case WS_MESSAGE.AUTH_OK: {
      if (
        state.connectionState !== "authenticating" ||
        message.senderId !== "server"
      ) {
        return { state, shouldNotifyPresence: false };
      }
      return { state, shouldNotifyPresence: false, authOk: true };
    }

    case WS_MESSAGE.AUTH_ERROR: {
      const payload = isRecord(message.payload) ? message.payload : null;
      const messageText =
        typeof payload?.message === "string"
          ? payload.message
          : "Authentication failed";
      return {
        state,
        shouldNotifyPresence: false,
        error: new Error(messageText),
        // Anything other than an explicit `true` fails closed, so a server
        // that does not send the flag keeps the original behaviour.
        authErrorRetryable: payload?.retryable === true,
      };
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

    case WS_MESSAGE.HEARTBEAT_ACK: {
      const pingId = isHeartbeatPayload(message.payload)
        ? message.payload.pingId
        : undefined;
      return {
        state,
        shouldNotifyPresence: false,
        heartbeatAckPingId: pingId,
      };
    }

    default:
      return { state, shouldNotifyPresence: false };
  }
};
