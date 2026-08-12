/**
 * Wire-level presence update patch parsing.
 */

import {
  type CursorPosition,
  normalizeCursorPosition,
  normalizePresenceSelection,
  type PresenceSelection,
} from "../types/presence";
import { isRecord, isShortString } from "./envelope";

export type PresencePatch = {
  readonly clock: number;
  readonly connectionId: string;
  readonly cursor?: CursorPosition | null;
  readonly hasCursor: boolean;
  readonly hasSelection: boolean;
  readonly isTyping?: boolean;
  readonly selection?: PresenceSelection | null;
  readonly userId: string;
};

export const parsePresencePatch = (payload: unknown): PresencePatch => {
  if (
    !isRecord(payload) ||
    !isShortString(payload.connectionId) ||
    !isShortString(payload.userId) ||
    !Number.isSafeInteger(payload.clock) ||
    (payload.clock as number) < 1 ||
    !isRecord(payload.updates)
  ) {
    throw new Error("invalid presence update");
  }
  const updates = payload.updates;
  const hasCursor = Object.hasOwn(updates, "cursor");
  const hasSelection = Object.hasOwn(updates, "selection");
  const cursor =
    !hasCursor || updates.cursor === null
      ? updates.cursor === null
        ? null
        : undefined
      : normalizeCursorPosition(updates.cursor);
  const selection =
    !hasSelection || updates.selection === null
      ? updates.selection === null
        ? null
        : undefined
      : normalizePresenceSelection(updates.selection);
  if (
    (hasCursor && cursor === undefined) ||
    (hasSelection && selection === undefined)
  ) {
    throw new Error("invalid presence position");
  }
  const meta = updates.meta;
  if (
    meta !== undefined &&
    (!isRecord(meta) ||
      (meta.isTyping !== undefined && typeof meta.isTyping !== "boolean"))
  ) {
    throw new Error("invalid presence metadata");
  }
  return {
    clock: payload.clock as number,
    connectionId: payload.connectionId,
    hasCursor,
    hasSelection,
    userId: payload.userId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(selection === undefined ? {} : { selection }),
    ...(isRecord(meta) && typeof meta.isTyping === "boolean"
      ? { isTyping: meta.isTyping }
      : {}),
  };
};
