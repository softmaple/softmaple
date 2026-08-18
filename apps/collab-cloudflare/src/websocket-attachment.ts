import {
  COLLAB_ACCESS_MODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  parseClientCollabMessage,
  parseServerCollabMessage,
  type AuthMessage,
  type CollabCredential,
  type LegacyAuthMessage,
  type LegacyReadyMessage,
  type ReadyMessage,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import type {
  DocumentRoomResumeState,
  DocumentSession,
} from "@softmaple/collab-runtime";
import { normalizeDocumentId } from "./document-id";

const ATTACHMENT_VERSION = 1 as const;
const PEER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MessageQuota {
  readonly count: number;
  readonly windowStartedAt: number;
}

interface WebSocketAttachmentBase {
  readonly documentId: string;
  readonly peerId: string;
  readonly quota: MessageQuota;
  readonly version: typeof ATTACHMENT_VERSION;
}

export interface AwaitingAuthWebSocketAttachment
  extends WebSocketAttachmentBase {
  /**
   * When the object accepted this socket. The authentication deadline is
   * derived from it (`auth-deadline.ts`), and it lives in the attachment
   * rather than in memory so a hibernation-woken object enforces the same
   * deadline a live one would.
   */
  readonly connectedAt: number;
  readonly phase: "awaiting-auth";
}

export interface AuthenticatedWebSocketAttachment
  extends WebSocketAttachmentBase {
  readonly auth: AuthMessage | LegacyAuthMessage;
  readonly phase: "authenticated";
  readonly ready: ReadyMessage | LegacyReadyMessage;
  readonly validatedAt: number;
}

export type DocumentWebSocketAttachment =
  | AwaitingAuthWebSocketAttachment
  | AuthenticatedWebSocketAttachment;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const parseQuota = (value: unknown): MessageQuota | null => {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.count) ||
    !isNonNegativeInteger(value.windowStartedAt)
  ) {
    return null;
  }
  return { count: value.count, windowStartedAt: value.windowStartedAt };
};

const parseAuth = (value: unknown): AuthMessage | LegacyAuthMessage | null => {
  try {
    const message = parseClientCollabMessage(value);
    return message.type === COLLAB_MESSAGE_TYPE.Auth ? message : null;
  } catch {
    return null;
  }
};

const parseReady = (
  value: unknown,
): LegacyReadyMessage | ReadyMessage | null => {
  try {
    const message = parseServerCollabMessage(value);
    return message.type === COLLAB_MESSAGE_TYPE.Ready ? message : null;
  } catch {
    return null;
  }
};

const hasConsistentIdentity = (
  documentId: string,
  auth: AuthMessage | LegacyAuthMessage,
  ready: LegacyReadyMessage | ReadyMessage,
): boolean => {
  if (
    auth.documentId !== documentId ||
    ready.documentId !== documentId ||
    auth.protocolVersion !== ready.protocolVersion
  ) {
    return false;
  }
  if (auth.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION) {
    return ready.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION;
  }
  if (ready.protocolVersion !== COLLAB_PROTOCOL_VERSION) return false;
  if (
    ready.accessMode === COLLAB_ACCESS_MODE.Authenticated &&
    (ready.userId === null || ready.role === null)
  ) {
    return false;
  }
  return auth.credential.kind === "public"
    ? ready.accessMode === COLLAB_ACCESS_MODE.Public
    : ready.accessMode === COLLAB_ACCESS_MODE.Authenticated;
};

export const createAwaitingAuthAttachment = (
  documentId: string,
  now = Date.now(),
): AwaitingAuthWebSocketAttachment => ({
  connectedAt: now,
  documentId,
  peerId: crypto.randomUUID(),
  phase: "awaiting-auth",
  quota: { count: 0, windowStartedAt: now },
  version: ATTACHMENT_VERSION,
});

export const parseDocumentWebSocketAttachment = (
  value: unknown,
): DocumentWebSocketAttachment | null => {
  if (
    !isRecord(value) ||
    value.version !== ATTACHMENT_VERSION ||
    typeof value.documentId !== "string" ||
    normalizeDocumentId(value.documentId) !== value.documentId ||
    typeof value.peerId !== "string" ||
    !PEER_ID_PATTERN.test(value.peerId)
  ) {
    return null;
  }
  const quota = parseQuota(value.quota);
  if (quota === null) return null;
  const base = {
    documentId: value.documentId,
    peerId: value.peerId,
    quota,
    version: ATTACHMENT_VERSION,
  } as const;
  if (value.phase === "awaiting-auth") {
    // A socket whose accepted-at instant is missing or malformed has no
    // enforceable authentication deadline, so it is rejected like any other
    // unreadable attachment and closed — which is what an unauthenticated
    // socket gets at its deadline anyway.
    return isNonNegativeInteger(value.connectedAt)
      ? { ...base, connectedAt: value.connectedAt, phase: "awaiting-auth" }
      : null;
  }
  if (
    value.phase !== "authenticated" ||
    !isNonNegativeInteger(value.validatedAt)
  ) {
    return null;
  }
  const auth = parseAuth(value.auth);
  const ready = parseReady(value.ready);
  if (
    auth === null ||
    ready === null ||
    !hasConsistentIdentity(value.documentId, auth, ready)
  ) {
    return null;
  }
  return {
    ...base,
    auth,
    phase: "authenticated",
    ready,
    validatedAt: value.validatedAt,
  };
};

