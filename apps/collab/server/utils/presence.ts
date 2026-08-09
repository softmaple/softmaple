import {
  normalizeCursorPosition,
  normalizePresenceSelection,
  type CursorPosition,
  type PresenceSelection,
} from "@softmaple/awareness";

export type PresenceEnvelope = {
  readonly payload?: unknown;
  readonly roomId: string;
  readonly senderId: string;
  readonly timestamp: number;
  readonly type: string;
};

export type PresenceRateLimit = {
  readonly count: number;
  readonly windowStartedAt: number;
};

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

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isShortString = (value: unknown, max = 256): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export const parsePresenceEnvelope = (value: unknown): PresenceEnvelope => {
  if (
    !isRecord(value) ||
    !isShortString(value.type, 64) ||
    !isShortString(value.roomId) ||
    !isShortString(value.senderId) ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp)
  ) {
    throw new Error("invalid presence envelope");
  }
  return {
    type: value.type,
    roomId: value.roomId,
    senderId: value.senderId,
    timestamp: value.timestamp,
    ...(value.payload === undefined ? {} : { payload: value.payload }),
  };
};

export const consumePresenceQuota = (
  current: PresenceRateLimit | null,
  now: number,
  maximum = 80,
  windowMs = 10_000,
): { readonly allowed: boolean; readonly state: PresenceRateLimit } => {
  if (current === null || now - current.windowStartedAt >= windowMs) {
    return { allowed: true, state: { count: 1, windowStartedAt: now } };
  }
  if (current.count >= maximum) return { allowed: false, state: current };
  return {
    allowed: true,
    state: { ...current, count: current.count + 1 },
  };
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

export const deterministicPresenceColor = (userId: string): string => {
  const colors = ["#e11d48", "#0f766e", "#c2410c", "#7c3aed", "#0369a1"];
  const hash = [...userId].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return colors[hash % colors.length] ?? colors[0] ?? "#e11d48";
};
