/**
 * Protocol v2 presence room logic for the playground WebSocket server.
 * Pure / testable — keyed by connectionId with clock ordering.
 */

export const PRESENCE_PROTOCOL_VERSION = 2 as const;

export type PresenceUser = {
  readonly connectionId: string;
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  readonly clock: number;
  readonly lastActivityAt?: number;
  readonly lastSeenAt?: number;
  readonly [key: string]: unknown;
};

export type PresenceMessage = {
  readonly type: string;
  readonly roomId: string;
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload?: unknown;
};

export type OutboundMessage = PresenceMessage;

export type PeerSession = {
  roomId?: string;
  connectionId?: string;
  userId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const parsePresenceMessage = (raw: string): PresenceMessage | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.type !== "string") return null;
    if (typeof parsed.roomId !== "string") return null;
    if (typeof parsed.senderId !== "string") return null;
    if (!isFiniteNumber(parsed.timestamp)) return null;
    return parsed as unknown as PresenceMessage;
  } catch {
    return null;
  }
};

const isPresenceUser = (value: unknown): value is PresenceUser => {
  if (!isRecord(value)) return false;
  return (
    typeof value.connectionId === "string" &&
    typeof value.userId === "string" &&
    typeof value.name === "string" &&
    typeof value.color === "string" &&
    isFiniteNumber(value.clock)
  );
};

export type PresenceRoomStore = {
  getUsers: (roomId: string) => ReadonlyMap<string, PresenceUser>;
  listUsers: (roomId: string) => ReadonlyArray<PresenceUser>;
  join: (roomId: string, user: PresenceUser) => PresenceUser;
  leave: (roomId: string, connectionId: string) => boolean;
  update: (
    roomId: string,
    connectionId: string,
    clock: number,
    updates: Record<string, unknown>,
  ) => PresenceUser | null;
  deleteRoomIfEmpty: (roomId: string) => void;
};

export const createPresenceRoomStore = (): PresenceRoomStore => {
  const rooms = new Map<string, Map<string, PresenceUser>>();

  const getOrCreate = (roomId: string): Map<string, PresenceUser> => {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const created = new Map<string, PresenceUser>();
    rooms.set(roomId, created);
    return created;
  };

  return {
    getUsers: (roomId) => rooms.get(roomId) ?? new Map(),

    listUsers: (roomId) => [...(rooms.get(roomId)?.values() ?? [])],

    join: (roomId, user) => {
      const users = getOrCreate(roomId);
      users.set(user.connectionId, user);
      return user;
    },

    leave: (roomId, connectionId) => {
      const users = rooms.get(roomId);
      if (!users?.has(connectionId)) return false;
      users.delete(connectionId);
      return true;
    },

    update: (roomId, connectionId, clock, updates) => {
      const users = rooms.get(roomId);
      const existing = users?.get(connectionId);
      if (!users || existing === undefined) return null;
      if (clock <= existing.clock) {
        // Stale clock: refresh lastSeenAt only when provided and valid.
        if (isFiniteNumber(updates.lastSeenAt)) {
          const touched: PresenceUser = {
            ...existing,
            lastSeenAt: Math.max(
              existing.lastSeenAt ?? 0,
              updates.lastSeenAt,
            ),
          };
          users.set(connectionId, touched);
          return touched;
        }
        return existing;
      }
      const next: PresenceUser = {
        ...existing,
        ...updates,
        connectionId: existing.connectionId,
        userId: existing.userId,
        clock,
      };
      users.set(connectionId, next);
      return next;
    },

    deleteRoomIfEmpty: (roomId) => {
      const users = rooms.get(roomId);
      if (users && users.size === 0) {
        rooms.delete(roomId);
      }
    },
  };
};

export type FrameHandlerResult = {
  readonly outbound: ReadonlyArray<OutboundMessage>;
  readonly publish: PresenceMessage | null;
  readonly session?: Partial<PeerSession>;
};

