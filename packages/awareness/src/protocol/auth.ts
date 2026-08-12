/**
 * Auth and heartbeat wire payload parsing.
 */

import { isRecord, isShortString } from "./envelope";
import { PRESENCE_CAPABILITIES, PRESENCE_PROTOCOL_VERSION } from "./version";

export interface PresenceAuthPayload {
  readonly connectionId: string;
  readonly token: string;
  readonly userId: string;
}

export const parsePresenceAuth = (payload: unknown): PresenceAuthPayload => {
  if (
    !isRecord(payload) ||
    !isShortString(payload.token) ||
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
