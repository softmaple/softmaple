/**
 * Protocol v2 presence room logic for the Collab WebSocket server.
 * Pure / testable — keyed by connectionId with clock ordering.
 *
 * Auth verifies tokens through `verifyToken` (Supabase JWT / isolated dev
 * bypass). State-changing frames require an authenticated session.
 */

export const PRESENCE_PROTOCOL_VERSION = 2 as const;

const MAX_ROOMS = 256;
const MAX_USERS_PER_ROOM = 64;
const MAX_UPDATE_BYTES = 8_192;

const ALLOWED_UPDATE_KEYS = new Set([
  "name",
  "color",
  "status",
  "avatarUrl",
  "cursor",
  "selection",
  "meta",
  "lastActivityAt",
  "lastSeenAt",
]);

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

export type PresenceRoomStoreOptions = {
  readonly maxRooms?: number;
  readonly maxUsersPerRoom?: number;
  readonly maxUpdateBytes?: number;
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

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

const isOptionalFiniteNumber = (value: unknown): boolean =>
  value === undefined || isFiniteNumber(value);

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

const isValidUpdateValue = (key: string, value: unknown): boolean => {
  switch (key) {
    case "name":
    case "color":
    case "status":
    case "avatarUrl":
      return typeof value === "string";
    case "lastActivityAt":
    case "lastSeenAt":
      return isFiniteNumber(value);
    case "cursor":
    case "selection":
    case "meta":
      return value === null || typeof value === "object";
    default:
      return false;
  }
};

const boundUpdates = (
  updates: Record<string, unknown>,
  maxBytes: number,
): Record<string, unknown> | null => {
  if (utf8ByteLength(JSON.stringify(updates)) > maxBytes) {
    return null;
  }
  const bounded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_UPDATE_KEYS.has(key)) continue;
    if (!isValidUpdateValue(key, value)) return null;
    bounded[key] = value;
  }
  // Ensure optional typed fields on PresenceUser stay well-typed after merge.
  if (!isOptionalString(bounded.name) || !isOptionalString(bounded.color)) {
    return null;
  }
  if (
    !isOptionalFiniteNumber(bounded.lastActivityAt) ||
    !isOptionalFiniteNumber(bounded.lastSeenAt)
  ) {
    return null;
  }
  return bounded;
};

/** Resolve wire lastSeenAt; reject future sender clocks. */
const resolveWireLastSeenAt = (
  wireSeen: unknown,
  receiveAt: number,
): number => {
  if (isFiniteNumber(wireSeen) && wireSeen <= receiveAt) {
    return wireSeen;
  }
  return receiveAt;
};

const mergeLastSeenAt = (
  existing: number | undefined,
  wireSeen: unknown,
  receiveAt: number,
): number =>
  Math.max(
    existing ?? 0,
    resolveWireLastSeenAt(wireSeen, receiveAt),
    receiveAt,
  );

export type PresenceUpdateResult = {
  readonly user: PresenceUser;
  readonly normalizedUpdates: Record<string, unknown>;
  readonly stale?: boolean;
};

export type PresenceRoomStore = {
  getUsers: (roomId: string) => ReadonlyMap<string, PresenceUser>;
  listUsers: (roomId: string) => ReadonlyArray<PresenceUser>;
  join: (roomId: string, user: PresenceUser) => PresenceUser | null;
  leave: (roomId: string, connectionId: string) => boolean;
  update: (
    roomId: string,
    connectionId: string,
    clock: number,
    updates: Record<string, unknown>,
    receiveAt?: number,
  ) => PresenceUpdateResult | null;
  deleteRoomIfEmpty: (roomId: string) => void;
  sweepEmptyRooms: () => void;
};

