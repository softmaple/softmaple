import type { CollabCredential } from "@softmaple/collab-protocol";
import type { ConnectionLimiter, ConnectionPolicy } from "./connection-limiter";
import type { RoomLeaveReason } from "./document-room";
import type { PresenceCodec, PresenceRateLimitState } from "./presence-codec";
import type { PresenceFanout } from "./presence-fanout";
import type {
  PresenceIdentity,
  PresenceSession,
  PresenceSessionHooks,
} from "./presence-session";
import type { PresenceStore } from "./presence-store";

/** Transport adapter presented to runtime-independent presence room semantics. */
export interface PresencePeer {
  readonly id: string;
  close(code: number, reason: string): void | Promise<void>;
  /** Sends a codec-encoded frame; the room never inspects it. */
  send(frame: unknown): void | Promise<void>;
  /**
   * Called whenever persisted peer state changes (rate limit, joined,
   * authorization/heartbeat expiry). Hosts that do not hibernate may omit
   * this; a throwing implementation is reported but never changes room
   * behavior.
   */
  persist?(snapshot: PresencePeerSnapshot): void | Promise<void>;
}

/** Everything a hibernating transport must persist to survive eviction. */
export interface PresencePeerSnapshot {
  readonly authorizationExpiresAt: number;
  readonly connectionId: string;
  readonly credential: CollabCredential;
  readonly heartbeatExpiresAt: number;
  readonly identity: PresenceIdentity;
  readonly joined: boolean;
  readonly rateLimit: PresenceRateLimitState | null;
}

/** Server-owned session metadata restored by a hibernating transport host. */
export interface PresenceRoomResumeState {
  /** Preserved as-is; the room does not recompute it on resume. */
  readonly authorizationExpiresAt: number;
  readonly connectionId: string;
  readonly credential: CollabCredential;
  /** Preserved as-is; the room does not recompute it on resume. */
  readonly heartbeatExpiresAt: number;
  readonly identity: PresenceIdentity;
  readonly joined: boolean;
  readonly rateLimit: PresenceRateLimitState | null;
}

export const PRESENCE_ROOM_REFRESH_MODE = {
  Background: "background",
  OnMessage: "on-message",
} as const;

export type PresenceRoomRefreshMode =
  (typeof PRESENCE_ROOM_REFRESH_MODE)[keyof typeof PRESENCE_ROOM_REFRESH_MODE];

export interface PresenceRoomOptions {
  /** Background timers are the default; hibernating hosts refresh on messages. */
  readonly refreshMode?: PresenceRoomRefreshMode;
}

export interface PresenceRoomPolicy {
  /** Positive cadence for revalidating cached presence authorization. */
  readonly authorizationRefreshIntervalMs: number;
  readonly connection: ConnectionPolicy;
  /** Positive silence window before a peer is closed with 1001. */
  readonly heartbeatExpiryMs: number;
  /** Positive TTL applied to every stored member on Join/Heartbeat/Update. */
  readonly memberTtlMs: number;
}

export const DEFAULT_PRESENCE_ROOM_POLICY: PresenceRoomPolicy = Object.freeze({
  authorizationRefreshIntervalMs: 8_000,
  connection: Object.freeze({
    leaseRefreshIntervalMs: 15_000,
    leaseTtlMs: 30_000,
    maxConnectionsPerDocument: 100,
  }),
  heartbeatExpiryMs: 30_000,
  memberTtlMs: 30_000,
});

/** Infrastructure capabilities consumed by presence room semantics. */
export interface PresenceRoomServices {
  readonly codec: PresenceCodec;
  readonly connections: ConnectionLimiter;
  readonly fanout: PresenceFanout;
  readonly policy: PresenceRoomPolicy;
  /** Optional host observability; reporter failures are ignored by the room. */
  readonly reportError?: PresenceRoomErrorReporter;
  readonly sessions: PresenceSessionHooks;
  readonly store: PresenceStore;
}

export interface PresenceRoomErrorContext {
  readonly messageType?: string;
  readonly peerId?: string;
  readonly roomId: string;
}

export type PresenceRoomErrorReporter = (
  error: unknown,
  context: PresenceRoomErrorContext,
) => void;

/**
 * Runtime-independent presence state-machine boundary for one room.
 * Structurally mirrors `DocumentRoom` but owns no document convergence
 * state and shares no capability instance with it — a presence failure
 * structurally cannot block durable document convergence.
 *
 * Implementations receive raw inbound frame text; rate-limit consumption
 * runs before parsing, so a malformed frame still consumes quota. Leave and
 * close must tolerate partial setup and release room subscriptions,
 * sessions, and connection leases idempotently. Calls that affect the same
 * peer may arrive concurrently; the room synchronizes their state
 * transitions so receive/leave races cannot create duplicate sessions or
 * leak resources.
 *
 * An Auth frame is rejected before authorization unless its room id exactly
 * matches this room. Every session, store call, and fan-out delivery
 * remains scoped to the same room id; cross-room fan-out is never
 * delivered.
 */
export interface PresenceRoom {
  readonly roomId: string;
  join(peer: PresencePeer): Promise<void>;
  /**
   * Restores an already-established transport session without another wire
   * Auth or Auth-ok exchange. Access is always revalidated before resources
   * are reacquired. A null result means the peer was closed and cleaned up.
   */
  resume(
    peer: PresencePeer,
    state: PresenceRoomResumeState,
  ): Promise<PresenceSession | null>;
  receive(peer: PresencePeer, rawMessage: string): Promise<void>;
  leave(peer: PresencePeer, reason?: RoomLeaveReason): Promise<void>;
  close(): Promise<void>;
  /**
   * Closes peers past their heartbeat deadline and drains lapsed store
   * members into Leave broadcasts. Safe to call redundantly (idempotent) —
   * a `Background` host never needs to call it, an `OnMessage` host calls it
   * on every inbound frame, and a Durable Object alarm may call it directly
   * to drive liveness without a per-peer timer.
   */
  sweep(now?: number): Promise<void>;
}
