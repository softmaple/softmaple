import {
  COLLAB_ACCESS_MODE,
  COLLAB_PROTOCOL_VERSION,
  type CollabCredential,
  type CollabRole,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";

/** Normalized authenticated access, including read-only viewer access. */
export interface AuthenticatedDocumentAccess {
  readonly accessMode: typeof COLLAB_ACCESS_MODE.Authenticated;
  readonly actorId: string;
  readonly canWrite: boolean;
  readonly role: CollabRole;
}

/** Public access is deliberately anonymous and read-only. */
export interface PublicDocumentAccess {
  readonly accessMode: typeof COLLAB_ACCESS_MODE.Public;
  readonly actorId: null;
  readonly canWrite: false;
  readonly role: null;
}

export type DocumentAccess = AuthenticatedDocumentAccess | PublicDocumentAccess;

interface DocumentSessionBase {
  readonly documentId: string;
  readonly sessionId: string;
}

export interface AuthenticatedDocumentSession
  extends AuthenticatedDocumentAccess,
    DocumentSessionBase {
  readonly protocolVersion: SupportedCollabProtocolVersion;
}

/** Legacy protocol clients cannot represent public sessions. */
export interface PublicDocumentSession
  extends PublicDocumentAccess,
    DocumentSessionBase {
  readonly protocolVersion: typeof COLLAB_PROTOCOL_VERSION;
}

export type DocumentSession =
  | AuthenticatedDocumentSession
  | PublicDocumentSession;

export interface DocumentSessionAuthorizationRequest {
  readonly credential: CollabCredential;
  readonly documentId: string;
  readonly peerId: string;
  readonly protocolVersion: SupportedCollabProtocolVersion;
  readonly sessionId: string;
}

export interface DocumentSessionRefreshRequest {
  readonly credential: CollabCredential;
  readonly peerId: string;
  readonly session: DocumentSession;
}

export const DOCUMENT_SESSION_END_REASON = {
  AccessRevoked: "access-revoked",
  PeerLeft: "peer-left",
  RoomClosed: "room-closed",
} as const;

export type DocumentSessionEndReason =
  (typeof DOCUMENT_SESSION_END_REASON)[keyof typeof DOCUMENT_SESSION_END_REASON];

/**
 * Host-provided identity hooks. Implementations may use any auth provider, but
 * room semantics only consume the normalized access returned here. Refresh
 * may change role/write access; changing access mode or actor revokes the
 * existing session.
 */
export interface DocumentSessionHooks {
  /** Returns null for denied access; throws when the provider is unavailable. */
  authorize(
    request: DocumentSessionAuthorizationRequest,
  ): Promise<DocumentAccess | null>;
  /** Returns null for revoked access; throws when the provider is unavailable. */
  refresh(
    request: DocumentSessionRefreshRequest,
  ): Promise<DocumentAccess | null>;
  end?(
    session: DocumentSession,
    reason: DocumentSessionEndReason,
  ): Promise<void>;
}
