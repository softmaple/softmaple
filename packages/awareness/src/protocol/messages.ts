/**
 * WebSocket wire message shapes for the presence protocol.
 */

import type { PresenceUser, PresenceUserPatch } from "../types/presence";
import type {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
} from "./version";

export const WS_MESSAGE = {
  JOIN: "join",
  LEAVE: "leave",
  PRESENCE_UPDATE: "presence:update",
  PRESENCE_SYNC: "presence:sync",
  PRESENCE_SYNC_RESPONSE: "presence:sync-response",
  HEARTBEAT: "heartbeat",
  HEARTBEAT_ACK: "heartbeat:ack",
  AUTH: "auth",
  AUTH_OK: "auth_ok",
  AUTH_ERROR: "auth_error",
  ERROR: "error",
} as const;

export type WebSocketMessageType = (typeof WS_MESSAGE)[keyof typeof WS_MESSAGE];

/**
 * WebSocket message structure
 */
export interface WebSocketMessage {
  readonly type: WebSocketMessageType | (string & {});
  readonly roomId: string;
  /** connectionId of the sender */
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload?: unknown;
}

/**
 * Join message payload
 */
export interface JoinPayload {
  readonly user: PresenceUser;
}

/**
 * Leave message payload
 */
export interface LeavePayload {
  readonly connectionId: string;
  readonly userId: string;
}

/**
 * Presence update payload (wire)
 */
export interface PresenceUpdatePayload {
  readonly connectionId: string;
  readonly userId: string;
  readonly clock: number;
  readonly updates: PresenceUserPatch & {
    readonly lastActivityAt?: number;
    readonly lastSeenAt?: number;
  };
}

/**
 * Presence sync payload (server sends full state)
 */
export interface PresenceSyncPayload {
  readonly users: ReadonlyArray<PresenceUser>;
}

/**
 * Error payload
 */
export interface ErrorPayload {
  readonly code: string;
  readonly message: string;
}

/**
 * Heartbeat payload with ping correlation id
 */
export interface HeartbeatPayload {
  readonly pingId: string;
}

/**
 * Auth failure payload.
 *
 * `retryable` separates the two outcomes that used to share one message:
 * `false` means the room decided against this credential (membership
 * denied, malformed handshake) and reconnecting cannot change that;
 * `true` means the room never reached a decision because a dependency —
 * identity provider, lease store, persistence — was unavailable, so a
 * reconnect can still succeed. Servers predating the flag omit it, so an
 * absent value keeps the original fail-closed behaviour.
 */
export interface AuthErrorPayload {
  readonly message: string;
  readonly retryable?: boolean;
}

/**
 * Auth handshake payload
 */
export interface AuthPayload {
  readonly token: string;
  readonly protocolVersion: typeof PRESENCE_PROTOCOL_VERSION;
  readonly capabilities: typeof PRESENCE_CAPABILITIES;
  readonly connectionId: string;
  readonly userId: string;
}
