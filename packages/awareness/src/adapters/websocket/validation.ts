/**
 * Runtime type guards for WebSocket payloads.
 *
 * The WebSocket adapter receives untrusted JSON from a remote server. Casting
 * `message.payload` directly to a typed shape is unsafe — a malformed frame
 * (server bug, downgraded proxy, or a malicious actor on a same-origin WS
 * proxy) can otherwise crash consumers when downstream code accesses
 * properties that aren't there.
 *
 * These guards validate every inbound payload before it is forwarded to
 * presence-state update functions or surfaced as a `PresenceEvent`.
 */

import type {
  CursorPosition,
  PresenceUser,
  SelectionRange,
} from "../../types/presence";
import type {
  ErrorPayload,
  JoinPayload,
  LeavePayload,
  PresenceSyncPayload,
  PresenceUpdatePayload,
} from "./types";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCursorPosition = (value: unknown): value is CursorPosition =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  typeof value.offset === "number";

const isSelectionRange = (value: unknown): value is SelectionRange =>
  isRecord(value) &&
  typeof value.blockId === "string" &&
  typeof value.from === "number" &&
  typeof value.to === "number";

/**
 * `PresenceUser` requires `userId`, `name`, `color`, `status`, `lastActiveAt`.
 * Optional fields (`avatarUrl`, `cursor`, `selection`, `meta`) are validated
 * when present.
 */
export const isPresenceUser = (value: unknown): value is PresenceUser => {
  if (!isRecord(value)) return false;
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
  if (typeof value.lastActiveAt !== "number") return false;
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
    !isSelectionRange(value.selection)
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
  isRecord(payload) && typeof payload.userId === "string";

/**
 * `updates` is a partial `PresenceUser` (without `userId`). We only verify
 * each provided field has the right shape; absent fields are fine. `cursor`
 * and `selection` may be `null` on the wire (explicit clear) — we accept
 * both `null` and a valid shape.
 */
export const isPresenceUpdatePayload = (
  payload: unknown,
): payload is PresenceUpdatePayload => {
  if (!isRecord(payload)) return false;
  if (typeof payload.userId !== "string") return false;
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
    updates.lastActiveAt !== undefined &&
    typeof updates.lastActiveAt !== "number"
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
    !isSelectionRange(updates.selection)
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
