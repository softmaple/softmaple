// `PresenceRoomDO` must share no capability instance or cross-stub call with
// `DocumentRoomDO` (see docs/design/collaboration-runtime.md's "Presence
// room" section). These tests prove that at the runtime boundary: the same
// room id is live in both objects at once with no cross-talk, and revoking
// access in one backend never revokes the other.
import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  parseServerCollabMessage,
  type ServerCollabMessage,
} from "@softmaple/collab-protocol";
import {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
  WS_MESSAGE,
} from "@softmaple/awareness/protocol";
import { evictAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { setMemoryAuthenticatedAccessRevoked } from "./memory-backend";
import { setMemoryPresenceAccessRevoked } from "./memory-presence-backend";

const ORIGIN = "https://app.example";

const documentSockets: WebSocket[] = [];
const presenceSockets: WebSocket[] = [];

const connectDocument = async (): Promise<WebSocket> => {
  const response = await exports.default.fetch(
    new Request("https://collab.example/collab/document", {
      headers: { Origin: ORIGIN, Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  documentSockets.push(socket);
  return socket;
};

const connectPresence = async (roomId: string): Promise<WebSocket> => {
  const response = await exports.default.fetch(
    new Request(`https://collab.example/collab/presence?roomId=${roomId}`, {
      headers: { Origin: ORIGIN, Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  presenceSockets.push(socket);
  return socket;
};

const nextMessage = <T>(
  socket: WebSocket,
  parse: (raw: unknown) => T,
): Promise<T> =>
  new Promise((resolve) => {
    socket.addEventListener(
      "message",
      (event) => {
        const raw =
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data);
        resolve(parse(JSON.parse(raw)));
      },
      { once: true },
    );
  });

const nextClose = (
  socket: WebSocket,
): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => {
    socket.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
      { once: true },
    );
  });

const authenticateDocument = async (
  socket: WebSocket,
  roomId: string,
): Promise<ServerCollabMessage> => {
  const ready = nextMessage(socket, parseServerCollabMessage);
  socket.send(
    JSON.stringify({
      credential: { kind: "access-token", token: "test-token" },
      documentId: roomId,
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      sessionId: "isolation-document-session",
      type: COLLAB_MESSAGE_TYPE.Auth,
    }),
  );
  return ready;
};

const authenticatePresence = async (
  socket: WebSocket,
  roomId: string,
): Promise<void> => {
  const authOk = nextMessage(socket, (raw) => raw as { type: string });
  socket.send(
    JSON.stringify({
      payload: {
        capabilities: PRESENCE_CAPABILITIES,
        connectionId: "isolation-presence-connection",
        protocolVersion: PRESENCE_PROTOCOL_VERSION,
        token: "test-token",
        userId: "00000000-0000-4000-8000-000000000002",
      },
      roomId,
      senderId: "isolation-presence-connection",
      timestamp: Date.now(),
      type: WS_MESSAGE.AUTH,
    }),
  );
  await expect(authOk).resolves.toMatchObject({ type: WS_MESSAGE.AUTH_OK });
};

afterEach(async () => {
  const closing = [...documentSockets.splice(0), ...presenceSockets.splice(0)]
    .filter((socket) => socket.readyState < WebSocket.CLOSING)
    .map((socket) => {
      const closed = nextClose(socket);
      socket.close(1000, "Test complete");
      return closed;
    });
  await Promise.all(closing);
  await evictAllDurableObjects({ webSockets: "close" });
});

describe("DocumentRoomDO / PresenceRoomDO isolation", () => {
  it("keeps a document room and a presence room live for the same id with no cross-talk", async () => {
    const roomId = "00000000-0000-4000-8000-0000000000a1";
    const documentSocket = await connectDocument();
    const presenceSocket = await connectPresence(roomId);

    await expect(
      authenticateDocument(documentSocket, roomId),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId: roomId,
    });
    await authenticatePresence(presenceSocket, roomId);

    // Neither room's stub observes the other's capability instances: both
    // stay open and independently addressable for the same room id.
    const documentStub = env.DOCUMENT_ROOMS.getByName(roomId);
    const presenceStub = env.PRESENCE_ROOMS.getByName(roomId);
    await expect(
      runInDurableObject(
        documentStub,
        (_instance, state) => state.getWebSockets().length,
      ),
    ).resolves.toBe(1);
    await expect(
      runInDurableObject(
        presenceStub,
        (_instance, state) => state.getWebSockets().length,
      ),
    ).resolves.toBe(1);

    expect(documentSocket.readyState).toBe(WebSocket.OPEN);
    expect(presenceSocket.readyState).toBe(WebSocket.OPEN);
  });

  it("revoking document access does not revoke presence access for the same room id", async () => {
    const roomId = "00000000-0000-4000-8000-0000000000a2";
    const documentSocket = await connectDocument();
    const presenceSocket = await connectPresence(roomId);
    await authenticateDocument(documentSocket, roomId);
    await authenticatePresence(presenceSocket, roomId);

    await runInDurableObject(
      env.DOCUMENT_ROOMS.getByName(roomId),
      (_instance, state) =>
        setMemoryAuthenticatedAccessRevoked(state.storage, true),
    );

    // The presence room's own backend was never touched, so a Sync still works.
    const syncResponse = nextMessage(
      presenceSocket,
      (raw) => raw as { type: string },
    );
    presenceSocket.send(
      JSON.stringify({
        roomId,
        senderId: "isolation-presence-connection",
        timestamp: Date.now(),
        type: WS_MESSAGE.PRESENCE_SYNC,
      }),
    );
    await expect(syncResponse).resolves.toMatchObject({
      type: WS_MESSAGE.PRESENCE_SYNC_RESPONSE,
    });
    expect(presenceSocket.readyState).toBe(WebSocket.OPEN);
  });

  it("revoking presence access does not revoke document access for the same room id", async () => {
    const roomId = "00000000-0000-4000-8000-0000000000a3";
    const documentSocket = await connectDocument();
    const presenceSocket = await connectPresence(roomId);
    await authenticateDocument(documentSocket, roomId);
    await authenticatePresence(presenceSocket, roomId);

    await runInDurableObject(
      env.PRESENCE_ROOMS.getByName(roomId),
      (_instance, state) => setMemoryPresenceAccessRevoked(state.storage, true),
    );

    // The document room's own backend was never touched, so repair still works.
    const repairResponse = nextMessage(
      documentSocket,
      parseServerCollabMessage,
    );
    documentSocket.send(
      JSON.stringify({
        afterCursor: "0",
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        requestId: "isolation-repair",
        type: COLLAB_MESSAGE_TYPE.RepairRequest,
      }),
    );
    await expect(repairResponse).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.RepairResponse,
      requestId: "isolation-repair",
    });
    expect(documentSocket.readyState).toBe(WebSocket.OPEN);
  });

  it("closing the document socket leaves the presence socket for the same id unaffected", async () => {
    const roomId = "00000000-0000-4000-8000-0000000000a4";
    const documentSocket = await connectDocument();
    const presenceSocket = await connectPresence(roomId);
    await authenticateDocument(documentSocket, roomId);
    await authenticatePresence(presenceSocket, roomId);

    const documentClosed = nextClose(documentSocket);
    documentSocket.close(1000, "Client done");
    await expect(documentClosed).resolves.toMatchObject({ code: 1000 });

    const syncResponse = nextMessage(
      presenceSocket,
      (raw) => raw as { type: string },
    );
    presenceSocket.send(
      JSON.stringify({
        roomId,
        senderId: "isolation-presence-connection",
        timestamp: Date.now(),
        type: WS_MESSAGE.PRESENCE_SYNC,
      }),
    );
    await expect(syncResponse).resolves.toMatchObject({
      type: WS_MESSAGE.PRESENCE_SYNC_RESPONSE,
    });
  });
});