export const createPresenceRoomStore = (
  options: PresenceRoomStoreOptions = {},
): PresenceRoomStore => {
  const maxRooms = options.maxRooms ?? MAX_ROOMS;
  const maxUsersPerRoom = options.maxUsersPerRoom ?? MAX_USERS_PER_ROOM;
  const maxUpdateBytes = options.maxUpdateBytes ?? MAX_UPDATE_BYTES;
  const rooms = new Map<string, Map<string, PresenceUser>>();

  const getOrCreate = (roomId: string): Map<string, PresenceUser> | null => {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    if (rooms.size >= maxRooms) return null;
    const created = new Map<string, PresenceUser>();
    rooms.set(roomId, created);
    return created;
  };

  return {
    getUsers: (roomId) => rooms.get(roomId) ?? new Map(),

    listUsers: (roomId) => [...(rooms.get(roomId)?.values() ?? [])],

    join: (roomId, user) => {
      const users = getOrCreate(roomId);
      if (users === null) return null;
      if (users.size >= maxUsersPerRoom && !users.has(user.connectionId)) {
        return null;
      }
      users.set(user.connectionId, user);
      return user;
    },

    leave: (roomId, connectionId) => {
      const users = rooms.get(roomId);
      if (!users?.has(connectionId)) return false;
      users.delete(connectionId);
      return true;
    },

    update: (roomId, connectionId, clock, updates, receiveAt = Date.now()) => {
      const users = rooms.get(roomId);
      const existing = users?.get(connectionId);
      if (!users || existing === undefined) return null;

      const safeUpdates = boundUpdates(updates, maxUpdateBytes);
      if (safeUpdates === null) return null;

      if (clock <= existing.clock) {
        const touched: PresenceUser = {
          ...existing,
          lastSeenAt: mergeLastSeenAt(
            existing.lastSeenAt,
            safeUpdates.lastSeenAt,
            receiveAt,
          ),
        };
        users.set(connectionId, touched);
        // Stale clocks must not republish caller patches as canonical changes.
        return { user: touched, normalizedUpdates: {}, stale: true };
      }

      const { lastSeenAt: wireSeen, ...patch } = safeUpdates;
      const next: PresenceUser = {
        ...existing,
        ...patch,
        connectionId: existing.connectionId,
        userId: existing.userId,
        clock,
        lastSeenAt: mergeLastSeenAt(existing.lastSeenAt, wireSeen, receiveAt),
      };
      users.set(connectionId, next);
      const normalizedUpdates = {
        ...patch,
        ...(wireSeen !== undefined ? { lastSeenAt: next.lastSeenAt } : {}),
      };
      return { user: next, normalizedUpdates, stale: false };
    },

    deleteRoomIfEmpty: (roomId) => {
      const users = rooms.get(roomId);
      if (users && users.size === 0) {
        rooms.delete(roomId);
      }
    },

    sweepEmptyRooms: () => {
      for (const [roomId, users] of rooms) {
        if (users.size === 0) {
          rooms.delete(roomId);
        }
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

const sessionConnectionId = (session: PeerSession): string | undefined =>
  typeof session.connectionId === "string" && session.connectionId.length > 0
    ? session.connectionId
    : undefined;

export type PresenceTokenVerifier = (
  token: string,
  roomId: string,
) => Promise<{ userId: string } | null>;

export type HandlePresenceFrameOptions = {
  readonly verifyToken: PresenceTokenVerifier;
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

/**
 * Authenticated session whose connectionId is not owned by a different userId.
 */
const resolveAuthedIdentity = (
  store: PresenceRoomStore,
  roomId: string,
  session: PeerSession,
): { readonly connectionId: string; readonly userId: string } | null => {
  const connectionId = sessionConnectionId(session);
  const userId = session.userId;
  if (
    connectionId === undefined ||
    typeof userId !== "string" ||
    userId.length === 0
  ) {
    return null;
  }
  const existing = store.getUsers(roomId).get(connectionId);
  if (existing !== undefined && existing.userId !== userId) {
    return null;
  }
  return { connectionId, userId };
};

/**
 * Handle one inbound presence frame. Auth verifies tokens via `verifyToken`.
 */
export const handlePresenceFrame = async (
  store: PresenceRoomStore,
  roomId: string,
  parsed: PresenceMessage,
  session: PeerSession = {},
  options: HandlePresenceFrameOptions,
): Promise<FrameHandlerResult> => {
  if (parsed.type === "auth") {
    if (!isRecord(parsed.payload)) {
      return { outbound: [], publish: null };
    }
    const token =
      typeof parsed.payload.token === "string" ? parsed.payload.token : "";
    const versionOk =
      parsed.payload.protocolVersion === PRESENCE_PROTOCOL_VERSION;
    const connectionId =
      typeof parsed.payload.connectionId === "string"
        ? parsed.payload.connectionId
        : "";
    if (token.length === 0 || !versionOk || connectionId.length === 0) {
      return {
        outbound: [
          serverMessage("auth_error", roomId, {
            message: "Invalid auth payload",
          }),
        ],
        publish: null,
      };
    }

    let verified: { userId: string } | null;
    try {
      // Authorize room access before creating/updating the peer session.
      verified = await options.verifyToken(token, roomId);
    } catch {
      verified = null;
    }
    if (verified === null) {
      return {
        outbound: [
          serverMessage("auth_error", roomId, {
            message: "Invalid or unverifiable credentials",
          }),
        ],
        publish: null,
      };
    }

    const occupied = store.getUsers(roomId).get(connectionId);
    if (occupied !== undefined && occupied.userId !== verified.userId) {
      return {
        outbound: [
          serverMessage("auth_error", roomId, {
            message: "Connection ID already belongs to another user",
          }),
        ],
        publish: null,
      };
    }

    let publish: PresenceMessage | null = null;
    const previousConnectionId = sessionConnectionId(session);
    const previousUserId =
      typeof session.userId === "string" && session.userId.length > 0
        ? session.userId
        : undefined;
    const identityChanged =
      previousConnectionId !== undefined &&
      previousUserId !== undefined &&
      (previousConnectionId !== connectionId ||
        previousUserId !== verified.userId);
    if (identityChanged) {
      if (store.leave(roomId, previousConnectionId)) {
        publish = buildCloseLeaveMessage(
          roomId,
          previousConnectionId,
          previousUserId,
        );
        store.deleteRoomIfEmpty(roomId);
      }
    }

    return {
      outbound: [serverMessage("auth_ok", roomId, { ok: true, connectionId })],
      publish,
      session: {
        connectionId,
        userId: verified.userId,
      },
    };
  }

  if (parsed.roomId !== roomId) {
    return { outbound: [], publish: null };
  }

  switch (parsed.type) {
    case "join": {
      const identity = resolveAuthedIdentity(store, roomId, session);
      if (identity === null) {
        return { outbound: [], publish: null };
      }
      if (!isRecord(parsed.payload) || !isPresenceUser(parsed.payload.user)) {
        return { outbound: [], publish: null };
      }
      const user = parsed.payload.user;
      if (user.connectionId !== identity.connectionId) {
        return { outbound: [], publish: null };
      }
      if (user.userId !== identity.userId) {
        return { outbound: [], publish: null };
      }
      const joined = store.join(roomId, user);
      if (joined === null) {
        return { outbound: [], publish: null };
      }
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
      const identity = resolveAuthedIdentity(store, roomId, session);
      if (identity === null) {
        return { outbound: [], publish: null };
      }
      store.leave(roomId, identity.connectionId);
      store.deleteRoomIfEmpty(roomId);
      return {
        outbound: [],
        publish: {
          ...parsed,
          payload: {
            connectionId: identity.connectionId,
            userId: identity.userId,
          },
        },
      };
    }

    case "presence:update": {
      const identity = resolveAuthedIdentity(store, roomId, session);
      if (identity === null) {
        return { outbound: [], publish: null };
      }
      if (!isRecord(parsed.payload)) {
        return { outbound: [], publish: null };
      }
      if (
        !isFiniteNumber(parsed.payload.clock) ||
        !isRecord(parsed.payload.updates)
      ) {
        return { outbound: [], publish: null };
      }
      const applied = store.update(
        roomId,
        identity.connectionId,
        parsed.payload.clock,
        parsed.payload.updates,
      );
      if (applied === null || applied.stale) {
        return { outbound: [], publish: null };
      }
      return {
        outbound: [],
        publish: {
          ...parsed,
          payload: {
            connectionId: identity.connectionId,
            userId: identity.userId,
            clock: applied.user.clock,
            updates: applied.normalizedUpdates,
          },
        },
      };
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

export const startPresenceRoomMaintenance = (
  store: PresenceRoomStore,
  intervalMs = 60_000,
): (() => void) => {
  const timer = setInterval(() => {
    store.sweepEmptyRooms();
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
};
