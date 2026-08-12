import type { CollabCredential } from "@softmaple/collab-protocol";

/** Server-authoritative presence identity. Never re-derived from a client frame. */
export interface PresenceIdentity {
  readonly avatarUrl?: string;
  readonly name: string;
  readonly userId: string;
}

export interface PresenceSession {
  readonly connectionId: string;
  readonly identity: PresenceIdentity;
  readonly roomId: string;
}

export interface PresenceSessionAuthorizationRequest {
  readonly connectionId: string;
  readonly credential: CollabCredential;
  readonly roomId: string;
  /** Client-claimed userId; the hook must reject a mismatch against the resolved identity. */
  readonly userId: string;
}

export interface PresenceSessionRefreshRequest {
  readonly connectionId: string;
  readonly credential: CollabCredential;
  readonly session: PresenceSession;
}

export const PRESENCE_SESSION_END_REASON = {
  AccessRevoked: "access-revoked",
  PeerLeft: "peer-left",
  RoomClosed: "room-closed",
} as const;

export type PresenceSessionEndReason =
  (typeof PRESENCE_SESSION_END_REASON)[keyof typeof PRESENCE_SESSION_END_REASON];

/**
 * Host-provided presence identity hooks. Presence is authenticated-only —
 * there is no public-access path. Implementations may use any auth
 * provider, but room semantics only consume the normalized identity
 * returned here.
 */
export interface PresenceSessionHooks {
  /** Returns null for denied access; throws when the provider is unavailable. */
  authorize(
    request: PresenceSessionAuthorizationRequest,
  ): Promise<PresenceIdentity | null>;
  /** Returns null for revoked access; throws when the provider is unavailable. */
  refresh(
    request: PresenceSessionRefreshRequest,
  ): Promise<PresenceIdentity | null>;
  end?(
    session: PresenceSession,
    reason: PresenceSessionEndReason,
  ): Promise<void>;
}
