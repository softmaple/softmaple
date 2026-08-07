import { parsePresenceMessage, type PeerSession } from "./presence-room";

export const user = (
  connectionId: string,
  userId: string,
  clock = 0,
): Record<string, unknown> => ({
  connectionId,
  userId,
  name: userId,
  color: "#000",
  clock,
  lastActivityAt: 1,
  lastSeenAt: 1,
  status: "active",
});

export const frame = (
  type: string,
  payload?: unknown,
  senderId = "c1",
  roomId = "room-a",
): ReturnType<typeof parsePresenceMessage> =>
  parsePresenceMessage(
    JSON.stringify({
      type,
      roomId,
      senderId,
      timestamp: 1_000,
      payload,
    }),
  );

export const session = (overrides: Partial<PeerSession> = {}): PeerSession => ({
  roomId: "room-a",
  connectionId: "c1",
  userId: "ada",
  ...overrides,
});
