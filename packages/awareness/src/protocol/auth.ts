/**
 * Auth and heartbeat wire payload parsing.
 */

import { ATTENTION_PROTOCOL_VERSION } from "../attention/negotiation";
import { isRecord, isShortString } from "./envelope";
import { PRESENCE_CAPABILITIES, PRESENCE_PROTOCOL_VERSION } from "./version";

/**
 * A credential is a JWT, not a wire identifier: a Supabase access token is
 * routinely ~1000 characters, so the shared 256 identifier bound would
 * reject every real session. Matches the credential bound already used by
 * the Cloudflare presence attachment parser.
 */
const MAX_PRESENCE_TOKEN_LENGTH = 4_096;

export interface PresenceAuthPayload {
  readonly connectionId: string;
  /**
   * Tab-scoped session id, present only for a client that speaks version 3.
   * Absent is a complete answer: that client simply has no shared attention.
   */
  readonly sessionId?: string;
  readonly token: string;
  readonly userId: string;
}

export const parsePresenceAuth = (payload: unknown): PresenceAuthPayload => {
  // Version 3 is additive: it keeps every version 2 capability and adds its
  // own. Accepting both here is what lets a room hold old and new clients at
  // once, which it will for as long as anyone has a tab open.
  const version = payload && isRecord(payload) ? payload.protocolVersion : null;
  if (
    !isRecord(payload) ||
    !isShortString(payload.token, MAX_PRESENCE_TOKEN_LENGTH) ||
    !isShortString(payload.connectionId) ||
    !isShortString(payload.userId) ||
    (version !== PRESENCE_PROTOCOL_VERSION &&
      version !== ATTENTION_PROTOCOL_VERSION) ||
    !isRecord(payload.capabilities)
  ) {
    throw new Error("invalid presence authentication");
  }
  for (const [capability, expected] of Object.entries(PRESENCE_CAPABILITIES)) {
    if (payload.capabilities[capability] !== expected) {
      throw new Error("unsupported presence capabilities");
    }
  }
  // A session id only means something from a client that claims version 3;
  // accepting one from a version 2 frame would invent a capability it does
  // not have.
  const sessionId =
    version === ATTENTION_PROTOCOL_VERSION && isShortString(payload.sessionId)
      ? payload.sessionId
      : undefined;
  return {
    connectionId: payload.connectionId,
    token: payload.token,
    userId: payload.userId,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
};

export const parsePresenceHeartbeatPingId = (payload: unknown): string => {
  if (
    !isRecord(payload) ||
    typeof payload.pingId !== "string" ||
    payload.pingId.length === 0 ||
    payload.pingId.length > 128
  ) {
    throw new Error("invalid presence heartbeat");
  }
  return payload.pingId;
};
