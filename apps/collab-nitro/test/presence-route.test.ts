import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
} from "@softmaple/awareness";
import { WS_MESSAGE } from "@softmaple/awareness/adapters/websocket";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryRealtime,
  resetTopicBridgesForTests,
  setRealtimeForTests,
} from "../server/utils/realtime";

const ALLOWED_ORIGIN = "http://localhost:3000";
const ROOM_ID = "00000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  authorizeDocument: vi.fn(),
  findUniqueUser: vi.fn(),
  findSharedDocument: vi.fn(),
}));

vi.mock("nitro", () => ({
  defineWebSocketHandler: (hooks: unknown) => hooks,
}));

vi.mock("../server/utils/auth", () => ({
  authorizeDocument: mocks.authorizeDocument,
}));

vi.mock("../server/utils/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUniqueUser },
    document: { findFirst: mocks.findSharedDocument },
  },
}));

import presenceRoute from "../server/routes/collab/presence";

interface TestPeer {
  context: Record<string, unknown>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
}

interface TestRawMessage {
  readonly text: () => string;
}

interface TestPresenceRoute {
  readonly upgrade: (request: Request) => Promise<{
    readonly namespace: string;
    readonly context: Record<string, unknown>;
  }>;
  readonly message: (peer: TestPeer, message: TestRawMessage) => Promise<void>;
  readonly close: (peer: TestPeer) => Promise<void>;
}

const route = presenceRoute as unknown as TestPresenceRoute;

const browserUpgradeRequest = (roomId: string | null = ROOM_ID): Request =>
  new Request(
    `http://localhost:3002/collab/presence${roomId === null ? "" : `?roomId=${roomId}`}`,
    { method: "GET", headers: { origin: ALLOWED_ORIGIN } },
  );

const createPeer = (context: Record<string, unknown> = {}): TestPeer => ({
  context,
  close: vi.fn(),
  send: vi.fn(),
});

const upgradedPeer = async (roomId = ROOM_ID): Promise<TestPeer> => {
  const upgrade = await route.upgrade(browserUpgradeRequest(roomId));
  return createPeer({ ...upgrade.context });
};

/** `upgrade` is a plain (non-async) function that throws synchronously on rejection. */
const rejectedUpgrade = async (request: Request): Promise<unknown> => {
  try {
    await route.upgrade(request);
    return null;
  } catch (error) {
    return error;
  }
};

const wireMessage = (
  type: string,
  roomId: string,
  senderId: string,
  payload?: unknown,
): TestRawMessage => ({
  text: () =>
    JSON.stringify({
      type,
      roomId,
      senderId,
      timestamp: Date.now(),
      ...(payload === undefined ? {} : { payload }),
    }),
});

const authPayload = (
  overrides: Partial<{
    token: string;
    protocolVersion: unknown;
    capabilities: unknown;
    connectionId: unknown;
    userId: unknown;
  }> = {},
) => ({
  token: "access-token",
  protocolVersion: PRESENCE_PROTOCOL_VERSION,
  capabilities: PRESENCE_CAPABILITIES,
  connectionId: "connection-1",
  userId: "user-1",
  ...overrides,
});

const authMessage = (
  roomId: string,
  senderId: string,
  overrides: Parameters<typeof authPayload>[0] = {},
): TestRawMessage =>
  wireMessage(WS_MESSAGE.AUTH, roomId, senderId, authPayload(overrides));

const AUTHENTICATED_ACCESS = {
  accessMode: "authenticated" as const,
  documentId: ROOM_ID,
  userId: "user-1",
  role: "EDITOR" as const,
  canWrite: true,
};

const DEFAULT_PROFILE = { full_name: "Test User", avatar_src: null };

/** Stand-in for a real Supabase access token (~1000 characters). */
const JWT_LENGTH_TOKEN = `${"h".repeat(40)}.${"p".repeat(900)}.${"s".repeat(43)}`;

