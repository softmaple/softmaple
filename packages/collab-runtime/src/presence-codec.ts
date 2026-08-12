import type { CollabCredential } from "@softmaple/collab-protocol";
import type { PresenceIdentity } from "./presence-session";
import type { PresenceMemberRecord } from "./presence-store";

/**
 * Room-level classification of an inbound envelope. `classify` maps a
 * codec-owned wire type string (e.g. awareness's `WS_MESSAGE.*`) onto this
 * closed set; the room dispatches on it without ever reading the wire type.
 */
export const PRESENCE_MESSAGE = {
  Auth: "auth",
  Heartbeat: "heartbeat",
  Join: "join",
  Leave: "leave",
  Sync: "sync",
  Update: "update",
} as const;

export type PresenceMessageKind =
  (typeof PRESENCE_MESSAGE)[keyof typeof PRESENCE_MESSAGE];

/** Outbound frame kinds the room asks the codec to encode. */
export const PRESENCE_FRAME = {
  AuthError: "auth-error",
  AuthOk: "auth-ok",
  Error: "error",
  HeartbeatAck: "heartbeat-ack",
  Join: "join",
  Leave: "leave",
  SyncResponse: "sync-response",
  Update: "update",
} as const;

export type PresenceFrameKind =
  (typeof PRESENCE_FRAME)[keyof typeof PRESENCE_FRAME];

/** The generic wire envelope shell every presence frame shares. */
export interface PresenceEnvelope {
  readonly payload?: unknown;
  readonly roomId: string;
  readonly senderId: string;
  readonly type: string;
}

export interface PresenceAuthPayload {
  readonly connectionId: string;
  readonly credential: CollabCredential;
  /** Client-claimed userId, verified against the resolved identity by `PresenceSessionHooks`. */
  readonly userId: string;
}

/**
 * Room-visible identity fields of an inbound update. Cursor, selection,
 * `meta`, and any other patch payload remain codec-owned and opaque; the
 * room passes the parsed value straight through to `applyPatch`.
 */
export interface PresencePatch {
  readonly clock: number;
  readonly connectionId: string;
  readonly userId: string;
}

export interface PresencePatchApplication {
  /** The codec-owned partial object published on the wire Update frame. */
  readonly broadcastPayload: unknown;
  readonly member: PresenceMemberRecord;
}

/** Opaque rate-limit bookkeeping the room stores and replays but never reads. */
export type PresenceRateLimitState = unknown;

export interface PresenceQuotaResult {
  readonly allowed: boolean;
  readonly state: PresenceRateLimitState;
}

/**
 * The seam that keeps `PresenceRoom` payload-opaque. Wire type strings,
 * capability negotiation, and every presence payload shape (cursor,
 * selection, name, color, activity/liveness timestamps) live behind this
 * interface; `collab-runtime` never imports awareness.
 *
 * **Throwing contract:** `parseEnvelope`, `parseAuth`, `parseHeartbeat`,
 * `parsePatch`, and `classify` throw on invalid input; there is no null
 * sentinel to check. `applyPatch`, `consumeQuota`, `createMember`, `encode`,
 * and `isMember` must not throw — they are pure transforms/validators the
 * room calls outside parse-specific `try` blocks (including `consumeQuota`
 * on every inbound frame and `encode` on error responses).
 */
export interface PresenceCodec {
  /** Must not throw; returns the patched member and broadcast payload. */
  applyPatch(
    current: PresenceMemberRecord,
    patch: PresencePatch,
    now: number,
  ): PresencePatchApplication;
  /** Throws for a wire type the room does not understand. */
  classify(envelope: PresenceEnvelope): PresenceMessageKind;
  /** Must not throw; returns the next rate-limit state and allowance. */
  consumeQuota(
    current: PresenceRateLimitState | null,
    now: number,
  ): PresenceQuotaResult;
  /** Must not throw; materializes a new stored member from identity. */
  createMember(
    identity: PresenceIdentity,
    connectionId: string,
    now: number,
  ): PresenceMemberRecord;
  /** Must not throw; encodes an outbound frame for the transport. */
  encode(
    kind: PresenceFrameKind,
    roomId: string,
    senderId: string,
    payload: unknown,
  ): unknown;
  /** Must not throw; narrows an opaque stored value. */
  isMember(value: unknown): value is PresenceMemberRecord;
  parseAuth(payload: unknown): PresenceAuthPayload;
  parseEnvelope(value: unknown): PresenceEnvelope;
  /** Returns the validated pingId. */
  parseHeartbeat(payload: unknown): string;
  parsePatch(payload: unknown): PresencePatch;
}
