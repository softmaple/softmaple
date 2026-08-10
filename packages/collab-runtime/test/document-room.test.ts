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
  DEFAULT_DOCUMENT_ROOM_POLICY,
  DOCUMENT_EVENT_CONFLICT_TYPE,
  DocumentEventConflictError,
  ROOM_LEAVE_REASON,
  createDocumentRoom,
  type CommittedDocumentEvent,
  type ConnectionLimiter,
  type DocumentAccess,
  type DocumentEventBatches,
  type DocumentEventPage,
  type DocumentEventStore,
  type DocumentRoomScheduler,
  type DocumentSessionHooks,
  type RoomFanout,
  type RoomFanoutHandler,
  type RoomPeer,
} from "../src";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";
const BATCH = {
  schemaVersion: 1,
  batchId: "batch-1",
  parentVersion: [],
  events: [
    {
      schemaVersion: 1,
      id: "event-1",
      parentVersion: [],
      timestamp: 1,
      operation: { type: "insert", index: 0, text: "a" },
      effect: {
        type: "bootstrap",
        blockId: "block-1",
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
  readonly messages: ServerCollabMessage[] = [];
  readonly closes: Array<{ readonly code: number; readonly reason: string }> =
    [];
  failAcknowledgement = false;
  failEvent = false;

  constructor(
    readonly id: string,
    private readonly actions: string[] = [],
  ) {}

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

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
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
    return { cancel: () => this.tasks.delete(task) };
  }

  async tick(): Promise<void> {
    this.time += DEFAULT_DOCUMENT_ROOM_POLICY.connection.leaseRefreshIntervalMs;
    await Promise.all([...this.tasks].map((task) => task()));
  }

  activeCount(): number {
    return this.tasks.size;
  }
}

class MemoryConnections implements ConnectionLimiter {
  readonly active = new Set<string>();
  refreshAllowed = true;

  async acquire({
    peerId,
    policy,
  }: Parameters<ConnectionLimiter["acquire"]>[0]) {
    if (this.active.has(peerId)) {
      return {
        accepted: false as const,
        reason: CONNECTION_REJECTION_REASON.Duplicate,
      };
    }
    if (this.active.size >= policy.maxConnectionsPerDocument) {
      return {
        accepted: false as const,
        reason: CONNECTION_REJECTION_REASON.Capacity,
      };
    }
    this.active.add(peerId);
    let released = false;
    return {
      accepted: true as const,
      lease: {
        refresh: async () => !released && this.refreshAllowed,
        release: async () => {
          if (released) return;
          released = true;
          this.active.delete(peerId);
        },
      },
    };
  }
}

class MemoryFanout implements RoomFanout {
  readonly published: CommittedDocumentEvent[] = [];
  private readonly handlers = new Set<RoomFanoutHandler>();

  constructor(private readonly actions: string[] = []) {}

  async publish(event: CommittedDocumentEvent): Promise<void> {
    this.actions.push("publish");
    this.published.push(event);
    await this.emit(event);
  }

  async subscribe(
    _documentId: string,
    handler: RoomFanoutHandler,
  ): Promise<{ unsubscribe(): Promise<void> }> {
    this.actions.push("subscribe");
    this.handlers.add(handler);
    return {
      unsubscribe: async () => {
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

class MemoryEvents implements DocumentEventStore {
  appendError: Error | null = null;
  readError: Error | null = null;
  readonly page: DocumentEventPage = {
    batches: [BATCH],
    complete: true,
    nextCursor: "1",
  };

  constructor(private readonly actions: string[] = []) {}

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
    if (this.readError !== null) throw this.readError;
    return this.page;
  }
}

interface Fixture {
  readonly connections: MemoryConnections;
  readonly events: MemoryEvents;
  readonly fanout: MemoryFanout;
  readonly scheduler: ManualScheduler;
  readonly sessions: DocumentSessionHooks;
  access: DocumentAccess | null;
  authorization: Promise<DocumentAccess | null> | null;
}

const createFixture = (actions: string[] = []): Fixture => {
  const fixture: Fixture = {
    access: AUTHENTICATED_ACCESS,
    authorization: null,
    connections: new MemoryConnections(),
    events: new MemoryEvents(actions),
    fanout: new MemoryFanout(actions),
    scheduler: new ManualScheduler(),
    sessions: {
      async authorize() {
        actions.push("authorize");
        return fixture.authorization ?? fixture.access;
      },
      async refresh() {
        return fixture.access;
      },
    },
  };
  return fixture;
};

const createRoom = (fixture: Fixture, capacity = 100) =>
  createDocumentRoom(DOCUMENT_ID, {
    connections: fixture.connections,
    events: fixture.events,
    fanout: fixture.fanout,
    policy: {
      ...DEFAULT_DOCUMENT_ROOM_POLICY,
      connection: {
        ...DEFAULT_DOCUMENT_ROOM_POLICY.connection,
        maxConnectionsPerDocument: capacity,
      },
    },
    scheduler: fixture.scheduler,
    sessions: fixture.sessions,
  });

const authMessage = (
  sessionId: string,
  version:
    | typeof COLLAB_PROTOCOL_VERSION
    | typeof LEGACY_COLLAB_PROTOCOL_VERSION = COLLAB_PROTOCOL_VERSION,
): Extract<
  ClientCollabMessage,
  { readonly type: typeof COLLAB_MESSAGE_TYPE.Auth }
> =>
  version === LEGACY_COLLAB_PROTOCOL_VERSION
    ? {
        protocolVersion: version,
        type: COLLAB_MESSAGE_TYPE.Auth,
        accessToken: "token",
        documentId: DOCUMENT_ID,
        sessionId,
      }
    : {
        protocolVersion: version,
        type: COLLAB_MESSAGE_TYPE.Auth,
        credential: { kind: "access-token", token: "token" },
        documentId: DOCUMENT_ID,
        sessionId,
      };

const authenticate = async (
  room: ReturnType<typeof createRoom>,
  peer: FakePeer,
): Promise<void> => {
  await room.join(peer);
  await room.receive(peer, authMessage(`session-${peer.id}`));
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
  it("should subscribe before Ready and preserve append-ack-fanout order", async () => {
    const actions: string[] = [];
    const fixture = createFixture(actions);
    const room = createRoom(fixture);
    const peer = new FakePeer("writer", actions);
    await authenticate(room, peer);

    expect(actions).toEqual(["authorize", "subscribe", "send:ready"]);
    actions.length = 0;
    peer.messages.length = 0;

    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [BATCH],
    });

    expect(actions).toEqual([
      "append",
      "send:durable-ack",
      "publish",
      "send:event",
    ]);
  });

  it("should reject a second Auth while the first authorization is pending", async () => {
    const fixture = createFixture();
    let resolve!: (access: DocumentAccess | null) => void;
    fixture.authorization = new Promise((settle) => {
      resolve = settle;
    });
    const room = createRoom(fixture);
    const peer = new FakePeer("pending");
    await room.join(peer);

    const first = room.receive(peer, authMessage("first"));
    await room.receive(peer, authMessage("second"));
    resolve(AUTHENTICATED_ACCESS);
    await first;

    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Authentication already in progress",
    });
  });

  it("should fan out a committed event even if DurableAck delivery fails", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("writer");
    await authenticate(room, peer);
    peer.failAcknowledgement = true;

    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [BATCH],
    });

    expect(fixture.fanout.published).toHaveLength(1);
  });

  it("should never acknowledge or fan out an append conflict", async () => {
    const fixture = createFixture();
    fixture.events.appendError = new DocumentEventConflictError("conflict", {
      conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.MissingParentHistory,
      documentId: DOCUMENT_ID,
    });
    const room = createRoom(fixture);
    const peer = new FakePeer("writer");
    await authenticate(room, peer);
    peer.messages.length = 0;

    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [BATCH],
    });

    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.Error)).toEqual([
      expect.objectContaining({
        code: COLLAB_ERROR_CODE.Conflict,
        retryable: false,
      }),
    ]);
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.DurableAck)).toEqual([]);
    expect(fixture.fanout.published).toEqual([]);
  });

  it("should allow public repair while rejecting public writes", async () => {
    const fixture = createFixture();
    fixture.access = PUBLIC_ACCESS;
    const room = createRoom(fixture);
    const peer = new FakePeer("public");
    await authenticate(room, peer);
    peer.messages.length = 0;

    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairRequest,
      requestId: "repair-1",
      afterCursor: "0",
    });
    await room.receive(peer, {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Event,
      batches: [BATCH],
    });

    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.RepairResponse)).toEqual([
      expect.objectContaining({ requestId: "repair-1", nextCursor: "1" }),
    ]);
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.Error)).toEqual([
      expect.objectContaining({ code: COLLAB_ERROR_CODE.Forbidden }),
    ]);
  });

  it("should preserve legacy Ready and reject legacy public sessions", async () => {
    const legacyFixture = createFixture();
    const legacyRoom = createRoom(legacyFixture);
    const legacyPeer = new FakePeer("legacy");
    await legacyRoom.join(legacyPeer);
    await legacyRoom.receive(
      legacyPeer,
      authMessage("legacy-session", LEGACY_COLLAB_PROTOCOL_VERSION),
    );

    const publicFixture = createFixture();
    publicFixture.access = PUBLIC_ACCESS;
    const publicRoom = createRoom(publicFixture);
    const publicPeer = new FakePeer("legacy-public");
    await publicRoom.join(publicPeer);
    await publicRoom.receive(
      publicPeer,
      authMessage("public-session", LEGACY_COLLAB_PROTOCOL_VERSION),
    );

    expect(messagesOfType(legacyPeer, COLLAB_MESSAGE_TYPE.Ready)).toEqual([
      expect.objectContaining({
        protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
        userId: ACTOR_ID,
      }),
    ]);
    expect(publicPeer.closes).toContainEqual({
      code: 1008,
      reason: "Legacy public collaboration is unsupported",
    });
  });

  it("should release a connection lease and admit a replacement", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture, 1);
    const first = new FakePeer("first");
    const blocked = new FakePeer("blocked");
    await authenticate(room, first);
    await authenticate(room, blocked);

    await room.leave(first, ROOM_LEAVE_REASON.ConnectionClosed);
    const replacement = new FakePeer("replacement");
    await authenticate(room, replacement);

    expect(blocked.closes).toContainEqual({
      code: 1013,
      reason: "Document connection limit reached",
    });
    expect(fixture.connections.active).toEqual(new Set(["replacement"]));
  });

  it("should clean partial resources when leave races with authorization", async () => {
    const fixture = createFixture();
    let resolve!: (access: DocumentAccess | null) => void;
    fixture.authorization = new Promise((settle) => {
      resolve = settle;
    });
    const room = createRoom(fixture);
    const peer = new FakePeer("race");
    await room.join(peer);

    const authorization = room.receive(peer, authMessage("race-session"));
    const leave = room.leave(peer);
    resolve(AUTHENTICATED_ACCESS);
    await Promise.all([authorization, leave]);

    expect(fixture.connections.active.size).toBe(0);
    expect(fixture.fanout.subscriberCount()).toBe(0);
    expect(fixture.scheduler.activeCount()).toBe(0);
    expect(messagesOfType(peer, COLLAB_MESSAGE_TYPE.Ready)).toEqual([]);
  });

  it("should revoke and clean the session when its lease refresh is lost", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("writer");
    await authenticate(room, peer);
    fixture.connections.refreshAllowed = false;

    await fixture.scheduler.tick();

    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Collaboration access was revoked",
    });
    expect(fixture.connections.active.size).toBe(0);
    expect(fixture.fanout.subscriberCount()).toBe(0);
  });

  it("should isolate fan-out and continue after one local send fails", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const failing = new FakePeer("failing");
    const healthy = new FakePeer("healthy");
    await authenticate(room, failing);
    await authenticate(room, healthy);
    failing.failEvent = true;
    failing.messages.length = 0;
    healthy.messages.length = 0;

    await fixture.fanout.emit({
      documentId: "00000000-0000-4000-8000-000000000099",
      batches: [BATCH],
    });
    await fixture.fanout.emit({ documentId: DOCUMENT_ID, batches: [BATCH] });

    expect(messagesOfType(failing, COLLAB_MESSAGE_TYPE.Event)).toEqual([]);
    expect(messagesOfType(healthy, COLLAB_MESSAGE_TYPE.Event)).toHaveLength(1);
  });
});
