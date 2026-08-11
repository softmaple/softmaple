import {
  BLOCK_MARKER,
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  BOOTSTRAP_TIMESTAMP,
} from "@softmaple/block-model";
import {
  COLLAB_ACCESS_MODE,
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  parseServerCollabMessage,
  type ClientCollabMessage,
  type ServerCollabMessage,
} from "@softmaple/collab-protocol";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeDocumentId } from "../src/document-id";

const ORIGIN = "https://app.example";
const TEST_BATCH = {
  schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
  batchId: BOOTSTRAP_BATCH_ID,
  parentVersion: [],
  events: [
    {
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      id: BOOTSTRAP_EVENT_ID,
      parentVersion: [],
      timestamp: BOOTSTRAP_TIMESTAMP,
      operation: { type: "insert" as const, index: 0, text: BLOCK_MARKER },
      effect: {
        type: "bootstrap" as const,
        blockId: BOOTSTRAP_BLOCK_ID,
        fields: {
          type: "paragraph",
          parentId: null,
          language: null,
          theme: null,
          start: null,
          value: null,
          checked: null,
        },
      },
    },
  ],
} as const;

class TestSocket {
  private readonly messages: ServerCollabMessage[] = [];
  private readonly waiters: Array<(message: ServerCollabMessage) => void> = [];

  constructor(readonly socket: WebSocket) {
    socket.accept();
    socket.addEventListener("message", (event) => {
      const raw =
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data);
      const message = parseServerCollabMessage(JSON.parse(raw));
      const waiter = this.waiters.shift();
      if (waiter === undefined) this.messages.push(message);
      else waiter(message);
    });
  }

  send(message: ClientCollabMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  next(): Promise<ServerCollabMessage> {
    const queued = this.messages.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    if (this.socket.readyState < 2) this.socket.close(1000, "Test complete");
  }
}

const sockets: TestSocket[] = [];

const connect = async (): Promise<TestSocket> => {
  const response = await exports.default.fetch(
    new Request("https://collab.example/collab/document", {
      headers: { Origin: ORIGIN, Upgrade: "websocket" },
    }),
  );
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const client = new TestSocket(response.webSocket!);
  sockets.push(client);
  return client;
};

const authenticate = async (
  socket: TestSocket,
  documentId: string,
  sessionId: string,
): Promise<ServerCollabMessage> => {
  socket.send({
    protocolVersion: COLLAB_PROTOCOL_VERSION,
    type: COLLAB_MESSAGE_TYPE.Auth,
    credential: { kind: "access-token", token: "test-token" },
    documentId,
    sessionId,
  });
  return socket.next();
};

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

describe("Cloudflare DocumentRoomDO", () => {
  it("routes one normalized document identity to one Durable Object", () => {
    const raw = "{00000000000040008000000000000011}";
    const normalized = normalizeDocumentId(raw);
    expect(normalized).toBe("00000000-0000-4000-8000-000000000011");
    const first = env.DOCUMENT_ROOMS.idFromName(normalized!);
    const second = env.DOCUMENT_ROOMS.idFromName(normalized!);
    const other = env.DOCUMENT_ROOMS.idFromName(
      "00000000-0000-4000-8000-000000000012",
    );
    expect(first.equals(second)).toBe(true);
    expect(first.equals(other)).toBe(false);
  });

  it("authenticates, repairs, commits, acks, and fans out to two clients", async () => {
    const documentId = "00000000-0000-4000-8000-000000000021";
    const author = await connect();
    const peer = await connect();

    await expect(
      authenticate(author, documentId, "author-session"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId,
      canWrite: true,
    });
    await expect(
      authenticate(peer, documentId, "peer-session"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId,
      canWrite: true,
    });

    peer.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId: "before-edit",
      afterCursor: "0",
    });
    await expect(peer.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.RepairResponse,
      requestId: "before-edit",
      batches: [],
      complete: true,
      nextCursor: "0",
    });

    author.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [TEST_BATCH],
    });
    await expect(author.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.DurableAck,
      batchIds: [BOOTSTRAP_BATCH_ID],
    });
    await expect(author.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [TEST_BATCH],
    });
    await expect(peer.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [TEST_BATCH],
    });

    peer.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId: "after-edit",
      afterCursor: "0",
    });
    await expect(peer.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.RepairResponse,
      requestId: "after-edit",
      batches: [TEST_BATCH],
      complete: true,
      nextCursor: "1",
    });
  });

  it("preserves public read-only collaboration", async () => {
    const documentId = "00000000-0000-4000-8000-000000000031";
    const reader = await connect();
    reader.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Auth,
      credential: { kind: "public" },
      documentId,
      sessionId: "public-session",
    });
    await expect(reader.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      accessMode: COLLAB_ACCESS_MODE.Public,
      documentId,
      canWrite: false,
      userId: null,
      role: null,
    });

    reader.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [TEST_BATCH],
    });
    await expect(reader.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.Forbidden,
      retryable: false,
    });
  });

  it("rejects an untrusted browser origin before upgrading", async () => {
    const response = await exports.default.fetch(
      new Request("https://collab.example/collab/document", {
        headers: {
          Origin: "https://evil.example",
          Upgrade: "websocket",
        },
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden origin",
    });
  });
});
