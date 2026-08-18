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
import {
  INITIAL_AUTH_TIMEOUT_MS,
  MAX_PERSISTED_AUTH_BYTES,
} from "../src/constants";
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

const documentSocketUrl = (documentId: string): string => {
  const url = new URL("https://collab.example/collab/document");
  url.searchParams.set("documentId", documentId);
  return url.toString();
};

const upgrade = (documentId: string): Promise<Response> =>
  exports.default.fetch(
    new Request(documentSocketUrl(documentId), {
      headers: { Origin: ORIGIN, Upgrade: "websocket" },
    }),
  );

const connect = async (documentId: string): Promise<TestSocket> => {
  const response = await upgrade(documentId);
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

const attachedSocketCount = (documentId: string): Promise<number> =>
  runInDurableObject(
    env.DOCUMENT_ROOMS.getByName(documentId),
    (_instance, state) => state.getWebSockets().length,
  );

const alarmAt = (stub: DocumentRoomStub): Promise<number | null> =>
  runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());

/**
 * Runs the alarm the way the runtime does — the scheduled alarm is consumed
 * before the handler runs — so whatever `getAlarm()` reports afterwards is
 * exactly what the handler re-armed for itself.
 */
const runAlarm = (stub: DocumentRoomStub): Promise<void> =>
  runInDurableObject(stub, async (instance, state) => {
    await state.storage.deleteAlarm();
    await instance.alarm();
  });

/**
 * Rewinds every unauthenticated socket's accepted-at instant past the
 * deadline. The object enforces the attachment rather than a timer, so a test
 * never has to wait out `INITIAL_AUTH_TIMEOUT_MS`.
 */
const expireAuthDeadlines = (stub: DocumentRoomStub): Promise<number> =>
  runInDurableObject(stub, (_instance, state) => {
    const pending = state.getWebSockets().flatMap((socket) => {
      const attachment = parseDocumentWebSocketAttachment(
        socket.deserializeAttachment(),
      );
      return attachment !== null && attachment.phase === "awaiting-auth"
        ? [{ attachment, socket }]
        : [];
    });
    for (const { attachment, socket } of pending) {
      socket.serializeAttachment({
        ...attachment,
        connectedAt: attachment.connectedAt - INITIAL_AUTH_TIMEOUT_MS - 1,
      });
    }
    return pending.length;
  });

/**
 * Makes the oldest socket still awaiting `Auth` throw from `close()`, the way
 * one in a bad transport state would, and reports how many are pending.
 */
const breakOnePendingClose = (stub: DocumentRoomStub): Promise<number> =>
  runInDurableObject(stub, (_instance, state) => {
    const pending = state.getWebSockets().flatMap((socket) => {
      const attachment = parseDocumentWebSocketAttachment(
        socket.deserializeAttachment(),
      );
      return attachment !== null && attachment.phase === "awaiting-auth"
        ? [{ connectedAt: attachment.connectedAt, socket }]
        : [];
    });
    const oldest = pending.toSorted(
      (left, right) => left.connectedAt - right.connectedAt,
    )[0];
    if (oldest === undefined) {
      throw new Error("Expected a socket awaiting authentication");
    }
    oldest.socket.close = () => {
      throw new Error("test transport refuses to close");
    };
    return pending.length;
  });

