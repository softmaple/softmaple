import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
  type PresenceUser,
} from "@softmaple/awareness";
import {
  WS_MESSAGE,
  type WebSocketMessage,
} from "@softmaple/awareness/adapters/websocket";
import { defineWebSocketHandler } from "nitro";
import { COLLAB_ACCESS_MODE } from "@softmaple/collab-protocol";
import { authorizeDocument } from "../utils/auth";
import { authenticateGatewayUpgrade } from "../utils/gateway-auth";
import { prisma } from "../utils/prisma";
import {
  consumePresenceQuota,
  deterministicPresenceColor,
  isRecord,
  parsePresenceEnvelope,
  parsePresencePatch,
  type PresenceRateLimit,
} from "../utils/presence";

const MAX_FRAME_BYTES = 64 * 1024;
const MAX_ROOM_CONNECTIONS = 100;
const AUTHORIZATION_TTL_MS = 8_000;
const HEARTBEAT_EXPIRY_MS = 30_000;
const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rooms = new Map<string, Map<string, PresenceUser>>();
const roomConnections = new Map<string, Set<string>>();

const topicForRoom = (roomId: string): string => `presence:v2:${roomId}`;

const serverMessage = (
  type: string,
  roomId: string,
  senderId: string,
  payload?: unknown,
): WebSocketMessage => ({
  type,
  roomId,
  senderId,
  timestamp: Date.now(),
  ...(payload === undefined ? {} : { payload }),
});

