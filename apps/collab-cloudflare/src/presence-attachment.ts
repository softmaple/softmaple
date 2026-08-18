import type { CollabCredential } from "@softmaple/collab-protocol";
import type {
  PresenceIdentity,
  PresencePeerSnapshot,
  PresenceRateLimitState,
  PresenceRoomResumeState,
} from "@softmaple/collab-runtime";
import { normalizeDocumentId } from "./document-id";

const ATTACHMENT_VERSION = 1 as const;
const PEER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PresenceWebSocketAttachmentBase {
  readonly peerId: string;
  readonly roomId: string;
  readonly version: typeof ATTACHMENT_VERSION;
}

export interface AwaitingAuthPresenceAttachment
  extends PresenceWebSocketAttachmentBase {
  /**
   * When the object accepted this socket. The authentication deadline is
   * derived from it (`auth-deadline.ts`), and it lives in the attachment
   * rather than in memory so a hibernation-woken object enforces the same
   * deadline a live one would.
   */
  readonly connectedAt: number;
  readonly phase: "awaiting-auth";
}

export interface AuthenticatedPresenceAttachment
  extends PresenceWebSocketAttachmentBase {
  readonly authorizationExpiresAt: number;
  readonly connectionId: string;
  readonly credential: CollabCredential;
  readonly heartbeatExpiresAt: number;
  readonly identity: PresenceIdentity;
  readonly joined: boolean;
  readonly phase: "authenticated";
  readonly rateLimit: PresenceRateLimitState;
}

export type PresenceWebSocketAttachment =
  | AwaitingAuthPresenceAttachment
  | AuthenticatedPresenceAttachment;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isShortString = (value: unknown, maxLength = 256): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maxLength;

const parseCredential = (value: unknown): CollabCredential | null => {
  if (!isRecord(value)) return null;
  if (value.kind === "access-token" && isShortString(value.token, 4_096)) {
    return { kind: "access-token", token: value.token };
  }
  return null;
};

const parseIdentity = (value: unknown): PresenceIdentity | null => {
  if (
    !isRecord(value) ||
    !isShortString(value.name, 4_096) ||
    !isShortString(value.userId)
  ) {
    return null;
  }
  if (value.avatarUrl !== undefined && !isShortString(value.avatarUrl, 4_096)) {
    return null;
  }
  return {
    name: value.name,
    userId: value.userId,
    ...(value.avatarUrl === undefined ? {} : { avatarUrl: value.avatarUrl }),
  };
};

/** Presence rooms share the document id space; identity is validated the same way. */
export const createAwaitingAuthAttachment = (
  roomId: string,
  now = Date.now(),
): AwaitingAuthPresenceAttachment => ({
  connectedAt: now,
  peerId: crypto.randomUUID(),
  phase: "awaiting-auth",
  roomId,
  version: ATTACHMENT_VERSION,
});

export const parsePresenceWebSocketAttachment = (
  value: unknown,
): PresenceWebSocketAttachment | null => {
  if (
    !isRecord(value) ||
    value.version !== ATTACHMENT_VERSION ||
    typeof value.roomId !== "string" ||
    normalizeDocumentId(value.roomId) !== value.roomId ||
    typeof value.peerId !== "string" ||
    !PEER_ID_PATTERN.test(value.peerId)
  ) {
    return null;
  }
  const base = {
    peerId: value.peerId,
    roomId: value.roomId,
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
    !isNonNegativeInteger(value.authorizationExpiresAt) ||
    !isNonNegativeInteger(value.heartbeatExpiresAt) ||
    typeof value.joined !== "boolean" ||
    !isShortString(value.connectionId)
  ) {
    return null;
  }
  const credential = parseCredential(value.credential);
  const identity = parseIdentity(value.identity);
  if (credential === null || identity === null) return null;
  return {
    ...base,
    authorizationExpiresAt: value.authorizationExpiresAt,
    connectionId: value.connectionId,
    credential,
    heartbeatExpiresAt: value.heartbeatExpiresAt,
    identity,
    joined: value.joined,
    phase: "authenticated",
    rateLimit: value.rateLimit ?? null,
  };
};

/**
 * Builds the attachment persisted after `PresenceRoom` calls
 * `PresencePeer.persist`. Every field in `PresencePeerSnapshot` is
 * server-resolved (identity/credential come from `PresenceSessionHooks`,
 * never from a raw client frame), so this never needs to fail.
 */
export const attachmentAfterSnapshot = (
  attachment: PresenceWebSocketAttachment,
  snapshot: PresencePeerSnapshot,
): AuthenticatedPresenceAttachment => ({
  authorizationExpiresAt: snapshot.authorizationExpiresAt,
  connectionId: snapshot.connectionId,
  credential: snapshot.credential,
  heartbeatExpiresAt: snapshot.heartbeatExpiresAt,
  identity: snapshot.identity,
  joined: snapshot.joined,
  peerId: attachment.peerId,
  phase: "authenticated",
  rateLimit: snapshot.rateLimit,
  roomId: attachment.roomId,
  version: ATTACHMENT_VERSION,
});

export const resumeStateFromAttachment = (
  attachment: AuthenticatedPresenceAttachment,
): PresenceRoomResumeState => ({
  connectionId: attachment.connectionId,
  credential: attachment.credential,
  heartbeatExpiresAt: attachment.heartbeatExpiresAt,
  identity: attachment.identity,
  joined: attachment.joined,
  rateLimit: attachment.rateLimit,
});
