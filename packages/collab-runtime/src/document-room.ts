import type {
  ClientCollabMessage,
  CollabCredential,
  ServerCollabMessage,
} from "@softmaple/collab-protocol";
import type { ConnectionLimiter, ConnectionPolicy } from "./connection-limiter";
import type { DocumentSession, DocumentSessionHooks } from "./document-session";
import type { DocumentEventStore } from "./event-store";
import type { RoomFanout } from "./room-fanout";

/** Transport adapter presented to runtime-independent room semantics. */
export interface RoomPeer {
  readonly id: string;
  close(code: number, reason: string): void | Promise<void>;
  send(message: ServerCollabMessage): void | Promise<void>;
}

export const ROOM_LEAVE_REASON = {
  AccessRevoked: "access-revoked",
  ConnectionClosed: "connection-closed",
  RuntimeShutdown: "runtime-shutdown",
} as const;

export type RoomLeaveReason =
  (typeof ROOM_LEAVE_REASON)[keyof typeof ROOM_LEAVE_REASON];

export const DOCUMENT_ROOM_REFRESH_MODE = {
  Background: "background",
  OnMessage: "on-message",
} as const;

export type DocumentRoomRefreshMode =
  (typeof DOCUMENT_ROOM_REFRESH_MODE)[keyof typeof DOCUMENT_ROOM_REFRESH_MODE];

export interface DocumentRoomOptions {
  /** Background timers are the default; hibernating hosts refresh on messages. */
  readonly refreshMode?: DocumentRoomRefreshMode;
}

/** Server-owned session metadata restored by a hibernating transport host. */
export interface DocumentRoomResumeState {
  readonly credential: CollabCredential;
  readonly session: DocumentSession;
}

export interface DocumentRoomPolicy {
  /** Positive cadence for revalidating cached document access. */
  readonly authorizationRefreshIntervalMs: number;
  readonly connection: ConnectionPolicy;
}

export const DEFAULT_DOCUMENT_ROOM_POLICY: DocumentRoomPolicy = Object.freeze({
  authorizationRefreshIntervalMs: 15_000,
  connection: Object.freeze({
    leaseRefreshIntervalMs: 15_000,
    leaseTtlMs: 45_000,
    maxConnectionsPerDocument: 100,
  }),
});

/** Infrastructure capabilities consumed by room/session semantics. */
export interface DocumentRoomServices {
  readonly connections: ConnectionLimiter;
  readonly events: DocumentEventStore;
  readonly fanout: RoomFanout;
  readonly policy: DocumentRoomPolicy;
  /** Optional host observability; reporter failures are ignored by the room. */
  readonly reportError?: DocumentRoomErrorReporter;
  readonly sessions: DocumentSessionHooks;
}

export interface DocumentRoomErrorContext {
  readonly documentId: string;
  readonly messageType: string;
  readonly peerId?: string;
}

export type DocumentRoomErrorReporter = (
  error: unknown,
  context: DocumentRoomErrorContext,
) => void;

/**
 * Runtime-independent collaboration state-machine boundary for one document.
 *
 * Implementations receive already-parsed protocol messages. For Event
 * messages they must append durably, send DurableAck, and only then fan out
 * the committed batches. A failed append must never be acknowledged or
 * published. RepairRequest messages are served from durable event pages and
 * may interleave with committed live events; clients deduplicate by batch id.
 * Leave and close must tolerate partial setup and release room subscriptions,
 * sessions, and connection leases idempotently. Calls that affect the same
 * peer may arrive concurrently; the room synchronizes their state transitions
 * so receive/leave races cannot create duplicate sessions or leak resources.
 *
 * An Auth message is rejected before authorization unless its document id
 * exactly matches this room. Every session, event-store call, and fan-out
 * delivery remains scoped to the same document id; cross-document fan-out is
 * never delivered.
 */
export interface DocumentRoom {
  readonly documentId: string;
  join(peer: RoomPeer): Promise<void>;
  /**
   * Restores an already-established transport session without another wire Auth
   * or Ready exchange. Access is always revalidated before resources are
   * reacquired. A null result means the peer was closed and cleaned up.
   */
  resume(
    peer: RoomPeer,
    state: DocumentRoomResumeState,
  ): Promise<DocumentSession | null>;
  receive(peer: RoomPeer, message: ClientCollabMessage): Promise<void>;
  leave(peer: RoomPeer, reason?: RoomLeaveReason): Promise<void>;
  close(): Promise<void>;
}
