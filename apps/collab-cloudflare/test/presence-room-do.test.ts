import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
  WS_MESSAGE,
} from "@softmaple/awareness/protocol";
import {
  evictAllDurableObjects,
  evictDurableObject,
  runInDurableObject,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeDocumentId } from "../src/document-id";
import {
  readMemoryPresenceSessionAudit,
  setMemoryPresenceAccessRevoked,
} from "./memory-presence-backend";

const ORIGIN = "https://app.example";
const TEST_USER_ID = "00000000-0000-4000-8000-000000000002";
const TEST_TOKEN = "test-token";

interface PresenceWireFrame {
  readonly type: string;
  readonly roomId: string;
  readonly senderId: string;
  readonly timestamp: number;
  readonly payload?: unknown;
}

interface TestSocketClose {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

class TestPresenceSocket {
  private readonly closes: TestSocketClose[] = [];
  private readonly closeWaiters: Array<(event: TestSocketClose) => void> = [];
  private readonly messages: PresenceWireFrame[] = [];
  private readonly waiters: Array<(message: PresenceWireFrame) => void> = [];

  constructor(readonly socket: WebSocket) {
    socket.accept();
    socket.addEventListener("message", (event) => {
      const raw =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data);
      const message = JSON.parse(raw) as PresenceWireFrame;
      const waiter = this.waiters.shift();
      if (waiter === undefined) this.messages.push(message);
      else waiter(message);
    });
    socket.addEventListener("close", (event) => {
      const close = {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      };
      const waiter = this.closeWaiters.shift();
      if (waiter === undefined) this.closes.push(close);
      else waiter(close);
    });
  }

  send(frame: {
    readonly type: string;
    readonly roomId: string;
    readonly senderId: string;
    readonly payload?: unknown;
  }): void {
    this.socket.send(JSON.stringify({ ...frame, timestamp: Date.now() }));
  }

  next(): Promise<PresenceWireFrame> {
    const queued = this.messages.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  closed(): Promise<TestSocketClose> {
    const queued = this.closes.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.closeWaiters.push(resolve));
  }

  close(): void {
    if (this.socket.readyState < 2) this.socket.close(1000, "Test complete");
  }
}

const sockets: TestPresenceSocket[] = [];