const credentialFromAuth = (
  auth: AuthMessage | LegacyAuthMessage,
): CollabCredential =>
  auth.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
    ? { kind: "access-token", token: auth.accessToken }
    : auth.credential;

const sessionFromMessages = (
  auth: AuthMessage | LegacyAuthMessage,
  ready: LegacyReadyMessage | ReadyMessage,
): DocumentSession | null => {
  if (!hasConsistentIdentity(auth.documentId, auth, ready)) return null;
  if (
    auth.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION &&
    ready.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
  ) {
    return {
      accessMode: COLLAB_ACCESS_MODE.Authenticated,
      actorId: ready.userId,
      canWrite: ready.canWrite,
      documentId: auth.documentId,
      protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
      role: ready.role,
      sessionId: auth.sessionId,
    };
  }
  if (
    auth.protocolVersion !== COLLAB_PROTOCOL_VERSION ||
    ready.protocolVersion !== COLLAB_PROTOCOL_VERSION
  ) {
    return null;
  }
  if (ready.accessMode === COLLAB_ACCESS_MODE.Public) {
    return {
      accessMode: COLLAB_ACCESS_MODE.Public,
      actorId: null,
      canWrite: false,
      documentId: auth.documentId,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      role: null,
      sessionId: auth.sessionId,
    };
  }
  if (ready.userId === null || ready.role === null) return null;
  return {
    accessMode: COLLAB_ACCESS_MODE.Authenticated,
    actorId: ready.userId,
    canWrite: ready.canWrite,
    documentId: auth.documentId,
    protocolVersion: COLLAB_PROTOCOL_VERSION,
    role: ready.role,
    sessionId: auth.sessionId,
  };
};

export const resumeStateFromAttachment = (
  attachment: AuthenticatedWebSocketAttachment,
): DocumentRoomResumeState | null => {
  const session = sessionFromMessages(attachment.auth, attachment.ready);
  return session === null
    ? null
    : { credential: credentialFromAuth(attachment.auth), session };
};

const readyFromSession = (
  session: DocumentSession,
): LegacyReadyMessage | ReadyMessage => {
  if (session.protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION) {
    return {
      protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Ready,
      canWrite: session.canWrite,
      documentId: session.documentId,
      role: session.role,
      userId: session.actorId,
    };
  }
  return {
    protocolVersion: COLLAB_PROTOCOL_VERSION,
    type: COLLAB_MESSAGE_TYPE.Ready,
    accessMode: session.accessMode,
    canWrite: session.canWrite,
    documentId: session.documentId,
    role: session.role,
    userId: session.actorId,
  };
};

export const attachmentAfterReady = (
  attachment: DocumentWebSocketAttachment,
  auth: AuthMessage | LegacyAuthMessage,
  ready: LegacyReadyMessage | ReadyMessage,
  validatedAt: number,
): AuthenticatedWebSocketAttachment | null => {
  if (!hasConsistentIdentity(attachment.documentId, auth, ready)) return null;
  // Built field by field rather than spread: an authenticated socket has no
  // authentication deadline left to enforce, so `connectedAt` must not be
  // carried into (or persisted in) the authenticated attachment.
  return {
    auth,
    documentId: attachment.documentId,
    peerId: attachment.peerId,
    phase: "authenticated",
    quota: attachment.quota,
    ready,
    validatedAt,
    version: ATTACHMENT_VERSION,
  };
};

export const attachmentAfterResume = (
  attachment: AuthenticatedWebSocketAttachment,
  session: DocumentSession,
  validatedAt: number,
): AuthenticatedWebSocketAttachment | null => {
  const ready = readyFromSession(session);
  return hasConsistentIdentity(attachment.documentId, attachment.auth, ready)
    ? { ...attachment, ready, validatedAt }
    : null;
};

export const attachmentWithQuota = (
  attachment: DocumentWebSocketAttachment,
  quota: MessageQuota,
): DocumentWebSocketAttachment => ({ ...attachment, quota });

export const protocolVersionFromAttachment = (
  attachment: DocumentWebSocketAttachment,
): SupportedCollabProtocolVersion =>
  attachment.phase === "authenticated"
    ? attachment.ready.protocolVersion
    : COLLAB_PROTOCOL_VERSION;