const serverMessage = (
  type: string,
  roomId: string,
  payload?: unknown,
): OutboundMessage => ({
  type,
  roomId,
  senderId: "server",
  timestamp: Date.now(),
  ...(payload !== undefined ? { payload } : {}),
});

/**
 * Handle one inbound presence frame. Pure aside from Date.now() timestamps.
 */
export const handlePresenceFrame = (
  store: PresenceRoomStore,
  roomId: string,
  parsed: PresenceMessage,
): FrameHandlerResult => {
  if (parsed.type === "auth") {
    if (!isRecord(parsed.payload)) {
      return { outbound: [], publish: null };
    }
    const tokenOk = typeof parsed.payload.token === "string";
    const versionOk = parsed.payload.protocolVersion === PRESENCE_PROTOCOL_VERSION;
    const connectionOk = typeof parsed.payload.connectionId === "string";
    const userOk = typeof parsed.payload.userId === "string";
    if (!tokenOk || !versionOk || !connectionOk || !userOk) {
      return {
        outbound: [
          serverMessage("auth_error", roomId, {
            message: "Invalid auth payload",
          }),
        ],
        publish: null,
      };
    }
    const connectionId = parsed.payload.connectionId as string;
    const userId = parsed.payload.userId as string;
    return {
      outbound: [serverMessage("auth_ok", roomId, { ok: true })],
      publish: null,
      session: {
        connectionId,
        userId,
      },
    };
  }

  if (parsed.roomId !== roomId) {
    return { outbound: [], publish: null };
  }

  switch (parsed.type) {
    case "join": {
      if (!isRecord(parsed.payload) || !isPresenceUser(parsed.payload.user)) {
        return { outbound: [], publish: null };
      }
      const user = parsed.payload.user;
      store.join(roomId, user);
      return {
        outbound: [
          serverMessage("presence:sync-response", roomId, {
            users: store.listUsers(roomId),
          }),
        ],
        publish: parsed,
        session: {
          connectionId: user.connectionId,
          userId: user.userId,
        },
      };
    }

    case "leave": {
      const connectionId =
        isRecord(parsed.payload) &&
        typeof parsed.payload.connectionId === "string"
          ? parsed.payload.connectionId
          : parsed.senderId;
      store.leave(roomId, connectionId);
      store.deleteRoomIfEmpty(roomId);
      return { outbound: [], publish: parsed };
    }

    case "presence:update": {
      if (!isRecord(parsed.payload)) {
        return { outbound: [], publish: null };
      }
      const connectionId =
        typeof parsed.payload.connectionId === "string"
          ? parsed.payload.connectionId
          : parsed.senderId;
      if (
        !isFiniteNumber(parsed.payload.clock) ||
        !isRecord(parsed.payload.updates)
      ) {
        return { outbound: [], publish: null };
      }
      const applied = store.update(
        roomId,
        connectionId,
        parsed.payload.clock,
        parsed.payload.updates,
      );
      if (applied === null) {
        return { outbound: [], publish: null };
      }
      return { outbound: [], publish: parsed };
    }

    case "presence:sync":
      return {
        outbound: [
          serverMessage("presence:sync-response", roomId, {
            users: store.listUsers(roomId),
          }),
        ],
        publish: null,
      };

    case "heartbeat": {
      const pingId =
        isRecord(parsed.payload) && typeof parsed.payload.pingId === "string"
          ? parsed.payload.pingId
          : undefined;
      return {
        outbound: [
          serverMessage(
            "heartbeat:ack",
            roomId,
            pingId !== undefined ? { pingId } : undefined,
          ),
        ],
        publish: null,
      };
    }

    default:
      return { outbound: [], publish: null };
  }
};

export const buildCloseLeaveMessage = (
  roomId: string,
  connectionId: string,
  userId: string,
): PresenceMessage => ({
  type: "leave",
  roomId,
  senderId: "server",
  timestamp: Date.now(),
  payload: { connectionId, userId },
});
