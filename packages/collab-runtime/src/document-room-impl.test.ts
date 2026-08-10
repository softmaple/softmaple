import {
  COLLAB_ACCESS_MODE,
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  type ClientCollabMessage,
  type ServerCollabMessage,
} from "@softmaple/collab-protocol";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_REJECTION_REASON,
  type ConnectionLimiter,
} from "./connection-limiter";
import {
  DEFAULT_DOCUMENT_ROOM_POLICY,
  ROOM_LEAVE_REASON,
  type DocumentRoomScheduler,
  type RoomPeer,
} from "./document-room";
import { createDocumentRoom } from "./document-room-impl";
import type { DocumentAccess, DocumentSessionHooks } from "./document-session";
import {
  DOCUMENT_EVENT_CONFLICT_TYPE,
  DocumentEventConflictError,
  DocumentEventStoreUnavailableError,
  type DocumentEventBatches,
  type DocumentEventPage,
  type DocumentEventStore,
} from "./event-store";
import type {
  CommittedDocumentEvent,
  RoomFanout,
  RoomFanoutHandler,
} from "./room-fanout";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";

const BATCH = {
  schemaVersion: 1,
  batchId: "bootstrap",
  parentVersion: [],
  events: [
    {
      schemaVersion: 1,
      id: "bootstrap-event",
      parentVersion: [],
      timestamp: 0,
      operation: { type: "insert", index: 0, text: "\u0001" },
      effect: {
        type: "bootstrap",
        blockId: "bootstrap-block",
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
} as const satisfies DocumentEventBatches[number];

const AUTHENTICATED_ACCESS: DocumentAccess = {
  accessMode: COLLAB_ACCESS_MODE.Authenticated,
  actorId: ACTOR_ID,
  canWrite: true,
  role: "EDITOR",
};

const PUBLIC_ACCESS: DocumentAccess = {
  accessMode: COLLAB_ACCESS_MODE.Public,
  actorId: null,
  canWrite: false,
  role: null,
};

class FakePeer implements RoomPeer {
  readonly closes: Array<{ readonly code: number; readonly reason: string }> =
    [];
  readonly messages: ServerCollabMessage[] = [];
  failAcknowledgement = false;
  failEvent = false;

  constructor(
    readonly id: string,
    private readonly actions: string[] = [],
  ) {}

  close(code: number, reason: string): void {
    this.actions.push(`close:${code}`);
    this.closes.push({ code, reason });
  }

  send(message: ServerCollabMessage): void {
    this.actions.push(`send:${message.type}`);
    if (
      (this.failAcknowledgement &&
        message.type === COLLAB_MESSAGE_TYPE.DurableAck) ||
      (this.failEvent && message.type === COLLAB_MESSAGE_TYPE.Event)
    ) {
      throw new Error("transport unavailable");
    }
    this.messages.push(message);
  }
}

class ManualScheduler implements DocumentRoomScheduler {
  private readonly tasks = new Set<() => void | Promise<void>>();
  private time = 1_000;

  now(): number {
    return this.time;
  }

  repeat(
    _intervalMs: number,
    task: () => void | Promise<void>,
  ): { cancel(): void } {
    this.tasks.add(task);
    return {
      cancel: () => {
        this.tasks.delete(task);
      },
    };
  }

  async runRepeatingTasks(): Promise<void> {
    this.time += DEFAULT_DOCUMENT_ROOM_POLICY.connection.leaseRefreshIntervalMs;
    await Promise.all([...this.tasks].map((task) => task()));
    await Promise.resolve();
  }

  activeTaskCount(): number {
    return this.tasks.size;
  }
}

class MemoryConnectionLimiter implements ConnectionLimiter {
  readonly activePeerIds = new Set<string>();
  refreshAllowed = true;

  async acquire({
    peerId,
    policy,
  }: Parameters<ConnectionLimiter["acquire"]>[0]) {
    if (this.activePeerIds.has(peerId)) {
      return {
        accepted: false as const,
        reason: CONNECTION_REJECTION_REASON.Duplicate,
      };
    }
    if (this.activePeerIds.size >= policy.maxConnectionsPerDocument) {
      return {
        accepted: false as const,
        reason: CONNECTION_REJECTION_REASON.Capacity,
      };
    }
    this.activePeerIds.add(peerId);
    let released = false;
    return {
      accepted: true as const,
      lease: {
        refresh: async () => !released && this.refreshAllowed,
        release: async () => {
          if (released) return;
          released = true;
          this.activePeerIds.delete(peerId);
        },
      },
    };
  }
}

class MemoryRoomFanout implements RoomFanout {
  readonly actions: string[];
  readonly published: CommittedDocumentEvent[] = [];
  private readonly handlers = new Set<RoomFanoutHandler>();

  constructor(actions: string[] = []) {
    this.actions = actions;
  }

  async publish(event: CommittedDocumentEvent): Promise<void> {
    this.actions.push("publish");
    this.published.push(event);
    await Promise.all([...this.handlers].map((handler) => handler(event)));
  }

  async subscribe(
    _documentId: string,
    handler: RoomFanoutHandler,
  ): Promise<{ unsubscribe(): Promise<void> }> {
    this.actions.push("subscribe");
    this.handlers.add(handler);
    let subscribed = true;
    return {
      unsubscribe: async () => {
        if (!subscribed) return;
        subscribed = false;
        this.handlers.delete(handler);
      },
    };
  }

  async emit(event: CommittedDocumentEvent): Promise<void> {
    await Promise.all([...this.handlers].map((handler) => handler(event)));
  }

  subscriberCount(): number {
    return this.handlers.size;
  }
}

class MemoryEventStore implements DocumentEventStore {
  readonly actions: string[];
  appendError: Error | null = null;
  readError: Error | null = null;
  page: DocumentEventPage = {
    batches: [BATCH],
    complete: true,
    nextCursor: "1",
  };

  constructor(actions: string[] = []) {
    this.actions = actions;
  }

  async append(
    _documentId: string,
    _actorId: string,
    batches: DocumentEventBatches,
  ): Promise<ReadonlyArray<string>> {
    this.actions.push("append");
    if (this.appendError !== null) throw this.appendError;
    return batches.map((batch) => batch.batchId);
  }

  async read(): Promise<DocumentEventPage> {
    this.actions.push("read");
    if (this.readError !== null) throw this.readError;
    return this.page;
  }
}

interface RuntimeFixture {
  readonly connections: MemoryConnectionLimiter;
  readonly events: MemoryEventStore;
  readonly fanout: MemoryRoomFanout;
  readonly scheduler: ManualScheduler;
  readonly sessions: DocumentSessionHooks;
  authorizeAccess: DocumentAccess | null;
  authorizePromise: Promise<DocumentAccess | null> | null;
  refreshAccess: DocumentAccess | null;
  refreshError: Error | null;
  readonly endedSessions: string[];
}

const createFixture = (actions: string[] = []): RuntimeFixture => {
  const fixture: RuntimeFixture = {
    connections: new MemoryConnectionLimiter(),
    events: new MemoryEventStore(actions),
    fanout: new MemoryRoomFanout(actions),
    scheduler: new ManualScheduler(),
    authorizeAccess: AUTHENTICATED_ACCESS,
    authorizePromise: null,
    refreshAccess: AUTHENTICATED_ACCESS,
    refreshError: null,
    endedSessions: [],
    sessions: {
      async authorize() {
        actions.push("authorize");
        return fixture.authorizePromise ?? fixture.authorizeAccess;
      },
      async refresh() {
        actions.push("refresh");
        if (fixture.refreshError !== null) throw fixture.refreshError;
        return fixture.refreshAccess;
      },
      async end(session) {
        fixture.endedSessions.push(session.sessionId);
      },
    },
  };
  return fixture;
};

const createRoom = (fixture: RuntimeFixture, maxConnections = 100) =>
  createDocumentRoom(DOCUMENT_ID, {
    connections: fixture.connections,
    events: fixture.events,
    fanout: fixture.fanout,
    policy: {
      ...DEFAULT_DOCUMENT_ROOM_POLICY,
      connection: {
        ...DEFAULT_DOCUMENT_ROOM_POLICY.connection,
        maxConnectionsPerDocument: maxConnections,
      },
    },
    scheduler: fixture.scheduler,
    sessions: fixture.sessions,
  });

const authMessage = (
  sessionId: string,
  protocolVersion:
    | typeof COLLAB_PROTOCOL_VERSION
    | typeof LEGACY_COLLAB_PROTOCOL_VERSION = COLLAB_PROTOCOL_VERSION,
): Extract<
  ClientCollabMessage,
  { readonly type: typeof COLLAB_MESSAGE_TYPE.Auth }
> =>
  protocolVersion === LEGACY_COLLAB_PROTOCOL_VERSION
    ? {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.Auth,
        accessToken: "access-token",
        documentId: DOCUMENT_ID,
        sessionId,
      }
    : {
        protocolVersion,
        type: COLLAB_MESSAGE_TYPE.Auth,
        credential: { kind: "access-token", token: "access-token" },
        documentId: DOCUMENT_ID,
        sessionId,
      };

const authenticate = async (
  room: ReturnType<typeof createRoom>,
  peer: FakePeer,
  sessionId = `session-${peer.id}`,
): Promise<void> => {
  await room.join(peer);
  await room.receive(peer, authMessage(sessionId));
};

const messagesOfType = <TType extends ServerCollabMessage["type"]>(
  peer: FakePeer,
  type: TType,
): Array<Extract<ServerCollabMessage, { readonly type: TType }>> =>
  peer.messages.filter(
    (
      message,
    ): message is Extract<ServerCollabMessage, { readonly type: TType }> =>
      message.type === type,
  );

describe("createDocumentRoom", () => {
  it("should authorize, acquire, subscribe, and then send Ready", async () => {
    // Arrange
    const actions: string[] = [];
    const fixture = createFixture(actions);
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-a", actions);

    // Act
    await authenticate(room, peer);

    // Assert
    expect(actions).toEqual([
      "authorize",
      "subscribe",
      `send:${COLLAB_MESSAGE_TYPE.Ready}`,
    ]);
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.Ready)).toEqual([
      expect.objectContaining({
        accessMode: COLLAB_ACCESS_MODE.Authenticated,
        documentId: DOCUMENT_ID,
        userId: ACTOR_ID,
      }),
    ]);
    expect(fixture.connections.activePeerIds).toEqual(new Set(["peer-a"]));
    expect(fixture.fanout.subscriberCount()).toBe(1);
  });

  it("should reject a second Auth while authorization is pending", async () => {
    // Arrange
    const fixture = createFixture();
    let resolveAuthorization!: (access: DocumentAccess | null) => void;
    fixture.authorizePromise = new Promise((resolve) => {
      resolveAuthorization = resolve;
    });
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-a");
    await room.join(peer);

    // Act
    const firstAuth = room.receive(peer, authMessage("session-a"));
    await room.receive(peer, authMessage("session-b"));
    resolveAuthorization(AUTHENTICATED_ACCESS);
    await firstAuth;

    // Assert
    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Authentication already in progress",
    });
  });

  it("should acknowledge a durable append before fan-out without self-deadlock", async () => {
    // Arrange
    const actions: string[] = [];
    const fixture = createFixture(actions);
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-a", actions);
    await authenticate(room, peer);
    actions.length = 0;
    peer.messages.length = 0;

    // Act
    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [BATCH],
    });

    // Assert
    expect(actions).toEqual([
      "append",
      `send:${COLLAB_MESSAGE_TYPE.DurableAck}`,
      "publish",
      `send:${COLLAB_MESSAGE_TYPE.Event}`,
    ]);
    expect(fixture.fanout.published).toHaveLength(1);
  });

  it("should still fan out a durable append when DurableAck delivery fails", async () => {
    // Arrange
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-a");
    await authenticate(room, peer);
    peer.failAcknowledgement = true;

    // Act
    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [BATCH],
    });

    // Assert
    expect(fixture.fanout.published).toHaveLength(1);
  });

  it("should map durable conflicts without acknowledgement or fan-out", async () => {
    // Arrange
    const fixture = createFixture();
    fixture.events.appendError = new DocumentEventConflictError(
      "missing history",
      {
        conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.MissingParentHistory,
        documentId: DOCUMENT_ID,
      },
    );
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-a");
    await authenticate(room, peer);
    peer.messages.length = 0;

    // Act
    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [BATCH],
    });

    // Assert
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.Error)).toEqual([
      expect.objectContaining({
        code: COLLAB_ERROR_CODE.Conflict,
        retryable: false,
      }),
    ]);
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.DurableAck)).toEqual([]);
    expect(fixture.fanout.published).toEqual([]);
  });

  it("should keep public sessions read-only while allowing repair", async () => {
    // Arrange
    const fixture = createFixture();
    fixture.authorizeAccess = PUBLIC_ACCESS;
    fixture.refreshAccess = PUBLIC_ACCESS;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-public");
    await authenticate(room, peer);
    peer.messages.length = 0;

    // Act
    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId: "repair-public",
      afterCursor: "0",
    });
    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [BATCH],
    });

    // Assert
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.RepairResponse)).toEqual([
      expect.objectContaining({ requestId: "repair-public", nextCursor: "1" }),
    ]);
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.Error)).toEqual([
      expect.objectContaining({
        code: COLLAB_ERROR_CODE.Forbidden,
        retryable: false,
      }),
    ]);
  });

  it("should preserve legacy Ready and reject legacy public access", async () => {
    // Arrange
    const authenticatedFixture = createFixture();
    const authenticatedRoom = createRoom(authenticatedFixture);
    const legacyPeer = new FakePeer("peer-legacy");
    await authenticatedRoom.join(legacyPeer);
    await authenticatedRoom.receive(
      legacyPeer,
      authMessage("session-legacy", LEGACY_COLLAB_PROTOCOL_VERSION),
    );

    const publicFixture = createFixture();
    publicFixture.authorizeAccess = PUBLIC_ACCESS;
    const publicRoom = createRoom(publicFixture);
    const publicPeer = new FakePeer("peer-legacy-public");
    await publicRoom.join(publicPeer);

    // Act
    await publicRoom.receive(
      publicPeer,
      authMessage("session-public", LEGACY_COLLAB_PROTOCOL_VERSION),
    );

    // Assert
    expect(messagesOfType(legacyPeer, COLLAB_MESSAGE_TYPE.Ready)).toEqual([
      expect.objectContaining({
        protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
        userId: ACTOR_ID,
      }),
    ]);
    expect(publicPeer.messages).toEqual([]);
    expect(publicPeer.closes).toContainEqual({
      code: 1008,
      reason: "Legacy public collaboration is unsupported",
    });
  });

  it("should release admission after leave and admit a replacement", async () => {
    // Arrange
    const fixture = createFixture();
    const room = createRoom(fixture, 1);
    const first = new FakePeer("peer-first");
    const blocked = new FakePeer("peer-blocked");
    const replacement = new FakePeer("peer-replacement");
    await authenticate(room, first);
    await authenticate(room, blocked);

    // Act
    await room.leave(first, ROOM_LEAVE_REASON.ConnectionClosed);
    await authenticate(room, replacement);

    // Assert
    expect(blocked.closes).toContainEqual({
      code: 1013,
      reason: "Document connection limit reached",
    });
    expect(fixture.connections.activePeerIds).toEqual(
      new Set(["peer-replacement"]),
    );
  });

  it("should not leak resources when leave races with pending authorization", async () => {
    // Arrange
    const fixture = createFixture();
    let resolveAuthorization!: (access: DocumentAccess | null) => void;
    fixture.authorizePromise = new Promise((resolve) => {
      resolveAuthorization = resolve;
    });
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-race");
    await room.join(peer);

    // Act
    const authorization = room.receive(peer, authMessage("session-race"));
    const leave = room.leave(peer, ROOM_LEAVE_REASON.ConnectionClosed);
    resolveAuthorization(AUTHENTICATED_ACCESS);
    await Promise.all([authorization, leave]);

    // Assert
    expect(fixture.connections.activePeerIds.size).toBe(0);
    expect(fixture.fanout.subscriberCount()).toBe(0);
    expect(fixture.scheduler.activeTaskCount()).toBe(0);
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.Ready)).toEqual([]);
  });

  it("should revoke and clean a session when its lease refresh is lost", async () => {
    // Arrange
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-a");
    await authenticate(room, peer);
    fixture.connections.refreshAllowed = false;

    // Act
    await fixture.scheduler.runRepeatingTasks();

    // Assert
    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Collaboration access was revoked",
    });
    expect(fixture.connections.activePeerIds.size).toBe(0);
    expect(fixture.fanout.subscriberCount()).toBe(0);
    expect(fixture.scheduler.activeTaskCount()).toBe(0);
  });

  it("should isolate cross-document fan-out and continue after one peer send fails", async () => {
    // Arrange
    const fixture = createFixture();
    const room = createRoom(fixture);
    const failing = new FakePeer("peer-failing");
    const healthy = new FakePeer("peer-healthy");
    await authenticate(room, failing);
    await authenticate(room, healthy);
    failing.failEvent = true;
    failing.messages.length = 0;
    healthy.messages.length = 0;

    // Act
    await fixture.fanout.emit({
      documentId: "00000000-0000-4000-8000-000000000099",
      batches: [BATCH],
    });
    await fixture.fanout.emit({ documentId: DOCUMENT_ID, batches: [BATCH] });

    // Assert
    expect(messagesOfType(failing, COLLAB_MESSAGE_TYPE.Event)).toEqual([]);
    expect(messagesOfType(healthy, COLLAB_MESSAGE_TYPE.Event)).toHaveLength(1);
  });

  it("should map repair failures to retryable persistence errors", async () => {
    // Arrange
    const fixture = createFixture();
    fixture.events.readError = new DocumentEventStoreUnavailableError(
      "database unavailable",
    );
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-a");
    await authenticate(room, peer);
    peer.messages.length = 0;

    // Act
    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId: "repair-failed",
      afterCursor: "0",
    });

    // Assert
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.Error)).toEqual([
      expect.objectContaining({
        code: COLLAB_ERROR_CODE.PersistenceFailed,
        retryable: true,
      }),
    ]);
  });
});
