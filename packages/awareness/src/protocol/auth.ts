/**
 * Auth and heartbeat wire payload parsing.
 */

import {
  type AttentionProtocolContext,
  parseAttentionContext,
} from "./attention";
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
  readonly protocolContext?: AttentionProtocolContext;
  readonly connectionId: string;
  readonly token: string;
  readonly userId: string;
}

export const parsePresenceAuth = (payload: unknown): PresenceAuthPayload => {
  if (
    !isRecord(payload) ||
    !isShortString(payload.token, MAX_PRESENCE_TOKEN_LENGTH) ||
    !isShortString(payload.connectionId) ||
    !isShortString(payload.userId) ||
    payload.protocolVersion !== PRESENCE_PROTOCOL_VERSION ||
    !isRecord(payload.capabilities)
  ) {
    throw new Error("invalid presence authentication");
  }
  for (const [capability, expected] of Object.entries(PRESENCE_CAPABILITIES)) {
    if (payload.capabilities[capability] !== expected) {
      throw new Error("unsupported presence capabilities");
    }
  }
  return {
    ...(parseAttentionContext(payload.extensions) === undefined
      ? {}
      : { protocolContext: parseAttentionContext(payload.extensions) }),
    connectionId: payload.connectionId,
    token: payload.token,
    userId: payload.userId,
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
