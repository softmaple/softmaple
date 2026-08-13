import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRESENCE_ROOM_POLICY,
  PRESENCE_FRAME,
  createPresenceRoom,
  type PresenceRoomOptions,
} from "../src";
import {
  createMemoryConnectionLimiter,
  createMemoryPresenceFanout,
  createMemoryPresenceStore,
  createOpaqueTestCodec,
  createRecordingPresencePeer,
  createStubPresenceSessionHooks,
  presenceRoomConformance,
  TEST_PRESENCE_WIRE_TYPE,
  type PresenceRoomHarness,
} from "../src/testing";

const createHarness = (options?: PresenceRoomOptions): PresenceRoomHarness => {
  const store = createMemoryPresenceStore();
  const fanout = createMemoryPresenceFanout();
  const connections = createMemoryConnectionLimiter();
  const sessions = createStubPresenceSessionHooks();
  const room = createPresenceRoom(
    "room-a",
    {
      codec: createOpaqueTestCodec(),
      connections,
      fanout,
      policy: DEFAULT_PRESENCE_ROOM_POLICY,
      sessions,
      store,
    },
    options,
  );
  return { connections, fanout, room, sessions, store };
};

describe("PresenceRoom conformance", () => {
  for (const testCase of presenceRoomConformance(createHarness)) {
    it(testCase.name, testCase.run);
  }
});

describe("createPresenceRoom metrics", () => {
  const wire = (
    type: string,
    roomId: string,
    senderId: string,
    payload?: unknown,
  ): string => JSON.stringify({ payload, roomId, senderId, type });

  it("reports a message-error metric when authorization throws", async () => {
    const roomId = "room-metrics";
    const sessions = createStubPresenceSessionHooks();
    sessions.authorizeImpl = async () => {
      throw new Error("auth backend unavailable");
    };
    const metrics = vi.fn();
    const room = createPresenceRoom(roomId, {
      codec: createOpaqueTestCodec(),
      connections: createMemoryConnectionLimiter(),
      fanout: createMemoryPresenceFanout(),
      metrics,
      policy: DEFAULT_PRESENCE_ROOM_POLICY,
      sessions,
      store: createMemoryPresenceStore(),
    });

    const peer = createRecordingPresencePeer("connection-1");
    await room.join(peer);
    await room.receive(
      peer,
      wire(TEST_PRESENCE_WIRE_TYPE.Auth, roomId, "connection-1", {
        connectionId: "connection-1",
        credential: { kind: "access-token", token: "test-token" },
        userId: "user-1",
      }),
    );

    expect(metrics).toHaveBeenCalledWith({
      type: "message-error",
      errorKind: "Error",
      messageType: "auth-provider",
      roomId,
    });

    await room.close();
  });

  it("reports an admission outage separately from a denied credential", async () => {
    const roomId = "room-admission";
    const metrics = vi.fn();
    const room = createPresenceRoom(roomId, {
      codec: createOpaqueTestCodec(),
      connections: {
        acquire: async () => {
          throw new Error("lease store command timed out");
        },
      },
      fanout: createMemoryPresenceFanout(),
      metrics,
      policy: DEFAULT_PRESENCE_ROOM_POLICY,
      sessions: createStubPresenceSessionHooks(),
      store: createMemoryPresenceStore(),
    });

    const peer = createRecordingPresencePeer("connection-1");
    await room.join(peer);
    await room.receive(
      peer,
      wire(TEST_PRESENCE_WIRE_TYPE.Auth, roomId, "connection-1", {
        connectionId: "connection-1",
        credential: { kind: "access-token", token: "test-token" },
        userId: "user-1",
      }),
    );

    // A lease store that never answered says nothing about membership, so
    // the peer must not be told its credential was rejected.
    expect(peer.sent).toEqual([
      {
        payload: {
          message: "Presence authorization is temporarily unavailable",
          retryable: true,
        },
        roomId,
        senderId: "server",
        type: PRESENCE_FRAME.AuthError,
      },
    ]);
    expect(peer.closes).toEqual([
      { code: 1011, reason: "Presence runtime unavailable" },
    ]);
    expect(metrics).toHaveBeenCalledWith({
      type: "message-error",
      errorKind: "Error",
      messageType: "auth-admission",
      roomId,
    });

    await room.close();
  });

  it("still denies an unparseable Auth frame without offering a retry", async () => {
    const roomId = "room-malformed";
    const room = createPresenceRoom(roomId, {
      codec: createOpaqueTestCodec(),
      connections: createMemoryConnectionLimiter(),
      fanout: createMemoryPresenceFanout(),
      policy: DEFAULT_PRESENCE_ROOM_POLICY,
      sessions: createStubPresenceSessionHooks(),
      store: createMemoryPresenceStore(),
    });

    const peer = createRecordingPresencePeer("connection-1");
    await room.join(peer);
    await room.receive(
      peer,
      wire(TEST_PRESENCE_WIRE_TYPE.Auth, roomId, "connection-1", {
        connectionId: "connection-1",
      }),
    );

    expect(peer.sent).toEqual([
      {
        payload: {
          message: "Authentication or document membership failed",
          retryable: false,
        },
        roomId,
        senderId: "server",
        type: PRESENCE_FRAME.AuthError,
      },
    ]);
    expect(peer.closes).toEqual([{ code: 1008, reason: "Unauthorized" }]);

    await room.close();
  });
});