// `mockResolvedValueOnce` queues leak across tests when only `clearAllMocks`
// runs between them (it clears call history, not queued implementations).
// Driving both mocks off mutable state avoids call-count bookkeeping and
// keeps each test independent of what earlier tests queued.
let currentAccess: unknown = AUTHENTICATED_ACCESS;
let currentProfile: unknown = DEFAULT_PROFILE;

const authorizeAndJoin = async (
  connectionId = "connection-1",
  userId = "user-1",
): Promise<TestPeer> => {
  currentAccess = { ...AUTHENTICATED_ACCESS, userId };
  currentProfile = DEFAULT_PROFILE;
  const peer = await upgradedPeer();
  await route.message(
    peer,
    authMessage(ROOM_ID, connectionId, { connectionId, userId }),
  );
  expect(peer.send).toHaveBeenCalledWith(
    expect.objectContaining({ type: WS_MESSAGE.AUTH_OK }),
  );
  peer.send.mockClear();
  await route.message(
    peer,
    wireMessage(WS_MESSAGE.JOIN, ROOM_ID, connectionId),
  );
  expect(peer.close).not.toHaveBeenCalled();
  return peer;
};

describe("collaboration presence route", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    currentAccess = AUTHENTICATED_ACCESS;
    currentProfile = DEFAULT_PROFILE;
    mocks.authorizeDocument.mockImplementation(async () => currentAccess);
    mocks.findUniqueUser.mockImplementation(async () => currentProfile);
    mocks.findSharedDocument.mockResolvedValue({ id: ROOM_ID });
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", ALLOWED_ORIGIN);
    await setRealtimeForTests(createMemoryRealtime());
    await resetTopicBridgesForTests();
  });

  afterEach(async () => {
    await resetTopicBridgesForTests();
    await setRealtimeForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("upgrade", () => {
    it("accepts a valid roomId with the presence namespace", async () => {
      const upgrade = await route.upgrade(browserUpgradeRequest());
      expect(upgrade.namespace).toBe("softmaple-presence-v2");
      expect(upgrade.context.roomId).toBe(ROOM_ID);
    });

    it("rejects a missing roomId with 400", async () => {
      const rejection = await rejectedUpgrade(browserUpgradeRequest(null));
      expect(rejection).toBeInstanceOf(Response);
      expect((rejection as Response).status).toBe(400);
    });

    it("rejects a non-UUID roomId with 400", async () => {
      const rejection = await rejectedUpgrade(
        browserUpgradeRequest("not-a-uuid"),
      );
      expect(rejection).toBeInstanceOf(Response);
      expect((rejection as Response).status).toBe(400);
    });

    it("rejects a disallowed origin with 403", async () => {
      const rejection = await rejectedUpgrade(
        new Request(`http://localhost:3002/collab/presence?roomId=${ROOM_ID}`, {
          headers: { origin: "https://evil.example" },
        }),
      );
      expect(rejection).toBeInstanceOf(Response);
      expect((rejection as Response).status).toBe(403);
    });
  });

  it("closes 1009 on an oversized frame without sending", async () => {
    const peer = await upgradedPeer();
    const multibyteCharacter = "界";
    const oversizedCount =
      Math.floor(65536 / Buffer.byteLength(multibyteCharacter, "utf8")) + 1;
    await route.message(peer, {
      text: () => multibyteCharacter.repeat(oversizedCount),
    });
    expect(peer.send).not.toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalledWith(
      1009,
      "Presence frame is too large",
    );
    await route.close(peer);
  });

  it("closes 1013 on the 81st frame within the rate window, invalid JSON still consuming quota", async () => {
    const peer = await upgradedPeer();
    for (let index = 0; index < 80; index += 1) {
      await route.message(peer, { text: () => "{not json" });
    }
    expect(peer.close).not.toHaveBeenCalled();
    await route.message(peer, { text: () => "{not json" });
    expect(peer.close).toHaveBeenCalledWith(
      1013,
      "Presence rate limit exceeded",
    );
    await route.close(peer);
  });

  it("sends an error frame (not a close) for an invalid envelope", async () => {
    const peer = await upgradedPeer();
    await route.message(peer, {
      text: () => JSON.stringify({ garbage: true }),
    });
    expect(peer.close).not.toHaveBeenCalled();
    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WS_MESSAGE.ERROR,
        roomId: "unknown",
        senderId: "server",
        payload: expect.objectContaining({ code: "invalid-message" }),
      }),
    );
    await route.close(peer);
  });

  it("closes 1008 on a room-id mismatch", async () => {
    const peer = await upgradedPeer();
    await route.message(
      peer,
      wireMessage(
        WS_MESSAGE.JOIN,
        "00000000-0000-4000-8000-000000000099",
        "connection-1",
      ),
    );
    expect(peer.close).toHaveBeenCalledWith(1008, "Presence room mismatch");
    await route.close(peer);
  });

  describe("Auth capability handshake", () => {
    it.each(
      Object.keys(PRESENCE_CAPABILITIES),
    )("rejects Auth missing capability %s", async (capability) => {
      const peer = await upgradedPeer();
      const capabilities = { ...PRESENCE_CAPABILITIES };
      delete (capabilities as Record<string, unknown>)[capability];
      await route.message(
        peer,
        authMessage(ROOM_ID, "connection-1", { capabilities }),
      );
      expect(peer.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: WS_MESSAGE.AUTH_ERROR }),
      );
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("rejects an unsupported protocolVersion", async () => {
      const peer = await upgradedPeer();
      await route.message(
        peer,
        authMessage(ROOM_ID, "connection-1", { protocolVersion: 999 }),
      );
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("rejects an empty connectionId", async () => {
      // senderId must itself be a non-empty string to pass envelope parsing;
      // the empty connectionId under test lives in the Auth payload.
      const peer = await upgradedPeer();
      await route.message(
        peer,
        authMessage(ROOM_ID, "probe", { connectionId: "" }),
      );
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("rejects a connectionId over 256 characters", async () => {
      const peer = await upgradedPeer();
      const longId = "c".repeat(257);
      await route.message(
        peer,
        authMessage(ROOM_ID, "probe", { connectionId: longId }),
      );
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("rejects a non-string userId", async () => {
      const peer = await upgradedPeer();
      await route.message(
        peer,
        authMessage(ROOM_ID, "connection-1", {
          userId: 123 as unknown as string,
        }),
      );
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("authenticates a JWT-length token", async () => {
      const peer = await upgradedPeer();
      await route.message(
        peer,
        authMessage(ROOM_ID, "connection-1", { token: JWT_LENGTH_TOKEN }),
      );
      expect(peer.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: WS_MESSAGE.AUTH_OK }),
      );
      expect(mocks.authorizeDocument).toHaveBeenCalledWith(
        { kind: "access-token", token: JWT_LENGTH_TOKEN },
        ROOM_ID,
      );
      expect(peer.close).not.toHaveBeenCalled();
      await route.close(peer);
    });

    it("rejects a senderId that does not match the Auth payload's connectionId", async () => {
      const peer = await upgradedPeer();
      await route.message(
        peer,
        authMessage(ROOM_ID, "someone-else", { connectionId: "connection-1" }),
      );
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });
  });

  it("closes 1008 on a post-auth sender mismatch", async () => {
    const peer = await authorizeAndJoin();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.PRESENCE_SYNC, ROOM_ID, "someone-else"),
    );
    expect(peer.close).toHaveBeenCalledWith(
      1008,
      "Authenticate presence first",
    );
    await route.close(peer);
  });

  describe("authorization failures", () => {
    it("rejects a workspace member when public-link collaboration is disabled", async () => {
      mocks.findSharedDocument.mockResolvedValue(null);
      const peer = await upgradedPeer();
      await route.message(peer, authMessage(ROOM_ID, "connection-1"));
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });
    it("rejects when authorizeDocument returns null", async () => {
      currentAccess = null;
      const peer = await upgradedPeer();
      await route.message(peer, authMessage(ROOM_ID, "connection-1"));
      expect(peer.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: WS_MESSAGE.AUTH_ERROR }),
      );
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("rejects public access mode", async () => {
      currentAccess = {
        accessMode: "public",
        documentId: ROOM_ID,
        userId: null,
        role: null,
        canWrite: false,
      };
      const peer = await upgradedPeer();
      await route.message(peer, authMessage(ROOM_ID, "connection-1"));
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("rejects a userId mismatch between token and payload", async () => {
      currentAccess = { ...AUTHENTICATED_ACCESS, userId: "someone-else" };
      const peer = await upgradedPeer();
      await route.message(
        peer,
        authMessage(ROOM_ID, "connection-1", { userId: "user-1" }),
      );
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("rejects when the Prisma profile is missing", async () => {
      currentProfile = null;
      const peer = await upgradedPeer();
      await route.message(peer, authMessage(ROOM_ID, "connection-1"));
      expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
      await route.close(peer);
    });

    it("does not publish a Leave for an authorization failure", async () => {
      const observer = await authorizeAndJoin("observer", "observer-user");
      observer.send.mockClear();
      currentAccess = null;
      const peer = await upgradedPeer();
      await route.message(peer, authMessage(ROOM_ID, "connection-1"));
      expect(observer.send).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: WS_MESSAGE.LEAVE }),
      );
      await route.close(peer);
      await route.close(observer);
    });
  });

  it("closes 1008 on a second Auth", async () => {
    const peer = await authorizeAndJoin();
    await route.message(peer, authMessage(ROOM_ID, "connection-1"));
    expect(peer.close).toHaveBeenCalledWith(
      1008,
      "Presence is already authenticated",
    );
    await route.close(peer);
  });

  it("closes 1013 when the room is full", async () => {
    const peers: TestPeer[] = [];
    for (let index = 0; index < 100; index += 1) {
      peers.push(
        await authorizeAndJoin(`connection-${index}`, `user-${index}`),
      );
    }
    currentAccess = AUTHENTICATED_ACCESS;
    currentProfile = DEFAULT_PROFILE;
    const blocked = await upgradedPeer();
    await route.message(
      blocked,
      authMessage(ROOM_ID, "connection-blocked", {
        connectionId: "connection-blocked",
      }),
    );
    expect(blocked.close).toHaveBeenCalledWith(
      1013,
      "Presence room is full or duplicated",
    );
    await route.close(blocked);
    for (const peer of peers) await route.close(peer);
  });

  it("derives name/color/avatar/clock/status from the database, ignoring client-supplied identity", async () => {
    currentProfile = {
      full_name: "  Real Name  ",
      avatar_src: "https://example.com/avatar.png",
    };
    const peer = await upgradedPeer();
    await route.message(peer, authMessage(ROOM_ID, "connection-1"));
    peer.send.mockClear();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.JOIN, ROOM_ID, "connection-1"),
    );
    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WS_MESSAGE.JOIN,
        payload: {
          user: expect.objectContaining({
            name: "Real Name",
            avatarUrl: "https://example.com/avatar.png",
            clock: 0,
            status: "active",
          }),
        },
      }),
    );
    await route.close(peer);
  });

  it("falls back to 'Workspace member' when full_name is blank", async () => {
    currentProfile = { full_name: "  ", avatar_src: null };
    const peer = await upgradedPeer();
    await route.message(peer, authMessage(ROOM_ID, "connection-1"));
    peer.send.mockClear();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.JOIN, ROOM_ID, "connection-1"),
    );
    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          user: expect.objectContaining({ name: "Workspace member" }),
        },
      }),
    );
    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          user: expect.not.objectContaining({ avatarUrl: expect.anything() }),
        },
      }),
    );
    await route.close(peer);
  });

  it("closes 1008 on a second Join", async () => {
    const peer = await authorizeAndJoin();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.JOIN, ROOM_ID, "connection-1"),
    );
    expect(peer.close).toHaveBeenCalledWith(1008, "Presence already joined");
    await route.close(peer);
  });

  it("Sync reports lapsed members as Leave before the response, exactly once", async () => {
    // The observer must join before the ghost's TTL lapses: any store write
    // (e.g. another peer's own Join) purges expired members as a side
    // effect, which would silently swallow the ghost before Sync runs.
    const observer = await authorizeAndJoin("observer", "observer-user");
    currentProfile = { full_name: "Ghost", avatar_src: null };
    const ghost = await upgradedPeer();
    await route.message(
      ghost,
      authMessage(ROOM_ID, "ghost", { connectionId: "ghost" }),
    );
    await route.message(ghost, wireMessage(WS_MESSAGE.JOIN, ROOM_ID, "ghost"));
    ghost.close.mockClear();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000);

    observer.send.mockClear();
    await route.message(
      observer,
      wireMessage(WS_MESSAGE.PRESENCE_SYNC, ROOM_ID, "observer"),
    );

    const sentTypes = observer.send.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(sentTypes.filter((type) => type === WS_MESSAGE.LEAVE)).toHaveLength(
      1,
    );
    const leaveIndex = sentTypes.indexOf(WS_MESSAGE.LEAVE);
    const responseIndex = sentTypes.indexOf(WS_MESSAGE.PRESENCE_SYNC_RESPONSE);
    expect(leaveIndex).toBeLessThan(responseIndex);
    await route.close(observer);
  });

  it("Heartbeat acknowledges with a matching pingId and connectionId sender", async () => {
    const peer = await authorizeAndJoin();
    peer.send.mockClear();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.HEARTBEAT, ROOM_ID, "connection-1", {
        pingId: "ping-1",
      }),
    );
    expect(peer.send).toHaveBeenCalledWith({
      type: WS_MESSAGE.HEARTBEAT_ACK,
      roomId: ROOM_ID,
      senderId: "connection-1",
      timestamp: expect.any(Number),
      payload: { pingId: "ping-1" },
    });
    await route.close(peer);
  });

  it("closes 1008 for an invalid heartbeat pingId", async () => {
    const peer = await authorizeAndJoin();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.HEARTBEAT, ROOM_ID, "connection-1", {}),
    );
    expect(peer.close).toHaveBeenCalledWith(1008, "Invalid presence heartbeat");
    await route.close(peer);
  });

  it("closes 1008 for an identity mismatch on Update", async () => {
    const peer = await authorizeAndJoin();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.PRESENCE_UPDATE, ROOM_ID, "connection-1", {
        connectionId: "connection-1",
        userId: "someone-else",
        clock: 1,
        updates: {},
      }),
    );
    expect(peer.close).toHaveBeenCalledWith(1008, "Invalid presence update");
    await route.close(peer);
  });

  it("closes 1008 on Update before Join", async () => {
    const peer = await upgradedPeer();
    await route.message(peer, authMessage(ROOM_ID, "connection-1"));
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.PRESENCE_UPDATE, ROOM_ID, "connection-1", {
        connectionId: "connection-1",
        userId: "user-1",
        clock: 1,
        updates: {},
      }),
    );
    expect(peer.close).toHaveBeenCalledWith(
      1008,
      "Join presence before updating",
    );
    await route.close(peer);
  });

  it("silently drops a stale-clock Update (no publish, no close)", async () => {
    const first = await authorizeAndJoin("connection-1", "user-1");
    const second = await authorizeAndJoin("connection-2", "user-2");
    // A fresh member's clock starts at 0 and the wire schema rejects
    // clock < 1, so staleness can only be observed after one real advance.
    await route.message(
      first,
      wireMessage(WS_MESSAGE.PRESENCE_UPDATE, ROOM_ID, "connection-1", {
        connectionId: "connection-1",
        userId: "user-1",
        clock: 5,
        updates: {},
      }),
    );
    second.send.mockClear();
    await route.message(
      first,
      wireMessage(WS_MESSAGE.PRESENCE_UPDATE, ROOM_ID, "connection-1", {
        connectionId: "connection-1",
        userId: "user-1",
        clock: 3,
        updates: {},
      }),
    );
    expect(first.close).not.toHaveBeenCalled();
    expect(second.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: WS_MESSAGE.PRESENCE_UPDATE }),
    );
    await route.close(first);
    await route.close(second);
  });

  it("closes 1008 on a clock jump beyond +1000", async () => {
    const peer = await authorizeAndJoin();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.PRESENCE_UPDATE, ROOM_ID, "connection-1", {
        connectionId: "connection-1",
        userId: "user-1",
        clock: 5_000,
        updates: {},
      }),
    );
    expect(peer.close).toHaveBeenCalledWith(1008, "Invalid presence update");
    await route.close(peer);
  });

  it("removes cursor/selection on an explicit null clear and republishes them as null", async () => {
    const first = await authorizeAndJoin("connection-1", "user-1");
    const second = await authorizeAndJoin("connection-2", "user-2");
    await route.message(
      first,
      wireMessage(WS_MESSAGE.PRESENCE_UPDATE, ROOM_ID, "connection-1", {
        connectionId: "connection-1",
        userId: "user-1",
        clock: 1,
        updates: { cursor: { blockId: "b1", offset: 3 } },
      }),
    );
    second.send.mockClear();
    await route.message(
      first,
      wireMessage(WS_MESSAGE.PRESENCE_UPDATE, ROOM_ID, "connection-1", {
        connectionId: "connection-1",
        userId: "user-1",
        clock: 2,
        updates: { cursor: null },
      }),
    );
    expect(second.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: WS_MESSAGE.PRESENCE_UPDATE,
        payload: expect.objectContaining({
          updates: expect.objectContaining({ cursor: null }),
        }),
      }),
    );
    await route.close(first);
    await route.close(second);
  });

  it("closes 1000 on a wire Leave and 1008 on an unsupported type", async () => {
    const peer = await authorizeAndJoin();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.LEAVE, ROOM_ID, "connection-1"),
    );
    expect(peer.close).toHaveBeenCalledWith(1000, "Presence left");
    await route.close(peer);

    const other = await authorizeAndJoin("connection-2", "user-2");
    await route.message(
      other,
      wireMessage("nonsense", ROOM_ID, "connection-2"),
    );
    expect(other.close).toHaveBeenCalledWith(
      1008,
      "Unsupported presence message",
    );
    await route.close(other);
  });

  it("publishes exactly one Leave when a joined peer disconnects, and none for a never-joined peer", async () => {
    const first = await authorizeAndJoin("connection-1", "user-1");
    const second = await authorizeAndJoin("connection-2", "user-2");
    second.send.mockClear();
    await route.close(first);
    const leaveCalls = second.send.mock.calls.filter(
      (call) => (call[0] as { type: string }).type === WS_MESSAGE.LEAVE,
    );
    expect(leaveCalls).toHaveLength(1);
    await route.close(second);

    const observer = await authorizeAndJoin("observer", "observer-user");
    observer.send.mockClear();
    const neverJoined = await upgradedPeer();
    await route.message(
      neverJoined,
      authMessage(ROOM_ID, "connection-3", { connectionId: "connection-3" }),
    );
    await route.close(neverJoined);
    expect(observer.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: WS_MESSAGE.LEAVE }),
    );
    await route.close(observer);
  });

  it("self-echoes JOIN and UPDATE back to the joining peer through the hub", async () => {
    currentProfile = { full_name: "Solo", avatar_src: null };
    const peer = await upgradedPeer();
    await route.message(peer, authMessage(ROOM_ID, "connection-1"));
    peer.send.mockClear();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.JOIN, ROOM_ID, "connection-1"),
    );
    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: WS_MESSAGE.JOIN }),
    );
    peer.send.mockClear();
    await route.message(
      peer,
      wireMessage(WS_MESSAGE.PRESENCE_UPDATE, ROOM_ID, "connection-1", {
        connectionId: "connection-1",
        userId: "user-1",
        clock: 1,
        updates: {},
      }),
    );
    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: WS_MESSAGE.PRESENCE_UPDATE }),
    );
    await route.close(peer);
  });
});
