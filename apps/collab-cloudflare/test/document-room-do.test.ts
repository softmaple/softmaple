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
import { DOCUMENT_SESSION_END_REASON } from "@softmaple/collab-runtime";
import {
  evictAllDurableObjects,
  evictDurableObject,
  runInDurableObject,
} from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PERSISTED_AUTH_BYTES } from "../src/constants";
import { normalizeDocumentId } from "../src/document-id";
import type { DocumentRoomDO } from "../src/document-room-do";
import {
  parseDocumentWebSocketAttachment,
  resumeStateFromAttachment,
} from "../src/websocket-attachment";
import {
  readMemorySessionAudit,
  setMemoryAuthenticatedAccessRevoked,
} from "./memory-backend";

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

const POST_WAKE_BATCH = {
  schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
  batchId: "test:post-wake:event",
  parentVersion: [BOOTSTRAP_EVENT_ID],
  events: [
    {
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      id: "test:post-wake:event",
      parentVersion: [BOOTSTRAP_EVENT_ID],
      timestamp: 1,
      operation: { type: "insert" as const, index: 1, text: "awake" },
      effect: {
        type: "text-insert" as const,
        blockId: BOOTSTRAP_BLOCK_ID,
        text: "awake",
      },
    },
  ],
} as const;

interface TestSocketClose {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

class TestSocket {
  private readonly closes: TestSocketClose[] = [];
  private readonly closeWaiters: Array<(event: TestSocketClose) => void> = [];
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

  send(message: ClientCollabMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  next(): Promise<ServerCollabMessage> {
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

type DocumentRoomStub = DurableObjectStub<DocumentRoomDO>;

const attachmentSnapshots = async (stub: DocumentRoomStub) =>
  runInDurableObject(stub, (_instance, state) =>
    state
      .getWebSockets()
      .map((socket) => {
        const attachment = parseDocumentWebSocketAttachment(
          socket.deserializeAttachment(),
        );
        if (attachment === null || attachment.phase !== "authenticated") {
          throw new Error("Expected an authenticated WebSocket attachment");
        }
        const resumed = resumeStateFromAttachment(attachment);
        if (resumed === null) {
          throw new Error("Expected resumable WebSocket attachment metadata");
        }
        return {
          accessMode: resumed.session.accessMode,
          actorId: resumed.session.actorId,
          canWrite: resumed.session.canWrite,
          credential: resumed.credential,
          documentId: attachment.documentId,
          peerId: attachment.peerId,
          protocolVersion: resumed.session.protocolVersion,
          quota: attachment.quota,
          role: resumed.session.role,
          sessionId: resumed.session.sessionId,
          validatedAt: attachment.validatedAt,
        };
      })
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
  );

const sessionAudit = (stub: DocumentRoomStub) =>
  runInDurableObject(stub, (_instance, state) =>
    readMemorySessionAudit(state.storage),
  );

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

  it("rejects authentication metadata that cannot fit in an attachment", async () => {
    const documentId = "00000000-0000-4000-8000-000000000032";
    const client = await connect();
    const closed = client.closed();
    client.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Auth,
      credential: { kind: "public" },
      documentId,
      sessionId: "x".repeat(MAX_PERSISTED_AUTH_BYTES),
    });

    await expect(closed).resolves.toMatchObject({
      code: 1009,
      reason: "Authentication metadata is too large",
    });
    const audit = await sessionAudit(env.DOCUMENT_ROOMS.getByName(documentId));
    expect(audit.authorizations).toEqual([]);
  });

  it("restores every attached peer and durable history after hibernation", async () => {
    const documentId = "00000000-0000-4000-8000-000000000041";
    const author = await connect();
    const reader = await connect();

    await expect(
      authenticate(author, documentId, "hibernate-author"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      accessMode: COLLAB_ACCESS_MODE.Authenticated,
      documentId,
      canWrite: true,
    });
    reader.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Auth,
      credential: { kind: "public" },
      documentId,
      sessionId: "hibernate-reader",
    });
    await expect(reader.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      accessMode: COLLAB_ACCESS_MODE.Public,
      documentId,
      canWrite: false,
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
    await expect(reader.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [TEST_BATCH],
    });

