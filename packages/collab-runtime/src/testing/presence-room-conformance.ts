import { PRESENCE_FRAME } from "../presence-codec";
import type { ConnectionLimiter } from "../connection-limiter";
import type { PresenceFanout } from "../presence-fanout";
import type { PresenceRoom, PresenceRoomOptions } from "../presence-room";
import type { PresenceStore } from "../presence-store";
import { check, checkEqual, type ConformanceCase } from "./conformance-case";
import {
  TEST_PRESENCE_WIRE_TYPE,
  createRecordingPresencePeer,
  type StubPresenceSessionHooks,
} from "./fakes";

export interface PresenceRoomHarness {
  readonly connections: ConnectionLimiter;
  readonly fanout: PresenceFanout;
  readonly room: PresenceRoom;
  readonly sessions: StubPresenceSessionHooks;
  readonly store: PresenceStore;
}

/** Must return a fully independent harness (fresh fakes) on every call. */
export type PresenceRoomFactory = (
  options?: PresenceRoomOptions,
) => PresenceRoomHarness;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const framesOfType = (
  peer: ReturnType<typeof createRecordingPresencePeer>,
  type: string,
): unknown[] =>
  peer.sent.filter((frame) => isRecord(frame) && frame.type === type);

const wire = (
  type: string,
  roomId: string,
  senderId: string,
  payload?: unknown,
): string => JSON.stringify({ payload, roomId, senderId, type });

const authWire = (
  roomId: string,
  connectionId: string,
  userId: string,
): string =>
  wire(TEST_PRESENCE_WIRE_TYPE.Auth, roomId, connectionId, {
    connectionId,
    credential: { kind: "access-token", token: "test-token" },
    userId,
  });

const joinWire = (roomId: string, connectionId: string): string =>
  wire(TEST_PRESENCE_WIRE_TYPE.Join, roomId, connectionId);

const syncWire = (roomId: string, connectionId: string): string =>
  wire(TEST_PRESENCE_WIRE_TYPE.Sync, roomId, connectionId);

const heartbeatWire = (
  roomId: string,
  connectionId: string,
  pingId: string,
): string =>
  wire(TEST_PRESENCE_WIRE_TYPE.Heartbeat, roomId, connectionId, { pingId });

const updateWire = (
  roomId: string,
  connectionId: string,
  userId: string,
  clock: number,
  extra?: unknown,
): string =>
  wire(TEST_PRESENCE_WIRE_TYPE.Update, roomId, connectionId, {
    clock,
    connectionId,
    extra,
    userId,
  });

const leaveWire = (roomId: string, connectionId: string): string =>
  wire(TEST_PRESENCE_WIRE_TYPE.Leave, roomId, connectionId);

const ROOM_ID = "room-a";

/** Authenticates and joins one peer; asserts each step succeeded. */
const authenticateAndJoin = async (
  room: PresenceRoom,
  connectionId: string,
  userId = `user-${connectionId}`,
): Promise<ReturnType<typeof createRecordingPresencePeer>> => {
  const peer = createRecordingPresencePeer(connectionId);
  await room.join(peer);
  await room.receive(peer, authWire(ROOM_ID, connectionId, userId));
  check(
    framesOfType(peer, PRESENCE_FRAME.AuthOk).length === 1,
    `expected ${connectionId} to receive exactly one auth-ok`,
  );
  await room.receive(peer, joinWire(ROOM_ID, connectionId));
  check(
    peer.closes.length === 0,
    `expected ${connectionId} to stay open after joining`,
  );
  return peer;
};

/**
 * Behavioural conformance for `PresenceRoom`: the full rule table (room
 * match, sender binding, identity match, monotonic clock, TTL refresh, rate
 * limiting, expiry, cleanup order, close codes) plus fan-out reach,
 * resume-without-re-Auth, sweep idempotence, and refresh-mode equivalence.
 */