/** Undoes `breakOnePendingClose` so teardown does not wait out a 1006. */
const restorePendingCloses = (stub: DocumentRoomStub): Promise<void> =>
  runInDurableObject(stub, (_instance, state) => {
    for (const socket of state.getWebSockets()) {
      Reflect.deleteProperty(socket, "close");
    }
  });

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
    const author = await connect(documentId);
    const peer = await connect(documentId);

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
    const reader = await connect(documentId);
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
    const client = await connect(documentId);
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
    const author = await connect(documentId);
    const reader = await connect(documentId);

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

    // Nothing routes again after this point: no upgrade request, no Worker
    // state. The woken object rebinds itself to this document purely from the
    // routed id persisted in each restored socket's attachment.
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
    const author = await connect(documentId);
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
    const closing = await connect(closeDocumentId);
    await expect(
      authenticate(closing, closeDocumentId, "closing-session"),
    ).resolves.toMatchObject({ type: COLLAB_MESSAGE_TYPE.Ready });
    const closeStub = env.DOCUMENT_ROOMS.getByName(closeDocumentId);
    const closedNormally = closing.closed();
    closing.close();
    // A clean 1000/`wasClean` close proves the object answers the client's
    // close frame itself now that no Worker socket sits in front of it.
    await expect(closedNormally).resolves.toMatchObject({
      code: 1000,
      reason: "Test complete",
      wasClean: true,
    });
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
    const failing = await connect(errorDocumentId);
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
    const closing = await connect(closeDocumentId);
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
    const failing = await connect(errorDocumentId);
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
      new Request(documentSocketUrl("00000000-0000-4000-8000-000000000081"), {
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
      new Request(documentSocketUrl("00000000-0000-4000-8000-000000000082"), {
        headers: { Upgrade: "websocket" },
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden origin",
    });
  });

  it("routes the upgrade into the Durable Object named by the document id", async () => {
    const documentId = "00000000-0000-4000-8000-000000000091";
    const otherDocumentId = "00000000-0000-4000-8000-000000000092";
    const client = await connect(documentId);
    await expect(
      authenticate(client, documentId, "routed-session"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId,
    });

    await expect(attachedSocketCount(documentId)).resolves.toBe(1);
    await expect(attachedSocketCount(otherDocumentId)).resolves.toBe(0);
  });

  it("routes every spelling of one document id to the same Durable Object", async () => {
    const documentId = "00000000-0000-4000-8000-000000000093";
    const client = await connect(`{${documentId.toUpperCase()}}`);
    await expect(
      authenticate(client, documentId, "normalized-session"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId,
    });

    await expect(attachedSocketCount(documentId)).resolves.toBe(1);
  });

  it("rejects a missing or malformed document id before upgrading", async () => {
    const missing = await exports.default.fetch(
      new Request("https://collab.example/collab/document", {
        headers: { Origin: ORIGIN, Upgrade: "websocket" },
      }),
    );
    expect(missing.status).toBe(400);
    expect(missing.webSocket).toBeNull();
    await expect(missing.json()).resolves.toEqual({
      error: "Invalid document id",
    });

    const malformed = await exports.default.fetch(
      new Request(documentSocketUrl("not-a-uuid"), {
        headers: { Origin: ORIGIN, Upgrade: "websocket" },
      }),
    );
    expect(malformed.status).toBe(400);
    expect(malformed.webSocket).toBeNull();
    await expect(malformed.json()).resolves.toEqual({
      error: "Invalid document id",
    });
  });

  it("never creates a collaboration socket for a plain HTTP request", async () => {
    const documentId = "00000000-0000-4000-8000-000000000094";
    const withoutUpgrade = await exports.default.fetch(
      new Request(documentSocketUrl(documentId), {
        headers: { Origin: ORIGIN },
      }),
    );
    expect(withoutUpgrade.status).toBe(426);
    expect(withoutUpgrade.webSocket).toBeNull();

    const posted = await exports.default.fetch(
      new Request(documentSocketUrl(documentId), {
        headers: { Origin: ORIGIN },
        method: "POST",
      }),
    );
    expect(posted.status).toBe(405);
    expect(posted.webSocket).toBeNull();

    await expect(attachedSocketCount(documentId)).resolves.toBe(0);
  });

  it("requires Auth as the first collaboration message", async () => {
    const documentId = "00000000-0000-4000-8000-0000000000b1";
    const client = await connect(documentId);
    client.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [TEST_BATCH],
    });
    await expect(client.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.AuthenticationFailed,
      retryable: false,
    });
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    const stub = env.DOCUMENT_ROOMS.getByName(documentId);
    await expect(sessionAudit(stub)).resolves.toMatchObject({
      authorizations: [],
    });

    // The socket stays usable: the same connection can still authenticate.
    await expect(
      authenticate(client, documentId, "late-auth-session"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId,
    });
  });

  it("answers a malformed first message without dropping the connection", async () => {
    const documentId = "00000000-0000-4000-8000-0000000000b5";
    const client = await connect(documentId);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      client.socket.send("{not json");
      await expect(client.next()).resolves.toMatchObject({
        type: COLLAB_MESSAGE_TYPE.Error,
        code: COLLAB_ERROR_CODE.InvalidMessage,
        retryable: false,
      });
    } finally {
      errorLog.mockRestore();
    }
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    await expect(
      authenticate(client, documentId, "recovered-session"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId,
    });
  });

  it("releases a connection that disconnects before authenticating", async () => {
    const documentId = "00000000-0000-4000-8000-0000000000b6";
    const client = await connect(documentId);
    await expect(attachedSocketCount(documentId)).resolves.toBe(1);

    const closed = client.closed();
    client.close();
    await expect(closed).resolves.toMatchObject({
      code: 1000,
      wasClean: true,
    });
    await vi.waitFor(async () => {
      await expect(attachedSocketCount(documentId)).resolves.toBe(0);
    });
    await expect(
      sessionAudit(env.DOCUMENT_ROOMS.getByName(documentId)),
    ).resolves.toMatchObject({ authorizations: [] });
  });

  it("rejects an Auth message for a document other than the routed one", async () => {
    const routedDocumentId = "00000000-0000-4000-8000-0000000000b2";
    const otherDocumentId = "00000000-0000-4000-8000-0000000000b3";
    const client = await connect(routedDocumentId);
    const closed = client.closed();

    await expect(
      authenticate(client, otherDocumentId, "mismatched-session"),
    ).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.AuthenticationFailed,
      message: "Authentication or document membership failed",
      retryable: false,
    });
    await expect(closed).resolves.toMatchObject({
      code: 1008,
      reason: "Unauthorized",
    });

    // Neither document authorized the credential: the routed object rejected
    // the Auth before its authorization hook, and the object for the named
    // document was never reached at all.
    await expect(
      sessionAudit(env.DOCUMENT_ROOMS.getByName(routedDocumentId)),
    ).resolves.toMatchObject({ authorizations: [] });
    await expect(
      sessionAudit(env.DOCUMENT_ROOMS.getByName(otherDocumentId)),
    ).resolves.toMatchObject({ authorizations: [] });
    await expect(attachedSocketCount(otherDocumentId)).resolves.toBe(0);
  });

  it("rejects an unauthorized credential the same way as a mismatched document", async () => {
    const documentId = "00000000-0000-4000-8000-0000000000b4";
    const client = await connect(documentId);
    const closed = client.closed();
    client.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Auth,
      credential: { kind: "access-token", token: "not-the-test-token" },
      documentId,
      sessionId: "unauthorized-session",
    });

    await expect(client.next()).resolves.toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.AuthenticationFailed,
      message: "Authentication or document membership failed",
      retryable: false,
    });
    await expect(closed).resolves.toMatchObject({
      code: 1008,
      reason: "Unauthorized",
    });

    // Unlike the mismatch above, this credential did reach the authorization
    // hook — the client cannot tell the two rejections apart.
    await expect(
      sessionAudit(env.DOCUMENT_ROOMS.getByName(documentId)),
    ).resolves.toMatchObject({
      authorizations: [
        expect.objectContaining({
          documentId,
          sessionId: "unauthorized-session",
        }),
      ],
    });
  });

  it("closes a socket that never authenticates once its deadline passes", async () => {
    const documentId = "00000000-0000-4000-8000-0000000000c1";
    const authenticated = await connect(documentId);
    await expect(
      authenticate(authenticated, documentId, "deadline-session"),
    ).resolves.toMatchObject({ type: COLLAB_MESSAGE_TYPE.Ready });
    const silent = await connect(documentId);

    // The deadline is armed when the socket is accepted, not when it first
    // sends something — an unauthenticated socket sends nothing by definition.
    const stub = env.DOCUMENT_ROOMS.getByName(documentId);
    const scheduled = await alarmAt(stub);
    expect(scheduled).not.toBeNull();
    expect(scheduled!).toBeLessThanOrEqual(
      Date.now() + INITIAL_AUTH_TIMEOUT_MS,
    );

    // Non-Auth traffic cannot buy more time: the quota window moves with the
    // message, the accepted-at instant the deadline reads does not.
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      silent.socket.send("{not json");
      await expect(silent.next()).resolves.toMatchObject({
        type: COLLAB_MESSAGE_TYPE.Error,
        code: COLLAB_ERROR_CODE.InvalidMessage,
      });
    } finally {
      errorLog.mockRestore();
    }
    await expect(alarmAt(stub)).resolves.toBe(scheduled);

    const closed = silent.closed();
    await expect(expireAuthDeadlines(stub)).resolves.toBe(1);
    await runAlarm(stub);
    await expect(closed).resolves.toMatchObject({
      code: 1008,
      reason: "Authentication timed out",
    });

    // The authenticated peer sharing the room is untouched, and with nothing
    // left awaiting Auth the object re-arms no alarm and hibernates again.
    expect(authenticated.socket.readyState).toBe(WebSocket.OPEN);
    await vi.waitFor(async () => {
      await expect(attachedSocketCount(documentId)).resolves.toBe(1);
    });
    await expect(alarmAt(stub)).resolves.toBeNull();
  });

  it("enforces the authentication deadline on a hibernation-woken object", async () => {
    const documentId = "00000000-0000-4000-8000-0000000000c2";
    const silent = await connect(documentId);
    const stub = env.DOCUMENT_ROOMS.getByName(documentId);
    await expect(expireAuthDeadlines(stub)).resolves.toBe(1);

    const closed = silent.closed();
    await evictDurableObject(stub, { webSockets: "hibernate" });
    expect(silent.socket.readyState).toBe(WebSocket.OPEN);

    // The woken object holds no peer, no room, and no document id in memory,
    // so the deadline it enforces comes entirely from the socket attachment —
    // no room restore and no Supabase call are needed to evict the socket.
    await runAlarm(stub);
    await expect(closed).resolves.toMatchObject({
      code: 1008,
      reason: "Authentication timed out",
    });
    await vi.waitFor(async () => {
      await expect(attachedSocketCount(documentId)).resolves.toBe(0);
    });
    await expect(sessionAudit(stub)).resolves.toMatchObject({
      authorizations: [],
    });
  });

  it("contains a socket that refuses to close and still re-arms", async () => {
    const documentId = "00000000-0000-4000-8000-0000000000c3";
    const expiring = [await connect(documentId), await connect(documentId)];
    const stub = env.DOCUMENT_ROOMS.getByName(documentId);
    await expect(expireAuthDeadlines(stub)).resolves.toBe(2);
    await expect(breakOnePendingClose(stub)).resolves.toBe(2);
    // Connected after the rewind, so this one's deadline is still ahead and
    // it is what the handler has left to re-arm for.
    const pending = await connect(documentId);

    await runAlarm(stub);

    // The failure is contained rather than escaping the sweep. It is also
    // logged, which is asserted only through behavior: this pool does not
    // route a Durable Object's console output to the test's spy. An escaping
    // error would skip the re-arm, and the alarm that fired is already
    // consumed — leaving exactly the "nothing evicts them" case again.
    await vi.waitFor(async () => {
      await expect(attachedSocketCount(documentId)).resolves.toBe(2);
    });
    expect(
      expiring.filter((client) => client.socket.readyState === WebSocket.OPEN),
    ).toHaveLength(1);
    expect(pending.socket.readyState).toBe(WebSocket.OPEN);
    await expect(alarmAt(stub)).resolves.not.toBeNull();
    await restorePendingCloses(stub);
  });
});
