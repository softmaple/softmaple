/**
 * Presence member construction and clocked-patch application.
 */

import type { PresenceUser } from "../types/presence";
import { deterministicPresenceColor } from "./identity";
import type { PresencePatch } from "./patch";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPresenceStatus = (value: unknown): value is PresenceUser["status"] =>
  value === "active" || value === "idle" || value === "offline";

export const isPresenceUser = (value: unknown): value is PresenceUser =>
  isRecord(value) &&
  typeof value.connectionId === "string" &&
  typeof value.userId === "string" &&
  typeof value.name === "string" &&
  typeof value.color === "string" &&
  isPresenceStatus(value.status) &&
  typeof value.lastActivityAt === "number" &&
  Number.isFinite(value.lastActivityAt) &&
  typeof value.lastSeenAt === "number" &&
  Number.isFinite(value.lastSeenAt) &&
  typeof value.clock === "number";

/** Server-authoritative identity a host resolves before a member ever joins. */
export interface PresenceMemberIdentity {
  readonly avatarUrl?: string;
  readonly name: string;
  readonly userId: string;
}

export const createPresenceMember = (
  identity: PresenceMemberIdentity,
  connectionId: string,
  now: number,
): PresenceUser => ({
  connectionId,
  userId: identity.userId,
  name: identity.name,
  color: deterministicPresenceColor(identity.userId),
  status: "active",
  lastActivityAt: now,
  lastSeenAt: now,
  clock: 0,
  ...(identity.avatarUrl === undefined
    ? {}
    : { avatarUrl: identity.avatarUrl }),
});

const withoutCursor = (user: PresenceUser): PresenceUser => {
  const { cursor: _cursor, ...rest } = user;
  return rest;
};

const withoutSelection = (user: PresenceUser): PresenceUser => {
  const { selection: _selection, ...rest } = user;
  return rest;
};

export interface PresencePatchApplication {
  readonly member: PresenceUser;
  /** The wire-shaped partial published on the Update broadcast. */
  readonly updates: Record<string, unknown>;
}

export const applyPresencePatch = (
  current: PresenceUser,
  patch: PresencePatch,
  now: number,
): PresencePatchApplication => {
  const cursorBase =
    patch.hasCursor && patch.cursor === null ? withoutCursor(current) : current;
  const selectionBase =
    patch.hasSelection && patch.selection === null
      ? withoutSelection(cursorBase)
      : cursorBase;
  const member: PresenceUser = {
    ...selectionBase,
    ...(patch.cursor === null || patch.cursor === undefined
      ? {}
      : { cursor: patch.cursor }),
    ...(patch.selection === null || patch.selection === undefined
      ? {}
      : { selection: patch.selection }),
    ...(patch.isTyping === undefined
      ? {}
      : { meta: { isTyping: patch.isTyping } }),
    status: "active",
    clock: patch.clock,
    lastActivityAt: now,
    lastSeenAt: now,
  };
  const updates: Record<string, unknown> = {
    ...(patch.hasCursor ? { cursor: patch.cursor ?? null } : {}),
    ...(patch.hasSelection ? { selection: patch.selection ?? null } : {}),
    ...(patch.isTyping === undefined
      ? {}
      : { meta: { isTyping: patch.isTyping } }),
    lastActivityAt: now,
    lastSeenAt: now,
    status: "active",
  };
  return { member, updates };
};