const contextString = (
  context: Record<string, unknown>,
  key: string,
): string | null => {
  const value = context[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const presenceRateLimit = (
  context: Record<string, unknown>,
): PresenceRateLimit | null => {
  const value = context.presenceRateLimit;
  if (
    !isRecord(value) ||
    typeof value.count !== "number" ||
    typeof value.windowStartedAt !== "number"
  ) {
    return null;
  }
  return { count: value.count, windowStartedAt: value.windowStartedAt };
};

const readAuthPayload = (
  payload: unknown,
): {
  readonly connectionId: string;
  readonly token: string;
  readonly userId: string;
} => {
  if (
    !isRecord(payload) ||
    typeof payload.token !== "string" ||
    payload.token.length === 0 ||
    typeof payload.connectionId !== "string" ||
    payload.connectionId.length === 0 ||
    payload.connectionId.length > 256 ||
    typeof payload.userId !== "string" ||
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

const readHeartbeatPingId = (payload: unknown): string | null =>
  isRecord(payload) &&
  typeof payload.pingId === "string" &&
  payload.pingId.length > 0 &&
  payload.pingId.length <= 128
    ? payload.pingId
    : null;

const withoutCursor = (user: PresenceUser): PresenceUser => {
  const { cursor: _cursor, ...rest } = user;
  return rest;
};

const withoutSelection = (user: PresenceUser): PresenceUser => {
  const { selection: _selection, ...rest } = user;
  return rest;
};

export default defineWebSocketHandler({
  upgrade(request) {
    const gatewayContext = authenticateGatewayUpgrade(request);
    const roomId = new URL(request.url).searchParams.get("roomId");
    if (roomId === null || !DOCUMENT_ID_PATTERN.test(roomId)) {
      throw new Response("Invalid presence room", { status: 400 });
    }
    return {
      namespace: "softmaple-presence-v2",
      context: { ...gatewayContext, roomId },
    };
  },

  async message(peer, rawMessage) {
    const rawText = rawMessage.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_FRAME_BYTES) {
      peer.close(1009, "Presence frame is too large");
      return;
    }
    const quota = consumePresenceQuota(
      presenceRateLimit(peer.context),
      Date.now(),
    );
    peer.context.presenceRateLimit = quota.state;
    if (!quota.allowed) {
      peer.close(1013, "Presence rate limit exceeded");
      return;
    }

    let message;
    try {
      message = parsePresenceEnvelope(JSON.parse(rawText));
    } catch {
      peer.send(
        serverMessage(WS_MESSAGE.ERROR, "unknown", "server", {
          code: "invalid-message",
          message: "The presence message is invalid",
        }),
      );
      return;
    }

    const roomId = contextString(peer.context, "roomId");
    if (roomId === null || message.roomId !== roomId) {
      peer.close(1008, "Presence room mismatch");
      return;
    }

    const authenticatedUserId = contextString(peer.context, "userId");
    if (message.type === WS_MESSAGE.AUTH) {
      if (authenticatedUserId !== null) {
        peer.close(1008, "Presence is already authenticated");
        return;
      }
      try {
        const auth = readAuthPayload(message.payload);
        if (message.senderId !== auth.connectionId) {
          throw new Error("presence sender mismatch");
        }
        const access = await authorizeDocument(
          { kind: "access-token", token: auth.token },
          roomId,
        );
        if (
          access === null ||
          access.accessMode !== COLLAB_ACCESS_MODE.Authenticated ||
          access.userId !== auth.userId
        ) {
          throw new Error("presence membership denied");
        }
        const profile = await prisma.user.findUnique({
          where: { id: access.userId },
          select: { avatar_src: true, full_name: true },
        });
        if (profile === null) throw new Error("presence profile missing");

        const connections = roomConnections.get(roomId) ?? new Set<string>();
        if (
          connections.size >= MAX_ROOM_CONNECTIONS ||
          connections.has(auth.connectionId)
        ) {
          peer.close(1013, "Presence room is full or duplicated");
          return;
        }
        connections.add(auth.connectionId);
        roomConnections.set(roomId, connections);
        peer.context.userId = access.userId;
        peer.context.connectionId = auth.connectionId;
        peer.context.accessToken = auth.token;
        peer.context.authorizationExpiresAt = Date.now() + AUTHORIZATION_TTL_MS;
        peer.context.profileName =
          profile.full_name?.trim() || "Workspace member";
        peer.context.profileAvatar = profile.avatar_src;
        peer.send(serverMessage(WS_MESSAGE.AUTH_OK, roomId, "server", {}));
      } catch {
        peer.send(
          serverMessage(WS_MESSAGE.AUTH_ERROR, roomId, "server", {
            message: "Authentication or document membership failed",
          }),
        );
        peer.close(1008, "Unauthorized");
      }
      return;
    }

    const connectionId = contextString(peer.context, "connectionId");
    const accessToken = contextString(peer.context, "accessToken");
    if (
      authenticatedUserId === null ||
      connectionId === null ||
      accessToken === null ||
      message.senderId !== connectionId
    ) {
      peer.close(1008, "Authenticate presence first");
      return;
    }

    const expiresAt = peer.context.authorizationExpiresAt;
    if (typeof expiresAt !== "number" || expiresAt <= Date.now()) {
      const access = await authorizeDocument(
        { kind: "access-token", token: accessToken },
        roomId,
      );
      if (
        access === null ||
        access.accessMode !== COLLAB_ACCESS_MODE.Authenticated ||
        access.userId !== authenticatedUserId
      ) {
        peer.close(1008, "Workspace membership was revoked");
        return;
      }
      peer.context.authorizationExpiresAt = Date.now() + AUTHORIZATION_TTL_MS;
    }

    const existingTimer = peer.context.heartbeatExpiryTimer;
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer as ReturnType<typeof setTimeout>);
    }
    peer.context.heartbeatExpiryTimer = setTimeout(
      () => peer.close(1001, "Presence heartbeat expired"),
      HEARTBEAT_EXPIRY_MS,
    );

    if (message.type === WS_MESSAGE.JOIN) {
      if (peer.context.joined === true) {
        peer.close(1008, "Presence already joined");
        return;
      }
      const now = Date.now();
      const user: PresenceUser = {
        connectionId,
        userId: authenticatedUserId,
        name: contextString(peer.context, "profileName") ?? "Workspace member",
        color: deterministicPresenceColor(authenticatedUserId),
        status: "active",
        lastActivityAt: now,
        lastSeenAt: now,
        clock: 0,
        ...(contextString(peer.context, "profileAvatar") === null
          ? {}
          : {
              avatarUrl:
                contextString(peer.context, "profileAvatar") ?? undefined,
            }),
      };
      const room = rooms.get(roomId) ?? new Map<string, PresenceUser>();
      room.set(connectionId, user);
      rooms.set(roomId, room);
      peer.context.joined = true;
      peer.subscribe(topicForRoom(roomId));
      peer.publish(
        topicForRoom(roomId),
        serverMessage(WS_MESSAGE.JOIN, roomId, connectionId, { user }),
      );
      return;
    }

    if (message.type === WS_MESSAGE.PRESENCE_SYNC) {
      const users = [...(rooms.get(roomId)?.values() ?? [])];
      peer.send(
        serverMessage(WS_MESSAGE.PRESENCE_SYNC_RESPONSE, roomId, "server", {
          users,
        }),
      );
      return;
    }

    if (message.type === WS_MESSAGE.HEARTBEAT) {
      const pingId = readHeartbeatPingId(message.payload);
      if (pingId === null) {
        peer.close(1008, "Invalid presence heartbeat");
        return;
      }
      peer.send(
        serverMessage(WS_MESSAGE.HEARTBEAT_ACK, roomId, connectionId, {
          pingId,
        }),
      );
      return;
    }

    if (message.type === WS_MESSAGE.PRESENCE_UPDATE) {
      const room = rooms.get(roomId);
      const current = room?.get(connectionId);
      if (room === undefined || current === undefined) {
        peer.close(1008, "Join presence before updating");
        return;
      }
      try {
        const patch = parsePresencePatch(message.payload);
        if (
          patch.connectionId !== connectionId ||
          patch.userId !== authenticatedUserId
        ) {
          throw new Error("presence identity mismatch");
        }
        if (patch.clock <= current.clock) return;
        if (patch.clock > current.clock + 1_000) {
          throw new Error("presence clock jump is too large");
        }
        const now = Date.now();
        const cursorBase =
          patch.hasCursor && patch.cursor === null
            ? withoutCursor(current)
            : current;
        const selectionBase =
          patch.hasSelection && patch.selection === null
            ? withoutSelection(cursorBase)
            : cursorBase;
        const nextUser: PresenceUser = {
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
        room.set(connectionId, nextUser);
        peer.publish(
          topicForRoom(roomId),
          serverMessage(WS_MESSAGE.PRESENCE_UPDATE, roomId, connectionId, {
            connectionId,
            userId: authenticatedUserId,
            clock: patch.clock,
            updates: {
              ...(patch.hasCursor ? { cursor: patch.cursor ?? null } : {}),
              ...(patch.hasSelection
                ? { selection: patch.selection ?? null }
                : {}),
              ...(patch.isTyping === undefined
                ? {}
                : { meta: { isTyping: patch.isTyping } }),
              lastActivityAt: now,
              lastSeenAt: now,
              status: "active",
            },
          }),
        );
      } catch {
        peer.close(1008, "Invalid presence update");
      }
      return;
    }

    if (message.type === WS_MESSAGE.LEAVE) {
      peer.close(1000, "Presence left");
      return;
    }

    peer.close(1008, "Unsupported presence message");
  },

  close(peer) {
    const roomId = contextString(peer.context, "roomId");
    const connectionId = contextString(peer.context, "connectionId");
    const userId = contextString(peer.context, "userId");
    const timer = peer.context.heartbeatExpiryTimer;
    if (timer !== undefined) {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    }
    if (roomId === null || connectionId === null) return;

    const connections = roomConnections.get(roomId);
    connections?.delete(connectionId);
    if (connections?.size === 0) roomConnections.delete(roomId);

    const room = rooms.get(roomId);
    const wasJoined = room?.delete(connectionId) ?? false;
    if (room?.size === 0) rooms.delete(roomId);
    peer.unsubscribe(topicForRoom(roomId));
    if (wasJoined && userId !== null) {
      peer.publish(
        topicForRoom(roomId),
        serverMessage(WS_MESSAGE.LEAVE, roomId, connectionId, {
          connectionId,
          userId,
        }),
      );
    }
  },
});
