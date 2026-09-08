import type { CollabCredential } from "@softmaple/collab-protocol";
import type { PresenceIdentity } from "./presence-session";
import type { PresenceMemberRecord } from "./presence-store";

/**
 * Room-level classification of an inbound envelope. `classify` maps a
 * codec-owned wire type string (e.g. awareness's `WS_MESSAGE.*`) onto this
 * closed set; the room dispatches on it without ever reading the wire type.
 */
export const PRESENCE_MESSAGE = {
  /** A deliberate shared-attention act: invite, answer, follow, unfollow. */
  Attention: "attention",
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
  /** An attention command delivered to one addressed recipient. */
  Attention: "attention",
  /** What became of a command, returned to the session that sent it. */
  AttentionOutcome: "attention-outcome",
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
  /**
   * Client-claimed tab-scoped session id, absent for a client that does not
   * speak attention. The room binds it to the authenticated user and refuses a
   * claim on a session id another account already holds, so a session id can
   * never be used to receive somebody else's invitations.
   */
  readonly sessionId?: string;
  /** Client-claimed userId, verified against the resolved identity by `PresenceSessionHooks`. */
  readonly userId: string;
}

/**
 * The routing facts the room needs from an attention command.
 *
 * Everything else — the anchor, the note, the selection — stays codec-owned
 * and opaque, exactly like a presence patch. The room reads only what it needs
 * to decide *where a command goes and whether it may go there*.
 */
export interface PresenceAttentionCommand {
  /** Unique per command, so a duplicate delivery is detectable. */
  readonly id: string;
  /**
   * When the command stops being deliverable, or `null` for one that does not
   * expire. The room refuses an already-expired command rather than delivering
   * a stale gesture after a reconnect.
   */
  readonly expiresAt: number | null;
  /** Sessions this command is addressed to. Never empty. */
  readonly recipientSessionIds: ReadonlyArray<string>;
  /**
   * True when the command may only proceed if its target has opted into being
   * followed. Set for follow requests, clear for everything else.
   */
  readonly requiresPresenter: boolean;
  readonly senderSessionId: string;
  /** The session being followed, for presenter and cycle checks. */
  readonly targetSessionId: string | null;
}

/**
 * The attention-relevant projection of a stored member.
 *
 * Presenting and following live inside the codec-owned presence payload, but
 * the room has to consult them to enforce presenter opt-in and to refuse a
 * follow cycle. This is the narrowest window that allows it.
 */
export interface PresenceMemberAttention {
  readonly followingSessionId: string | null;
  readonly presenting: boolean;
  readonly sessionId: string | null;
}

/** Why the room refused to deliver a command. */
export const PRESENCE_ATTENTION_REFUSAL = {
  Cycle: "cycle",
  Duplicate: "duplicate",
  Expired: "expired",
  NoSuchSession: "no-such-session",
  NotPresenting: "not-presenting",
  RateLimited: "rate-limited",
  Unsupported: "unsupported",
} as const;

export type PresenceAttentionRefusal =
  (typeof PRESENCE_ATTENTION_REFUSAL)[keyof typeof PRESENCE_ATTENTION_REFUSAL];

/** What became of a command, encoded back to its sender. */
export type PresenceAttentionOutcome =
  | {
      readonly commandId: string;
      readonly deliveredToSessionIds: ReadonlyArray<string>;
      readonly status: "delivered";
    }
  | {
      readonly commandId: string;
      readonly reason: PresenceAttentionRefusal;
      readonly status: "refused";
    };

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
 * Throwing behavior:
 * - Parse methods (`parseEnvelope`, `parseAuth`, `parseHeartbeat`, `parsePatch`)
 *   and `classify` throw on invalid input; there is no null sentinel to check.
 * - `consumeQuota`, `createMember`, `applyPatch`, `encode`, and `isMember` are
 *   guaranteed not to throw under normal operation. The room guards `encode`
 *   calls on error-path flows where host failures are possible.
 */
export interface PresenceCodec {
  applyPatch(
    current: PresenceMemberRecord,
    patch: PresencePatch,
    now: number,
  ): PresencePatchApplication;
  /** Throws for a wire type the room does not understand. */
  classify(envelope: PresenceEnvelope): PresenceMessageKind;
  consumeQuota(
    current: PresenceRateLimitState | null,
    now: number,
  ): PresenceQuotaResult;
  createMember(
    identity: PresenceIdentity,
    connectionId: string,
    now: number,
  ): PresenceMemberRecord;
  encode(
    kind: PresenceFrameKind,
    roomId: string,
    senderId: string,
    payload: unknown,
  ): unknown;
  isMember(value: unknown): value is PresenceMemberRecord;
  parseAuth(payload: unknown): PresenceAuthPayload;
  parseEnvelope(value: unknown): PresenceEnvelope;
  /**
   * Reads the attention-relevant fields out of a stored member. Optional: a
   * codec that omits it does not support attention, and the room refuses
   * attention commands with `unsupported` rather than guessing.
   */
  memberAttention?(member: PresenceMemberRecord): PresenceMemberAttention;
  /** Throws on an invalid command. Optional, paired with `memberAttention`. */
  parseAttention?(payload: unknown): PresenceAttentionCommand;
  /** Returns the validated pingId. */
  parseHeartbeat(payload: unknown): string;
  parsePatch(payload: unknown): PresencePatch;
}