export const presenceRoomConformance = (
  factory: PresenceRoomFactory,
): ConformanceCase[] => [
  {
    name: "Auth denial closes 1008 and sends auth-error",
    async run() {
      const { room, sessions } = factory();
      sessions.authorizeImpl = async () => null;
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(peer, authWire(ROOM_ID, "connection-1", "user-1"));
      checkEqual(peer.closes[0]?.code, 1008, "expected a 1008 close on denial");
      check(
        framesOfType(peer, PRESENCE_FRAME.AuthError).length === 1,
        "expected exactly one auth-error frame",
      );
    },
  },
  {
    name: "Auth with a room-id mismatch closes 1008",
    async run() {
      const { room } = factory();
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(
        peer,
        authWire("other-room", "connection-1", "user-1"),
      );
      checkEqual(peer.closes[0]?.code, 1008, "expected a room-mismatch close");
    },
  },
  {
    name: "Auth with a sender/connectionId mismatch closes 1008",
    async run() {
      const { room } = factory();
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(
        peer,
        wire(TEST_PRESENCE_WIRE_TYPE.Auth, ROOM_ID, "someone-else", {
          connectionId: "connection-1",
          credential: { kind: "access-token", token: "t" },
          userId: "user-1",
        }),
      );
      checkEqual(
        peer.closes[0]?.code,
        1008,
        "expected a sender-mismatch close",
      );
    },
  },
  {
    name: "a second Auth closes 1008",
    async run() {
      const { room } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.receive(peer, authWire(ROOM_ID, "connection-1", "user-1"));
      checkEqual(peer.closes[0]?.code, 1008, "expected a duplicate-auth close");
    },
  },
  {
    name: "a non-Auth message before authentication closes 1008",
    async run() {
      const { room } = factory();
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(peer, syncWire(ROOM_ID, "connection-1"));
      checkEqual(
        peer.closes[0]?.code,
        1008,
        "expected an unauthenticated close",
      );
    },
  },
  {
    name: "a post-auth sender mismatch closes 1008",
    async run() {
      const { room } = factory();
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(peer, authWire(ROOM_ID, "connection-1", "user-1"));
      await room.receive(peer, syncWire(ROOM_ID, "someone-else"));
      checkEqual(
        peer.closes[0]?.code,
        1008,
        "expected a sender-mismatch close",
      );
    },
  },
  {
    name: "an unsupported wire type closes 1008",
    async run() {
      const { room } = factory();
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(peer, authWire(ROOM_ID, "connection-1", "user-1"));
      await room.receive(peer, wire("nonsense", ROOM_ID, "connection-1"));
      checkEqual(
        peer.closes[0]?.code,
        1008,
        "expected an unsupported-type close",
      );
    },
  },
  {
    name: "malformed JSON sends an error frame and does not close",
    async run() {
      const { room } = factory();
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(peer, "{not json");
      check(peer.closes.length === 0, "expected no close for malformed JSON");
      const errors = framesOfType(peer, PRESENCE_FRAME.Error);
      checkEqual(errors.length, 1, "expected exactly one error frame");
      const errorFrame = errors[0] as { roomId: string; senderId: string };
      checkEqual(errorFrame.roomId, "unknown", 'expected roomId "unknown"');
      checkEqual(errorFrame.senderId, "server", 'expected senderId "server"');
    },
  },
  {
    name: "an invalid envelope sends an error frame and does not close",
    async run() {
      const { room } = factory();
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(peer, JSON.stringify({ garbage: true }));
      check(
        peer.closes.length === 0,
        "expected no close for an invalid envelope",
      );
      checkEqual(
        framesOfType(peer, PRESENCE_FRAME.Error).length,
        1,
        "expected exactly one error frame",
      );
    },
  },
  {
    name: "Join fans out to a second joined peer",
    async run() {
      const { room } = factory();
      const first = await authenticateAndJoin(room, "connection-1");
      first.sent.length = 0;
      await authenticateAndJoin(room, "connection-2");
      checkEqual(
        framesOfType(first, PRESENCE_FRAME.Join).length,
        1,
        "expected the first peer to observe the second peer's Join",
      );
    },
  },
  {
    name: "a second Join closes 1008",
    async run() {
      const { room } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.receive(peer, joinWire(ROOM_ID, "connection-1"));
      checkEqual(peer.closes[0]?.code, 1008, "expected a duplicate-join close");
    },
  },
  {
    name: "Update before Join closes 1008",
    async run() {
      const { room } = factory();
      const peer = createRecordingPresencePeer("connection-1");
      await room.join(peer);
      await room.receive(peer, authWire(ROOM_ID, "connection-1", "user-1"));
      await room.receive(
        peer,
        updateWire(ROOM_ID, "connection-1", "user-1", 1),
      );
      checkEqual(
        peer.closes[0]?.code,
        1008,
        "expected an update-before-join close",
      );
    },
  },
  {
    name: "an identity mismatch on Update closes 1008",
    async run() {
      const { room } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.receive(
        peer,
        updateWire(ROOM_ID, "connection-1", "someone-else", 1),
      );
      checkEqual(
        peer.closes[0]?.code,
        1008,
        "expected an identity-mismatch close",
      );
    },
  },
  {
    name: "an Update with clock <= current is silently dropped",
    async run() {
      const { room, fanout } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.receive(
        peer,
        updateWire(ROOM_ID, "connection-1", "user-connection-1", 5),
      );
      let deliveries = 0;
      await fanout.subscribe(ROOM_ID, () => {
        deliveries += 1;
      });
      await room.receive(
        peer,
        updateWire(ROOM_ID, "connection-1", "user-connection-1", 3),
      );
      check(peer.closes.length === 0, "expected no close on a stale clock");
      checkEqual(deliveries, 0, "expected no publish on a stale clock");
    },
  },
  {
    name: "an Update with a clock jump beyond +1000 closes 1008",
    async run() {
      const { room } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.receive(
        peer,
        updateWire(ROOM_ID, "connection-1", "user-connection-1", 5_000),
      );
      checkEqual(peer.closes[0]?.code, 1008, "expected a clock-jump close");
    },
  },
  {
    name: "a valid Update publishes exactly one update broadcast",
    async run() {
      const { room } = factory();
      const first = await authenticateAndJoin(room, "connection-1");
      const second = await authenticateAndJoin(room, "connection-2");
      second.sent.length = 0;
      await room.receive(
        first,
        updateWire(ROOM_ID, "connection-1", "user-connection-1", 1, {
          cursor: "x",
        }),
      );
      checkEqual(
        framesOfType(second, PRESENCE_FRAME.Update).length,
        1,
        "expected exactly one update broadcast",
      );
    },
  },
  {
    name: "Sync reports a lapsed member as Leave exactly once, before the response",
    async run() {
      const { room, store } = factory();
      const observer = await authenticateAndJoin(room, "connection-1");
      observer.sent.length = 0;
      await store.setMember(
        ROOM_ID,
        { clock: 0, connectionId: "ghost", userId: "ghost-user" },
        10,
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
      await room.receive(observer, syncWire(ROOM_ID, "connection-1"));
      checkEqual(
        framesOfType(observer, PRESENCE_FRAME.Leave).length,
        1,
        "expected exactly one Leave for the lapsed member",
      );
      const leaveIndex = observer.sent.findIndex(
        (frame) => isRecord(frame) && frame.type === PRESENCE_FRAME.Leave,
      );
      const responseIndex = observer.sent.findIndex(
        (frame) =>
          isRecord(frame) && frame.type === PRESENCE_FRAME.SyncResponse,
      );
      check(
        leaveIndex < responseIndex,
        "expected the Leave before the sync response",
      );
    },
  },
  {
    name: "Heartbeat acknowledges with the matching pingId and sender",
    async run() {
      const { room } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      peer.sent.length = 0;
      await room.receive(
        peer,
        heartbeatWire(ROOM_ID, "connection-1", "ping-1"),
      );
      const acks = framesOfType(peer, PRESENCE_FRAME.HeartbeatAck);
      checkEqual(acks.length, 1, "expected exactly one heartbeat-ack");
      const ack = acks[0] as { payload: { pingId: string }; senderId: string };
      checkEqual(
        ack.payload.pingId,
        "ping-1",
        "expected the pingId to be echoed",
      );
      checkEqual(
        ack.senderId,
        "connection-1",
        "expected senderId to be the connectionId",
      );
    },
  },
  {
    name: "Heartbeat with an invalid pingId closes 1008",
    async run() {
      const { room } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.receive(
        peer,
        wire(TEST_PRESENCE_WIRE_TYPE.Heartbeat, ROOM_ID, "connection-1", {}),
      );
      checkEqual(
        peer.closes[0]?.code,
        1008,
        "expected an invalid-heartbeat close",
      );
    },
  },
  {
    name: "closing a joined peer publishes exactly one Leave to survivors",
    async run() {
      const { room } = factory();
      const first = await authenticateAndJoin(room, "connection-1");
      const second = await authenticateAndJoin(room, "connection-2");
      second.sent.length = 0;
      await room.leave(first);
      checkEqual(
        framesOfType(second, PRESENCE_FRAME.Leave).length,
        1,
        "expected exactly one Leave broadcast",
      );
    },
  },
  {
    name: "closing a never-joined peer publishes no Leave",
    async run() {
      const { room } = factory();
      const observer = await authenticateAndJoin(room, "connection-1");
      observer.sent.length = 0;
      const peer = createRecordingPresencePeer("connection-2");
      await room.join(peer);
      await room.receive(peer, authWire(ROOM_ID, "connection-2", "user-2"));
      await room.leave(peer);
      checkEqual(
        framesOfType(observer, PRESENCE_FRAME.Leave).length,
        0,
        "expected no Leave for a peer that never joined",
      );
    },
  },
  {
    name: "a wire Leave message closes 1000",
    async run() {
      const { room } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.receive(peer, leaveWire(ROOM_ID, "connection-1"));
      checkEqual(peer.closes[0]?.code, 1000, "expected a clean 1000 close");
    },
  },
  {
    name: "leaving releases the connection lease for immediate re-acquisition",
    async run() {
      const { room } = factory();
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.leave(peer);
      const rejoined = await authenticateAndJoin(room, "connection-1");
      check(
        rejoined.closes.length === 0,
        "expected the same connectionId to be re-acquirable after leaving",
      );
    },
  },
  {
    name: "resume() restores an authenticated session without a new Auth exchange",
    async run() {
      const { room, sessions } = factory();
      const identity = { name: "Resumed User", userId: "user-1" };
      sessions.authorizeImpl = async () => identity;
      sessions.refreshImpl = async () => identity;
      const peer = createRecordingPresencePeer("connection-1");
      const session = await room.resume(peer, {
        connectionId: "connection-1",
        credential: { kind: "access-token", token: "t" },
        heartbeatExpiresAt: 0,
        identity,
        joined: false,
        rateLimit: null,
      });
      check(session !== null, "expected resume to restore a session");
      checkEqual(
        framesOfType(peer, PRESENCE_FRAME.AuthOk).length,
        0,
        "expected no second auth-ok frame on resume",
      );
      await room.receive(peer, joinWire(ROOM_ID, "connection-1"));
      check(
        peer.closes.length === 0,
        "expected the resumed peer to join successfully",
      );
    },
  },
  {
    name: "sweep() closes a peer past its heartbeat deadline with 1001",
    async run() {
      const { room } = factory({ refreshMode: "on-message" });
      const peer = await authenticateAndJoin(room, "connection-1");
      await room.sweep(Date.now() + 10 * 60_000);
      checkEqual(
        peer.closes[0]?.code,
        1001,
        "expected a heartbeat-expiry close",
      );
    },
  },
  {
    name: "sweep() is idempotent",
    async run() {
      const { room } = factory({ refreshMode: "on-message" });
      const peer = await authenticateAndJoin(room, "connection-1");
      const future = Date.now() + 10 * 60_000;
      await room.sweep(future);
      const closesAfterFirstSweep = peer.closes.length;
      await room.sweep(future);
      checkEqual(
        peer.closes.length,
        closesAfterFirstSweep,
        "expected a second sweep to be a no-op",
      );
    },
  },
  {
    name: "both refresh modes reach the same terminal state",
    async run() {
      for (const refreshMode of ["background", "on-message"] as const) {
        const { room } = factory({ refreshMode });
        const first = await authenticateAndJoin(room, "connection-1");
        const second = await authenticateAndJoin(room, "connection-2");
        second.sent.length = 0;
        await room.leave(first);
        checkEqual(
          framesOfType(second, PRESENCE_FRAME.Leave).length,
          1,
          `expected exactly one Leave in ${refreshMode} mode`,
        );
      }
    },
  },
  {
    name: "a post-deadline frame in background mode still refreshes the heartbeat",
    async run() {
      const { room, sessions, store } = factory({ refreshMode: "background" });
      const identity = { name: "User 1", userId: "user-1" };
      sessions.authorizeImpl = async () => identity;
      sessions.refreshImpl = async () => identity;

      // Resume a peer with an already-expired heartbeat
      const peer = createRecordingPresencePeer("connection-1");
      const pastTime = Date.now() - 1000; // 1 second in the past
      await room.resume(peer, {
        connectionId: "connection-1",
        credential: { kind: "access-token", token: "t" },
        heartbeatExpiresAt: pastTime, // Already expired!
        identity,
        joined: true,
        rateLimit: null,
      });
      await store.setMember(
        ROOM_ID,
        {
          clock: 0,
          connectionId: "connection-1",
          name: identity.name,
          userId: identity.userId,
        },
        60_000,
      );

      // Send a heartbeat frame after the deadline
      peer.sent.length = 0;
      await room.receive(
        peer,
        heartbeatWire(ROOM_ID, "connection-1", "ping-revival"),
      );

      // Assert that the peer remains open and receives the heartbeat acknowledgement
      checkEqual(
        peer.closes.length,
        0,
        "expected peer to remain open after receiving heartbeat frame",
      );
      const acks = framesOfType(peer, PRESENCE_FRAME.HeartbeatAck);
      checkEqual(
        acks.length,
        1,
        "expected peer to receive heartbeat acknowledgement",
      );
      const ack = acks[0] as { payload: { pingId: string } };
      checkEqual(
        ack.payload.pingId,
        "ping-revival",
        "expected the pingId to be echoed",
      );
    },
  },
  {
    name: "a post-deadline frame in on-message mode rearms before sweep",
    async run() {
      const { room, sessions } = factory({ refreshMode: "on-message" });
      const identity1 = { name: "User 1", userId: "user-1" };
      const identity2 = { name: "User 2", userId: "user-2" };
      sessions.authorizeImpl = async (req) => {
        if (req.userId === "user-1") return identity1;
        if (req.userId === "user-2") return identity2;
        return null;
      };
      sessions.refreshImpl = async (req) => {
        if (req.session.identity.userId === "user-1") return identity1;
        if (req.session.identity.userId === "user-2") return identity2;
        return null;
      };

      // Create first peer with an already-expired heartbeat using resume
      const first = createRecordingPresencePeer("connection-1");
      const pastTime = Date.now() - 1000; // 1 second in the past
      await room.resume(first, {
        connectionId: "connection-1",
        credential: { kind: "access-token", token: "t1" },
        heartbeatExpiresAt: pastTime, // Already expired!
        identity: identity1,
        joined: true,
        rateLimit: null,
      });

      // Create second peer normally
      const second = await authenticateAndJoin(room, "connection-2", "user-2");

      // When second peer sends a message, it will sweep and should close first peer
      await room.receive(
        second,
        heartbeatWire(ROOM_ID, "connection-2", "ping-after-deadline"),
      );

      // The sweep triggered by second's message should have closed first
      checkEqual(
        first.closes[0]?.code,
        1001,
        "expected first peer to be closed by sweep",
      );
      checkEqual(
        second.closes.length,
        0,
        "expected calling peer to remain open after triggering sweep",
      );
    },
  },
];