    const stub = env.DOCUMENT_ROOMS.getByName(documentId);
    const before = await attachmentSnapshots(stub);
    expect(before).toEqual([
      expect.objectContaining({
        accessMode: COLLAB_ACCESS_MODE.Authenticated,
        canWrite: true,
        credential: { kind: "access-token", token: "test-token" },
        documentId,
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        role: "EDITOR",
        sessionId: "hibernate-author",
      }),
      expect.objectContaining({
        accessMode: COLLAB_ACCESS_MODE.Public,
        actorId: null,
        canWrite: false,
        credential: { kind: "public" },
        documentId,
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        role: null,
        sessionId: "hibernate-reader",
      }),
    ]);

    await evictDurableObject(stub, { webSockets: "hibernate" });
    expect(author.socket.readyState).toBe(WebSocket.OPEN);
    expect(reader.socket.readyState).toBe(WebSocket.OPEN);

    reader.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId: "wake-repair",
      afterCursor: "0",
    });
    await expect(reader.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.RepairResponse,
      requestId: "wake-repair",
      batches: [TEST_BATCH],
      complete: true,
      nextCursor: "1",
    });

    author.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [POST_WAKE_BATCH],
    });
    await expect(author.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.DurableAck,
      batchIds: [POST_WAKE_BATCH.batchId],
    });
    await expect(author.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [POST_WAKE_BATCH],
    });
    await expect(reader.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [POST_WAKE_BATCH],
    });

    reader.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId: "post-wake-repair",
      afterCursor: "1",
    });
    await expect(reader.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.RepairResponse,
      requestId: "post-wake-repair",
      batches: [POST_WAKE_BATCH],
      complete: true,
      nextCursor: "2",
    });

    reader.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [POST_WAKE_BATCH],
    });
    await expect(reader.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.Forbidden,
      retryable: false,
    });

    const after = await attachmentSnapshots(stub);
    expect(
      after.map(({ peerId, sessionId }) => ({ peerId, sessionId })),
    ).toEqual(before.map(({ peerId, sessionId }) => ({ peerId, sessionId })));
    expect(after).toEqual([
      expect.objectContaining({
        accessMode: COLLAB_ACCESS_MODE.Authenticated,
        canWrite: true,
        credential: { kind: "access-token", token: "test-token" },
        documentId,
        role: "EDITOR",
        sessionId: "hibernate-author",
      }),
      expect.objectContaining({
        accessMode: COLLAB_ACCESS_MODE.Public,
        actorId: null,
        canWrite: false,
        credential: { kind: "public" },
        documentId,
        role: null,
        sessionId: "hibernate-reader",
      }),
    ]);
    expect(after[0]!.quota.windowStartedAt).toBe(
      before[0]!.quota.windowStartedAt,
    );
    expect(after[1]!.quota.windowStartedAt).toBe(
      before[1]!.quota.windowStartedAt,
    );
    const audit = await sessionAudit(stub);
    expect(
      audit.refreshes
        .map(({ peerId, session }) => ({
          peerId,
          sessionId: session.sessionId,
        }))
        .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
    ).toEqual(before.map(({ peerId, sessionId }) => ({ peerId, sessionId })));
  });

  it("revalidates and revokes an attached session when hibernation ends", async () => {
    const documentId = "00000000-0000-4000-8000-000000000051";
    const author = await connect();
    await expect(
      authenticate(author, documentId, "revoked-session"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId,
      canWrite: true,
    });

    const stub = env.DOCUMENT_ROOMS.getByName(documentId);
    await runInDurableObject(stub, (_instance, state) =>
      setMemoryAuthenticatedAccessRevoked(state.storage, true),
    );
    const closed = author.closed();
    await evictDurableObject(stub, { webSockets: "hibernate" });
    author.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId: "revoked-wake",
      afterCursor: "0",
    });

    await expect(closed).resolves.toMatchObject({
      code: 1008,
      reason: "Collaboration access was revoked",
    });
    const audit = await sessionAudit(stub);
    expect(audit.refreshes).toEqual([
      expect.objectContaining({
        credential: { kind: "access-token", token: "test-token" },
        session: expect.objectContaining({ sessionId: "revoked-session" }),
      }),
    ]);
    expect(audit.ends).toEqual([
      expect.objectContaining({
        reason: DOCUMENT_SESSION_END_REASON.AccessRevoked,
        session: expect.objectContaining({ sessionId: "revoked-session" }),
      }),
    ]);
  });

  it("releases runtime resources after WebSocket close and error events", async () => {
    const closeDocumentId = "00000000-0000-4000-8000-000000000061";
    const closing = await connect();
    await expect(
      authenticate(closing, closeDocumentId, "closing-session"),
    ).resolves.toMatchObject({ type: COLLAB_MESSAGE_TYPE.Ready });
    const closeStub = env.DOCUMENT_ROOMS.getByName(closeDocumentId);
    const closedNormally = closing.closed();
    closing.close();
    await expect(closedNormally).resolves.toMatchObject({ code: 1000 });
    await vi.waitFor(async () => {
      await expect(sessionAudit(closeStub)).resolves.toMatchObject({
        ends: [
          expect.objectContaining({
            reason: DOCUMENT_SESSION_END_REASON.PeerLeft,
            session: expect.objectContaining({ sessionId: "closing-session" }),
          }),
        ],
      });
    });

    const errorDocumentId = "00000000-0000-4000-8000-000000000062";
    const failing = await connect();
    await expect(
      authenticate(failing, errorDocumentId, "error-session"),
    ).resolves.toMatchObject({ type: COLLAB_MESSAGE_TYPE.Ready });
    const errorStub = env.DOCUMENT_ROOMS.getByName(errorDocumentId);
    const closedWithError = failing.closed();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runInDurableObject(errorStub, async (instance, state) => {
        const socket = state.getWebSockets()[0];
        if (socket === undefined) throw new Error("Expected a server socket");
        await instance.webSocketError(
          socket,
          new Error("test transport error"),
        );
      });
    } finally {
      errorLog.mockRestore();
    }
    await expect(closedWithError).resolves.toMatchObject({
      code: 1011,
      reason: "Collaboration transport failure",
    });
    await vi.waitFor(async () => {
      await expect(sessionAudit(errorStub)).resolves.toMatchObject({
        ends: [
          expect.objectContaining({
            reason: DOCUMENT_SESSION_END_REASON.PeerLeft,
            session: expect.objectContaining({ sessionId: "error-session" }),
          }),
        ],
      });
    });
  });

  it("removes sockets closed or failed while their room is hibernating", async () => {
    const closeDocumentId = "00000000-0000-4000-8000-000000000071";
    const closing = await connect();
    await expect(
      authenticate(closing, closeDocumentId, "hibernating-close"),
    ).resolves.toMatchObject({ type: COLLAB_MESSAGE_TYPE.Ready });
    const closeStub = env.DOCUMENT_ROOMS.getByName(closeDocumentId);
    await evictDurableObject(closeStub, { webSockets: "hibernate" });
    const closedNormally = closing.closed();
    closing.close();
    await expect(closedNormally).resolves.toMatchObject({ code: 1000 });
    await vi.waitFor(async () => {
      await expect(
        runInDurableObject(
          closeStub,
          (_instance, state) => state.getWebSockets().length,
        ),
      ).resolves.toBe(0);
    });

    const errorDocumentId = "00000000-0000-4000-8000-000000000072";
    const failing = await connect();
    await expect(
      authenticate(failing, errorDocumentId, "hibernating-error"),
    ).resolves.toMatchObject({ type: COLLAB_MESSAGE_TYPE.Ready });
    const errorStub = env.DOCUMENT_ROOMS.getByName(errorDocumentId);
    await evictDurableObject(errorStub, { webSockets: "hibernate" });
    const closedWithError = failing.closed();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runInDurableObject(errorStub, async (instance, state) => {
        const socket = state.getWebSockets()[0];
        if (socket === undefined) throw new Error("Expected a server socket");
        await instance.webSocketError(
          socket,
          new Error("test transport error"),
        );
      });
    } finally {
      errorLog.mockRestore();
    }
    await expect(closedWithError).resolves.toMatchObject({
      code: 1011,
      reason: "Collaboration transport failure",
    });
    await vi.waitFor(async () => {
      await expect(
        runInDurableObject(
          errorStub,
          (_instance, state) => state.getWebSockets().length,
        ),
      ).resolves.toBe(0);
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

  it("rejects a missing browser origin before upgrading", async () => {
    const response = await exports.default.fetch(
      new Request("https://collab.example/collab/document", {
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden origin",
    });
  });
});