const connect = async (roomId: string): Promise<TestPresenceSocket> => {
  const response = await exports.default.fetch(
    new Request(`https://collab.example/collab/presence?roomId=${roomId}`, {
      headers: { Origin: ORIGIN, Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const client = new TestPresenceSocket(response.webSocket!);
  sockets.push(client);
  return client;
};

const authPayload = (
  connectionId: string,
  overrides: Partial<{
    token: string;
    protocolVersion: unknown;
    capabilities: unknown;
    userId: unknown;
  }> = {},
) => ({
  capabilities: PRESENCE_CAPABILITIES,
  connectionId,
  protocolVersion: PRESENCE_PROTOCOL_VERSION,
  token: TEST_TOKEN,
  userId: TEST_USER_ID,
  ...overrides,
});

const authenticateAndJoin = async (
  socket: TestPresenceSocket,
  roomId: string,
  connectionId: string,
): Promise<void> => {
  socket.send({
    payload: authPayload(connectionId),
    roomId,
    senderId: connectionId,
    type: WS_MESSAGE.AUTH,
  });
  await expect(socket.next()).resolves.toMatchObject({
    type: WS_MESSAGE.AUTH_OK,
  });
  socket.send({ roomId, senderId: connectionId, type: WS_MESSAGE.JOIN });
};

afterEach(async () => {
  const closing = sockets.splice(0).flatMap((socket) => {
    if (socket.socket.readyState >= WebSocket.CLOSING) return [];
    const closed = socket.closed();
    socket.close();
    return [closed];
  });
  await Promise.all(closing);
  await evictAllDurableObjects({ webSockets: "close" });
});

describe("Cloudflare PresenceRoomDO", () => {
  it("routes one normalized room id to one Durable Object", () => {
    const raw = "{00000000000040008000000000000011}";
    const normalized = normalizeDocumentId(raw);
    expect(normalized).toBe("00000000-0000-4000-8000-000000000011");
    const first = env.PRESENCE_ROOMS.idFromName(normalized!);
    const second = env.PRESENCE_ROOMS.idFromName(normalized!);
    const other = env.PRESENCE_ROOMS.idFromName(
      "00000000-0000-4000-8000-000000000012",
    );
    expect(first.equals(second)).toBe(true);
    expect(first.equals(other)).toBe(false);
  });

  it("rejects an untrusted browser origin before upgrading", async () => {
    const response = await exports.default.fetch(
      new Request(
        "https://collab.example/collab/presence?roomId=00000000-0000-4000-8000-000000000021",
        { headers: { Origin: "https://evil.example", Upgrade: "websocket" } },
      ),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden origin",
    });
  });

  it("rejects a missing or invalid roomId before upgrading", async () => {
    const missing = await exports.default.fetch(
      new Request("https://collab.example/collab/presence", {
        headers: { Origin: ORIGIN, Upgrade: "websocket" },
      }),
    );
    expect(missing.status).toBe(400);

    const invalid = await exports.default.fetch(
      new Request("https://collab.example/collab/presence?roomId=not-a-uuid", {
        headers: { Origin: ORIGIN, Upgrade: "websocket" },
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("authenticates, joins, syncs, updates, heartbeats, and leaves with fan-out to both peers", async () => {
    const roomId = "00000000-0000-4000-8000-000000000031";
    const author = await connect(roomId);
    const peer = await connect(roomId);

    await authenticateAndJoin(author, roomId, "connection-author");
    await expect(author.next()).resolves.toMatchObject({
      type: WS_MESSAGE.JOIN,
      senderId: "connection-author",
    });

    await authenticateAndJoin(peer, roomId, "connection-peer");
    // Peer's own Join loops back to itself…
    await expect(peer.next()).resolves.toMatchObject({
      type: WS_MESSAGE.JOIN,
      senderId: "connection-peer",
    });
    // …and fans out to the already-joined author.
    await expect(author.next()).resolves.toMatchObject({
      type: WS_MESSAGE.JOIN,
      senderId: "connection-peer",
    });

    peer.send({
      roomId,
      senderId: "connection-peer",
      type: WS_MESSAGE.PRESENCE_SYNC,
    });
    const sync = await peer.next();
    expect(sync.type).toBe(WS_MESSAGE.PRESENCE_SYNC_RESPONSE);
    const users = (
      sync.payload as { users: ReadonlyArray<{ connectionId: string }> }
    ).users;
    expect(users.map((user) => user.connectionId).toSorted()).toEqual([
      "connection-author",
      "connection-peer",
    ]);

    author.send({
      payload: {
        clock: 1,
        connectionId: "connection-author",
        updates: { cursor: { blockId: "b1", offset: 3 } },
        userId: TEST_USER_ID,
      },
      roomId,
      senderId: "connection-author",
      type: WS_MESSAGE.PRESENCE_UPDATE,
    });
    await expect(author.next()).resolves.toMatchObject({
      type: WS_MESSAGE.PRESENCE_UPDATE,
      senderId: "connection-author",
    });
    await expect(peer.next()).resolves.toMatchObject({
      type: WS_MESSAGE.PRESENCE_UPDATE,
      senderId: "connection-author",
    });

    peer.send({
      payload: { pingId: "ping-1" },
      roomId,
      senderId: "connection-peer",
      type: WS_MESSAGE.HEARTBEAT,
    });
    await expect(peer.next()).resolves.toMatchObject({
      type: WS_MESSAGE.HEARTBEAT_ACK,
      payload: { pingId: "ping-1" },
    });

    const peerClosed = peer.closed();
    peer.send({ roomId, senderId: "connection-peer", type: WS_MESSAGE.LEAVE });
    await expect(peerClosed).resolves.toMatchObject({ code: 1000 });
    await expect(author.next()).resolves.toMatchObject({
      type: WS_MESSAGE.LEAVE,
      senderId: "connection-peer",
    });
  });

  it("closes 1008 on a room-id mismatch before authentication", async () => {
    const roomId = "00000000-0000-4000-8000-000000000041";
    const socket = await connect(roomId);
    const closed = socket.closed();
    socket.send({
      roomId: "00000000-0000-4000-8000-000000000099",
      senderId: "connection-1",
      type: WS_MESSAGE.JOIN,
    });
    await expect(closed).resolves.toMatchObject({
      code: 1008,
      reason: "Presence room mismatch",
    });
  });

  it("restores an attached peer, keeps its fan-out working, and schedules a liveness alarm", async () => {
    const roomId = "00000000-0000-4000-8000-000000000051";
    const author = await connect(roomId);
    const peer = await connect(roomId);
    await authenticateAndJoin(author, roomId, "hibernate-author");
    await author.next();
    await authenticateAndJoin(peer, roomId, "hibernate-peer");
    await peer.next();
    await author.next();

    const stub = env.PRESENCE_ROOMS.getByName(roomId);
    await expect(
      runInDurableObject(stub, (_instance, state) => state.storage.getAlarm()),
    ).resolves.not.toBeNull();

    await evictDurableObject(stub, { webSockets: "hibernate" });
    expect(author.socket.readyState).toBe(WebSocket.OPEN);
    expect(peer.socket.readyState).toBe(WebSocket.OPEN);

    author.send({
      payload: {
        clock: 1,
        connectionId: "hibernate-author",
        updates: { cursor: { blockId: "b1", offset: 1 } },
        userId: TEST_USER_ID,
      },
      roomId,
      senderId: "hibernate-author",
      type: WS_MESSAGE.PRESENCE_UPDATE,
    });
    await expect(peer.next()).resolves.toMatchObject({
      type: WS_MESSAGE.PRESENCE_UPDATE,
      senderId: "hibernate-author",
    });

    // The alarm survives hibernation and is a safe no-op on live peers.
    await runInDurableObject(stub, (instance) => instance.alarm());
    expect(author.socket.readyState).toBe(WebSocket.OPEN);
    expect(peer.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("revalidates and revokes an attached session when hibernation ends", async () => {
    const roomId = "00000000-0000-4000-8000-000000000061";
    const author = await connect(roomId);
    await authenticateAndJoin(author, roomId, "revoked-session");
    await author.next();

    const stub = env.PRESENCE_ROOMS.getByName(roomId);
    await runInDurableObject(stub, (_instance, state) =>
      setMemoryPresenceAccessRevoked(state.storage, true),
    );
    const closed = author.closed();
    await evictDurableObject(stub, { webSockets: "hibernate" });
    author.send({
      roomId,
      senderId: "revoked-session",
      type: WS_MESSAGE.PRESENCE_SYNC,
    });

    await expect(closed).resolves.toMatchObject({ code: 1008 });
    const audit = await runInDurableObject(stub, (_instance, state) =>
      readMemoryPresenceSessionAudit(state.storage),
    );
    expect(audit.refreshes).toEqual([
      expect.objectContaining({
        connectionId: "revoked-session",
        credential: { kind: "access-token", token: TEST_TOKEN },
      }),
    ]);
  });
});
