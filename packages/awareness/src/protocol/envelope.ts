/**
 * Generic wire envelope shell shared by every presence frame.
 */

export type PresenceEnvelope = {
  readonly payload?: unknown;
  readonly roomId: string;
  readonly senderId: string;
  readonly timestamp: number;
  readonly type: string;
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
