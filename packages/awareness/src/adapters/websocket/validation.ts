/**
 * Runtime type guards for WebSocket payloads.
 */

import type { PresenceUser } from "../../types/presence";
import { isCursorPosition, isPresenceSelection } from "../../types/presence";
import type {
  AuthPayload,
  ErrorPayload,
  HeartbeatPayload,
  JoinPayload,
  LeavePayload,
  PresenceSyncPayload,
  PresenceUpdatePayload,
} from "./types";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `PresenceUser` requires identity, status, activity/liveness clocks, and clock.
 */
export const isPresenceUser = (value: unknown): value is PresenceUser => {
  if (!isRecord(value)) return false;
  if (typeof value.connectionId !== "string") return false;
  if (typeof value.userId !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.color !== "string") return false;
  if (
    value.status !== "active" &&
    value.status !== "idle" &&
    value.status !== "offline"
  ) {
    return false;
  }
  if (typeof value.lastActivityAt !== "number") return false;
  if (typeof value.lastSeenAt !== "number") return false;
  if (typeof value.clock !== "number") return false;
  if (value.avatarUrl !== undefined && typeof value.avatarUrl !== "string") {
    return false;
  }
  if (
    value.cursor !== undefined &&
    value.cursor !== null &&
    !isCursorPosition(value.cursor)
  ) {
    return false;
  }
  if (
    value.selection !== undefined &&
    value.selection !== null &&
    !isPresenceSelection(value.selection)
  ) {
    return false;
  }
  if (
    value.meta !== undefined &&
    value.meta !== null &&
    !isRecord(value.meta)
  ) {
    return false;
  }
  return true;
};

export const isJoinPayload = (payload: unknown): payload is JoinPayload =>
  isRecord(payload) && isPresenceUser(payload.user);

export const isLeavePayload = (payload: unknown): payload is LeavePayload =>
  isRecord(payload) &&
  typeof payload.connectionId === "string" &&
  typeof payload.userId === "string";

export const isPresenceUpdatePayload = (
  payload: unknown,
): payload is PresenceUpdatePayload => {
  if (!isRecord(payload)) return false;
  if (typeof payload.connectionId !== "string") return false;
  if (typeof payload.userId !== "string") return false;
  if (typeof payload.clock !== "number") return false;
  if (!isRecord(payload.updates)) return false;

  const updates = payload.updates;
  if (updates.name !== undefined && typeof updates.name !== "string") {
    return false;
  }
  if (updates.color !== undefined && typeof updates.color !== "string") {
    return false;
  }
  if (
    updates.avatarUrl !== undefined &&
    typeof updates.avatarUrl !== "string"
  ) {
    return false;
  }
  if (
    updates.status !== undefined &&
    updates.status !== "active" &&
    updates.status !== "idle" &&
    updates.status !== "offline"
  ) {
    return false;
  }
  if (
    updates.lastActivityAt !== undefined &&
    typeof updates.lastActivityAt !== "number"
  ) {
    return false;
  }
  if (
    updates.lastSeenAt !== undefined &&
    typeof updates.lastSeenAt !== "number"
  ) {
    return false;
  }
  if (
    updates.cursor !== undefined &&
    updates.cursor !== null &&
    !isCursorPosition(updates.cursor)
  ) {
    return false;
  }
  if (
    updates.selection !== undefined &&
    updates.selection !== null &&
    !isPresenceSelection(updates.selection)
  ) {
    return false;
  }
  if (
    updates.meta !== undefined &&
    updates.meta !== null &&
    !isRecord(updates.meta)
  ) {
    return false;
  }
  return true;
};

export const isPresenceSyncPayload = (
  payload: unknown,
): payload is PresenceSyncPayload =>
  isRecord(payload) &&
  Array.isArray(payload.users) &&
  payload.users.every(isPresenceUser);

export const isErrorPayload = (payload: unknown): payload is ErrorPayload =>
  isRecord(payload) &&
  typeof payload.code === "string" &&
  typeof payload.message === "string";

export const isHeartbeatPayload = (
  payload: unknown,
): payload is HeartbeatPayload =>
  isRecord(payload) && typeof payload.pingId === "string";

export const isAuthPayload = (payload: unknown): payload is AuthPayload =>
  isRecord(payload) &&
  typeof payload.token === "string" &&
  typeof payload.connectionId === "string" &&
  typeof payload.userId === "string";
