import {
  COLLAB_ACCESS_MODE,
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  LEGACY_COLLAB_PROTOCOL_VERSION,
  type AuthMessage,
  type ClientEventMessage,
  type LegacyAuthMessage,
  type RepairRequestMessage,
  type ServerCollabMessage,
} from "@softmaple/collab-protocol";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  CONNECTION_REJECTION_REASON,
  DOCUMENT_EVENT_CONFLICT_TYPE,
  DOCUMENT_ROOM_REFRESH_MODE,
  DOCUMENT_SESSION_END_REASON,
  DocumentEventAuthorizationError,
  DocumentEventConflictError,
  DocumentEventStoreUnavailableError,
  ROOM_LEAVE_REASON,
  createDocumentRoom,
  type AuthenticatedDocumentSession,
  type CommittedDocumentEvent,
  type ConnectionAdmission,
  type ConnectionAdmissionRequest,
  type ConnectionLease,
  type DocumentAccess,
  type DocumentEventStore,
  type DocumentRoom,
  type DocumentRoomOptions,
  type DocumentRoomPolicy,
  type DocumentRoomResumeState,
  type DocumentRoomServices,
  type DocumentSessionAuthorizationRequest,
  type DocumentSessionHooks,
  type DocumentSessionRefreshRequest,
  type RoomFanout,
  type RoomFanoutHandler,
  type RoomFanoutSubscription,
  type RoomPeer,
} from "../src";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_DOCUMENT_ID = "00000000-0000-4000-8000-000000000099";
const BATCHES: ClientEventMessage["batches"] = [
  {
    schemaVersion: 1,
    batchId: "batch-1",
    parentVersion: [],
    events: [],
  },
];

const DEFAULT_TEST_POLICY: DocumentRoomPolicy = {
  authorizationRefreshIntervalMs: 60_000,
  connection: {
    leaseRefreshIntervalMs: 60_000,
    leaseTtlMs: 120_000,
    maxConnectionsPerDocument: 100,
  },
};

const AUTHENTICATED_ACCESS: DocumentAccess = {
  accessMode: COLLAB_ACCESS_MODE.Authenticated,
  actorId: "00000000-0000-4000-8000-000000000002",
  canWrite: true,
  role: "EDITOR",
};

const PUBLIC_ACCESS: DocumentAccess = {
  accessMode: COLLAB_ACCESS_MODE.Public,
  actorId: null,
  canWrite: false,
  role: null,
};

const resumeState = (
  overrides: Partial<AuthenticatedDocumentSession> = {},
): DocumentRoomResumeState => ({
  credential: { kind: "access-token", token: "token" },
  session: {
    ...AUTHENTICATED_ACCESS,
    documentId: DOCUMENT_ID,
    protocolVersion: COLLAB_PROTOCOL_VERSION,
    sessionId: "session-1",
    ...overrides,
  },
});

const authMessage = (overrides: Partial<AuthMessage> = {}): AuthMessage => ({
  protocolVersion: COLLAB_PROTOCOL_VERSION,
  type: COLLAB_MESSAGE_TYPE.Auth,
  credential: { kind: "access-token", token: "token" },
  documentId: DOCUMENT_ID,
  sessionId: "session-1",
  ...overrides,
});

const legacyAuthMessage = (
  overrides: Partial<LegacyAuthMessage> = {},
): LegacyAuthMessage => ({
  protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
  type: COLLAB_MESSAGE_TYPE.Auth,
  accessToken: "legacy-token",
  documentId: DOCUMENT_ID,
  sessionId: "legacy-session",
  ...overrides,
});

const eventMessage = (): ClientEventMessage => ({
  protocolVersion: COLLAB_PROTOCOL_VERSION,
  type: COLLAB_MESSAGE_TYPE.Event,
  batches: BATCHES,
});

const repairMessage = (
  overrides: Partial<RepairRequestMessage> = {},
): RepairRequestMessage => ({
  protocolVersion: COLLAB_PROTOCOL_VERSION,
  type: COLLAB_MESSAGE_TYPE.RepairRequest,
  requestId: "repair-1",
  afterCursor: "0",
  ...overrides,
});

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

class FakePeer implements RoomPeer {
  readonly closes: Array<{ readonly code: number; readonly reason: string }> =
    [];
  readonly id: string;
  readonly messages: ServerCollabMessage[] = [];
  readonly sendAttempts: ServerCollabMessage[] = [];
  readonly sendFailures = new Set<ServerCollabMessage["type"]>();
  closeImpl: (code: number, reason: string) => Promise<void> = async () =>
    undefined;
  onSend: ((message: ServerCollabMessage) => void) | null = null;
  sendImpl: (message: ServerCollabMessage) => Promise<void> = async () =>
    undefined;

  constructor(id: string) {
    this.id = id;
  }

  async close(code: number, reason: string): Promise<void> {
    this.closes.push({ code, reason });
    await this.closeImpl(code, reason);
  }

  async send(message: ServerCollabMessage): Promise<void> {
    this.sendAttempts.push(message);
    this.onSend?.(message);
    if (this.sendFailures.has(message.type)) {
      throw new Error(`send failed for ${message.type}`);
    }
    await this.sendImpl(message);
    this.messages.push(message);
  }
}

class FakeLease implements ConnectionLease {
  refreshCalls = 0;
  refreshError: Error | null = null;
  refreshResult = true;
  releaseCalls = 0;

  async refresh(): Promise<boolean> {
    this.refreshCalls += 1;
    if (this.refreshError !== null) throw this.refreshError;
    return this.refreshResult;
  }

  async release(): Promise<void> {
    this.releaseCalls += 1;
  }
}

class MemoryRoomFanout implements RoomFanout {
  readonly handlers = new Map<string, Set<RoomFanoutHandler>>();
  readonly published: CommittedDocumentEvent[] = [];
  publishError: Error | null = null;
  subscribeError: Error | null = null;
  subscribeCalls = 0;
  unsubscribeFailuresRemaining = 0;
  unsubscribeCalls = 0;
  onPublish: ((event: CommittedDocumentEvent) => void) | null = null;

  async emit(event: CommittedDocumentEvent): Promise<void> {
    const handlers = [...(this.handlers.get(event.documentId) ?? [])];
    await Promise.all(handlers.map((handler) => handler(event)));
  }

  async publish(event: CommittedDocumentEvent): Promise<void> {
    this.published.push(event);
    this.onPublish?.(event);
    if (this.publishError !== null) throw this.publishError;
    await this.emit(event);
  }

  async subscribe(
    documentId: string,
    handler: RoomFanoutHandler,
  ): Promise<RoomFanoutSubscription> {
    this.subscribeCalls += 1;
    if (this.subscribeError !== null) throw this.subscribeError;
    const handlers =
      this.handlers.get(documentId) ?? new Set<RoomFanoutHandler>();
    handlers.add(handler);
    this.handlers.set(documentId, handlers);
    let subscribed = true;
    return {
      unsubscribe: async () => {
        if (!subscribed) return;
        this.unsubscribeCalls += 1;
        if (this.unsubscribeFailuresRemaining > 0) {
          this.unsubscribeFailuresRemaining -= 1;
          throw new Error("unsubscribe failed");
        }
        subscribed = false;
        const current = this.handlers.get(documentId);
        current?.delete(handler);
        if (current?.size === 0) this.handlers.delete(documentId);
      },
    };
  }
}

interface FixtureControls {
  access: DocumentAccess | null;
  acquireImpl: (
    request: ConnectionAdmissionRequest,
  ) => Promise<ConnectionAdmission>;
  appendImpl: DocumentEventStore["append"];
  authorizeImpl: DocumentSessionHooks["authorize"];
  readImpl: DocumentEventStore["read"];
  refreshAccess: DocumentAccess | null;
  refreshImpl: DocumentSessionHooks["refresh"];
}

interface Fixture {
  readonly acquire: ReturnType<typeof vi.fn>;
  readonly append: ReturnType<typeof vi.fn>;
  readonly authorize: ReturnType<typeof vi.fn>;
  readonly controls: FixtureControls;
  readonly end: Mock<NonNullable<DocumentSessionHooks["end"]>>;
  readonly fanout: MemoryRoomFanout;
  readonly leases: FakeLease[];
  readonly read: ReturnType<typeof vi.fn>;
  readonly reportError: ReturnType<typeof vi.fn>;
  readonly refresh: ReturnType<typeof vi.fn>;
  readonly services: DocumentRoomServices;
}

const createFixture = (policy = DEFAULT_TEST_POLICY): Fixture => {
  const leases: FakeLease[] = [];
  const fanout = new MemoryRoomFanout();
  const controls: FixtureControls = {
    access: AUTHENTICATED_ACCESS,
    async acquireImpl() {
      const lease = new FakeLease();
      leases.push(lease);
      return { accepted: true, lease };
    },
    async appendImpl(_documentId, _actorId, batches) {
      return batches.map((batch) => batch.batchId);
    },
    async authorizeImpl() {
      return controls.access;
    },
    async readImpl(_documentId, afterCursor) {
      return { batches: BATCHES, complete: true, nextCursor: afterCursor };
    },
    refreshAccess: AUTHENTICATED_ACCESS,
    async refreshImpl() {
      return controls.refreshAccess;
    },
  };
  const acquire = vi.fn(
    async (request: ConnectionAdmissionRequest): Promise<ConnectionAdmission> =>
      controls.acquireImpl(request),
  );
  const append = vi.fn(
    async (...args: Parameters<DocumentEventStore["append"]>) =>
      controls.appendImpl(...args),
  );
  const read = vi.fn(async (...args: Parameters<DocumentEventStore["read"]>) =>
    controls.readImpl(...args),
  );
  const authorize = vi.fn(
    async (request: DocumentSessionAuthorizationRequest) =>
      controls.authorizeImpl(request),
  );
  const refresh = vi.fn(async (request: DocumentSessionRefreshRequest) =>
    controls.refreshImpl(request),
  );
  const reportError = vi.fn();
  const end = vi.fn<NonNullable<DocumentSessionHooks["end"]>>(
    async () => undefined,
  );
  return {
    acquire,
    append,
    authorize,
    controls,
    end,
    fanout,
    leases,
    read,
    reportError,
    refresh,
    services: {
      connections: { acquire },
      events: { append, read },
      fanout,
      policy,
      reportError,
      sessions: { authorize, end, refresh },
    },
  };
};

const openRooms: DocumentRoom[] = [];

const createRoom = (
  fixture: Fixture,
  options?: DocumentRoomOptions,
): DocumentRoom => {
  const room = createDocumentRoom(DOCUMENT_ID, fixture.services, options);
  openRooms.push(room);
  return room;
};

const authenticate = async (
  room: DocumentRoom,
  peer: FakePeer,
  message: AuthMessage | LegacyAuthMessage = authMessage(),
): Promise<void> => {
  await room.join(peer);
  await room.receive(peer, message);
};

const lastMessage = (peer: FakePeer): ServerCollabMessage | undefined =>
  peer.messages.at(-1);

afterEach(async () => {
  const rooms = openRooms.splice(0);
  await Promise.all(rooms.map((room) => room.close()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createDocumentRoom authentication", () => {
  it("rejects pre-auth messages without mutating durable state", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-pre-auth");
    await room.join(peer);

    await room.receive(peer, eventMessage());

    expect(lastMessage(peer)).toMatchObject({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.AuthenticationFailed,
      retryable: false,
    });
    expect(fixture.append).not.toHaveBeenCalled();
  });

  it("rejects a wrong-document Auth before calling authorization", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-wrong-doc");
    await room.join(peer);

    await room.receive(peer, authMessage({ documentId: OTHER_DOCUMENT_ID }));

    expect(fixture.authorize).not.toHaveBeenCalled();
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.AuthenticationFailed,
      retryable: false,
    });
    expect(peer.closes).toContainEqual({ code: 1008, reason: "Unauthorized" });
  });

  it("rejects a pending second Auth immediately and rolls back the first", async () => {
    const fixture = createFixture();
    const authorization = deferred<DocumentAccess | null>();
    fixture.controls.authorizeImpl = async () => authorization.promise;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-pending-auth");
    await room.join(peer);

    const firstAuth = room.receive(peer, authMessage());
    await vi.waitFor(() => expect(fixture.authorize).toHaveBeenCalledOnce());

    await room.receive(peer, authMessage({ sessionId: "session-2" }));

    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Authentication already in progress",
    });
    authorization.resolve(AUTHENTICATED_ACCESS);
    await firstAuth;
    expect(fixture.fanout.subscribeCalls).toBe(0);
    expect(
      peer.messages.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.Ready,
      ),
    ).toBe(false);
  });

  it("closes on a second Auth after Ready", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-second-auth");
    await authenticate(room, peer);

    await room.receive(peer, authMessage({ sessionId: "session-2" }));

    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Already authenticated",
    });
    await vi.waitFor(() => expect(fixture.leases[0]?.releaseCalls).toBe(1));
  });

  it("does not authorize messages received after shutdown starts", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-auth-during-close");
    const close = deferred<void>();
    peer.closeImpl = async () => close.promise;
    await room.join(peer);

    const closing = room.close();
    await vi.waitFor(() => expect(peer.closes).toHaveLength(1));
    await room.receive(peer, authMessage());

    expect(fixture.authorize).not.toHaveBeenCalled();
    close.resolve();
    await closing;
  });

  it("does not expose a session to fan-out until Ready is delivered", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-ready-ordering");
    const ready = deferred<void>();
    peer.sendImpl = async (message) =>
      message.type === COLLAB_MESSAGE_TYPE.Ready
        ? ready.promise
        : Promise.resolve();

    const authenticating = authenticate(room, peer);
    await vi.waitFor(() => expect(fixture.fanout.subscribeCalls).toBe(1));
    await fixture.fanout.emit({ documentId: DOCUMENT_ID, batches: BATCHES });
    expect(peer.sendAttempts).not.toContainEqual(
      expect.objectContaining({ type: COLLAB_MESSAGE_TYPE.Event }),
    );

    ready.resolve();
    await authenticating;
    await fixture.fanout.emit({ documentId: DOCUMENT_ID, batches: BATCHES });
    expect(peer.messages).toContainEqual(
      expect.objectContaining({ type: COLLAB_MESSAGE_TYPE.Event }),
    );
  });

  it("cleans a temporary authorization failure and allows the same peer to retry", async () => {
    const fixture = createFixture();
    fixture.authorize.mockRejectedValueOnce(
      new Error("identity provider down"),
    );
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-auth-retry");
    await room.join(peer);

    await room.receive(peer, authMessage());
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.AuthenticationFailed,
      retryable: true,
    });
    expect(peer.closes).toHaveLength(0);

    await room.receive(peer, authMessage({ sessionId: "retry-session" }));
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
      documentId: DOCUMENT_ID,
    });
  });

  it("releases partial setup before a retry", async () => {
    const fixture = createFixture();
    fixture.fanout.subscribeError = new Error("fanout unavailable");
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-setup-retry");
    await room.join(peer);

    await room.receive(peer, authMessage());
    expect(fixture.leases[0]?.releaseCalls).toBe(1);
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      retryable: true,
    });

    fixture.fanout.subscribeError = null;
    await room.receive(peer, authMessage({ sessionId: "retry-session" }));
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Ready,
    });
  });

  it("pins legacy sessions to protocol v2 and normalizes their credential", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-v2");

    await authenticate(room, peer, legacyAuthMessage());
    await room.receive(peer, repairMessage());

    expect(fixture.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: { kind: "access-token", token: "legacy-token" },
        protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
      }),
    );
    expect(peer.messages[0]).toMatchObject({
      protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Ready,
      userId: AUTHENTICATED_ACCESS.actorId,
    });
    expect(lastMessage(peer)).toMatchObject({
      protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.RepairResponse,
    });
  });

  it("supports public v3 repair while keeping the session read-only", async () => {
    const fixture = createFixture();
    fixture.controls.access = PUBLIC_ACCESS;
    fixture.controls.refreshAccess = PUBLIC_ACCESS;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-public");
    await authenticate(
      room,
      peer,
      authMessage({ credential: { kind: "public" } }),
    );

    expect(peer.messages[0]).toMatchObject({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Ready,
      accessMode: COLLAB_ACCESS_MODE.Public,
      canWrite: false,
    });
    await room.receive(peer, eventMessage());
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.Forbidden,
      retryable: false,
    });
    expect(fixture.append).not.toHaveBeenCalled();

    await room.receive(peer, repairMessage());
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.RepairResponse,
      requestId: "repair-1",
    });
  });

  it("rejects public access for a legacy client", async () => {
    const fixture = createFixture();
    fixture.controls.access = PUBLIC_ACCESS;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-legacy-public");

    await authenticate(room, peer, legacyAuthMessage());

    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Legacy public collaboration is unsupported",
    });
    expect(
      peer.messages.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.Ready,
      ),
    ).toBe(false);
  });

  it.each([
    CONNECTION_REJECTION_REASON.Capacity,
    CONNECTION_REJECTION_REASON.Duplicate,
  ])("maps %s admission rejection to retryable Forbidden", async (reason) => {
    const fixture = createFixture();
    fixture.controls.acquireImpl = async () => ({ accepted: false, reason });
    const room = createRoom(fixture);
    const peer = new FakePeer(`peer-${reason}`);

    await authenticate(room, peer);

    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.Forbidden,
      retryable: true,
    });
    expect(peer.closes).toContainEqual({
      code: 1013,
      reason: "Document connection limit reached",
    });
    expect(fixture.fanout.subscribeCalls).toBe(0);
  });
});

describe("createDocumentRoom session resume", () => {
  it("revalidates and reacquires a session without another Ready exchange", async () => {
    const fixture = createFixture();
    fixture.controls.refreshAccess = {
      ...AUTHENTICATED_ACCESS,
      role: "OWNER",
    };
    const room = createRoom(fixture, {
      refreshMode: DOCUMENT_ROOM_REFRESH_MODE.OnMessage,
    });
    const peer = new FakePeer("peer-resume");
    const restored = resumeState();

    const session = await room.resume(peer, restored);

    expect(fixture.authorize).not.toHaveBeenCalled();
    expect(fixture.refresh).toHaveBeenCalledWith({
      credential: restored.credential,
      peerId: peer.id,
      session: restored.session,
    });
    expect(fixture.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        peerId: peer.id,
        sessionId: restored.session.sessionId,
      }),
    );
    expect(session).toMatchObject({
      documentId: DOCUMENT_ID,
      role: "OWNER",
      sessionId: restored.session.sessionId,
    });
    expect(peer.messages).toHaveLength(0);

    await room.receive(peer, eventMessage());
    expect(peer.messages).toContainEqual(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.DurableAck,
        batchIds: ["batch-1"],
      }),
    );
    expect(peer.messages).toContainEqual(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Event,
        batches: BATCHES,
      }),
    );
  });

  it("closes a resumed session when its access identity changed", async () => {
    const fixture = createFixture();
    fixture.controls.refreshAccess = {
      ...AUTHENTICATED_ACCESS,
      actorId: "00000000-0000-4000-8000-000000000099",
    };
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-resume-revoked");
    const restored = resumeState();

    await expect(room.resume(peer, restored)).resolves.toBeNull();

    expect(fixture.acquire).not.toHaveBeenCalled();
    expect(fixture.fanout.subscribeCalls).toBe(0);
    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Collaboration access was revoked",
    });
    expect(fixture.end).toHaveBeenCalledWith(
      restored.session,
      DOCUMENT_SESSION_END_REASON.AccessRevoked,
    );
  });

  it("releases partial resumed setup when fan-out cannot be restored", async () => {
    const fixture = createFixture();
    fixture.fanout.subscribeError = new Error("fanout unavailable");
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-resume-partial");

    await expect(room.resume(peer, resumeState())).resolves.toBeNull();

    expect(fixture.leases[0]?.releaseCalls).toBe(1);
    expect(peer.closes).toContainEqual({
      code: 1011,
      reason: "Collaboration runtime unavailable",
    });
    expect(fixture.end).toHaveBeenCalledWith(
      expect.anything(),
      DOCUMENT_SESSION_END_REASON.PeerLeft,
    );
  });
});

describe("createDocumentRoom refresh semantics", () => {
  it("refreshes access and leases lazily without background timers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 10,
      connection: {
        leaseRefreshIntervalMs: 10,
        leaseTtlMs: 100,
        maxConnectionsPerDocument: 100,
      },
    });
    const room = createRoom(fixture, {
      refreshMode: DOCUMENT_ROOM_REFRESH_MODE.OnMessage,
    });
    const peer = new FakePeer("peer-on-message-refresh");
    await authenticate(room, peer);

    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(1_011);
    expect(fixture.refresh).not.toHaveBeenCalled();
    expect(fixture.leases[0]?.refreshCalls).toBe(0);

    await room.receive(peer, repairMessage());

    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(fixture.leases[0]?.refreshCalls).toBe(1);
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    await room.receive(peer, repairMessage({ requestId: "repair-2" }));
    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(fixture.leases[0]?.refreshCalls).toBe(1);
    expect(fixture.read).toHaveBeenCalledTimes(2);
  });

  it("revalidates again before returning a repair that crossed its deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 10,
      connection: {
        leaseRefreshIntervalMs: 20,
        leaseTtlMs: 100,
        maxConnectionsPerDocument: 100,
      },
    });
    fixture.controls.readImpl = async (_documentId, afterCursor) => {
      vi.setSystemTime(1_011);
      fixture.controls.refreshAccess = null;
      return { batches: BATCHES, complete: true, nextCursor: afterCursor };
    };
    const room = createRoom(fixture, {
      refreshMode: DOCUMENT_ROOM_REFRESH_MODE.OnMessage,
    });
    const peer = new FakePeer("peer-repair-deadline");
    await authenticate(room, peer);
    peer.messages.length = 0;

    await room.receive(peer, repairMessage());

    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(peer.closes).toContainEqual({ code: 1008, reason: "Unauthorized" });
    expect(peer.messages).toContainEqual(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Error,
        code: COLLAB_ERROR_CODE.AuthenticationFailed,
      }),
    );
    expect(
      peer.messages.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.RepairResponse,
      ),
    ).toBe(false);
  });

  it("does not hold the room maintenance lock across peer persistence I/O", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 10,
      connection: {
        leaseRefreshIntervalMs: 60_000,
        leaseTtlMs: 120_000,
        maxConnectionsPerDocument: 100,
      },
    });
    const slowRead =
      deferred<Awaited<ReturnType<DocumentEventStore["read"]>>>();
    fixture.controls.readImpl = async (_documentId, afterCursor) => {
      if (afterCursor === "0") {
        vi.setSystemTime(1_030);
        return slowRead.promise;
      }
      return { batches: BATCHES, complete: true, nextCursor: afterCursor };
    };
    const room = createRoom(fixture, {
      refreshMode: DOCUMENT_ROOM_REFRESH_MODE.OnMessage,
    });
    const slowPeer = new FakePeer("peer-slow-repair");
    const fastPeer = new FakePeer("peer-fast-repair");
    await authenticate(room, slowPeer);
    await authenticate(
      room,
      fastPeer,
      authMessage({ sessionId: "fast-session" }),
    );

    vi.setSystemTime(1_011);
    const slowRequest = room.receive(slowPeer, repairMessage());
    await vi.waitFor(() => expect(fixture.read).toHaveBeenCalledOnce());
    let fastFinished = false;
    const fastRequest = room
      .receive(
        fastPeer,
        repairMessage({ afterCursor: "1", requestId: "fast-repair" }),
      )
      .then(() => {
        fastFinished = true;
      });
    try {
      await vi.waitFor(() => expect(fastFinished).toBe(true));
    } finally {
      slowRead.resolve({ batches: BATCHES, complete: true, nextCursor: "0" });
      await Promise.all([slowRequest, fastRequest]);
    }
    expect(fastPeer.messages).toContainEqual(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.RepairResponse,
        requestId: "fast-repair",
      }),
    );
  });

  it("closes a peer whose validation expired during append before fan-out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 10,
      connection: {
        leaseRefreshIntervalMs: 20,
        leaseTtlMs: 100,
        maxConnectionsPerDocument: 100,
      },
    });
    fixture.controls.appendImpl = async (_documentId, _actorId, batches) => {
      vi.setSystemTime(1_011);
      return batches.map((batch) => batch.batchId);
    };
    const room = createRoom(fixture, {
      refreshMode: DOCUMENT_ROOM_REFRESH_MODE.OnMessage,
    });
    const sender = new FakePeer("peer-deadline-sender");
    const expired = new FakePeer("peer-expired-recipient");
    await authenticate(room, sender);
    await authenticate(
      room,
      expired,
      authMessage({ sessionId: "expired-session" }),
    );
    sender.messages.length = 0;
    expired.messages.length = 0;

    await room.receive(sender, eventMessage());

    expect(sender.messages).toContainEqual(
      expect.objectContaining({ type: COLLAB_MESSAGE_TYPE.Event }),
    );
    expect(
      expired.messages.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.Event,
      ),
    ).toBe(false);

    expect(expired.closes).toContainEqual({
      code: 1012,
      reason: "Collaboration session requires revalidation",
    });
    await vi.waitFor(() => {
      expect(fixture.end).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "expired-session" }),
        DOCUMENT_SESSION_END_REASON.PeerLeft,
      );
    });
    expect(fixture.leases[1]?.releaseCalls).toBe(1);
  });

  it("removes every expired revoked peer before another peer publishes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 10,
      connection: {
        leaseRefreshIntervalMs: 20,
        leaseTtlMs: 100,
        maxConnectionsPerDocument: 100,
      },
    });
    fixture.controls.refreshImpl = async (request) =>
      request.peerId === "peer-idle-revoked" ? null : AUTHENTICATED_ACCESS;
    const room = createRoom(fixture, {
      refreshMode: DOCUMENT_ROOM_REFRESH_MODE.OnMessage,
    });
    const sender = new FakePeer("peer-sender");
    const revoked = new FakePeer("peer-idle-revoked");
    await authenticate(room, sender);
    await authenticate(
      room,
      revoked,
      authMessage({ sessionId: "idle-session" }),
    );
    sender.messages.length = 0;
    revoked.messages.length = 0;
    vi.setSystemTime(1_011);

    await room.receive(sender, eventMessage());

    expect(fixture.refresh).toHaveBeenCalledTimes(2);
    expect(revoked.closes).toContainEqual({
      code: 1008,
      reason: "Unauthorized",
    });
    expect(
      revoked.messages.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.Event,
      ),
    ).toBe(false);
    expect(sender.messages).toContainEqual(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Event,
        batches: BATCHES,
      }),
    );
    expect(fixture.fanout.published).toHaveLength(1);
    expect(fixture.leases[1]?.releaseCalls).toBe(1);
  });

  it("blocks a message when lazy connection lease maintenance fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 100,
      connection: {
        leaseRefreshIntervalMs: 10,
        leaseTtlMs: 100,
        maxConnectionsPerDocument: 100,
      },
    });
    const room = createRoom(fixture, {
      refreshMode: DOCUMENT_ROOM_REFRESH_MODE.OnMessage,
    });
    const peer = new FakePeer("peer-lazy-lease-loss");
    await authenticate(room, peer);
    fixture.leases[0]!.refreshResult = false;
    vi.setSystemTime(1_011);

    await room.receive(peer, repairMessage());

    expect(peer.closes).toContainEqual({
      code: 1013,
      reason: "Collaboration connection lease was lost",
    });
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.end).toHaveBeenCalledWith(
      expect.anything(),
      DOCUMENT_SESSION_END_REASON.PeerLeft,
    );
  });

  it("lazily revalidates expired access and closes a revoked session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 100,
      connection: {
        leaseRefreshIntervalMs: 100,
        leaseTtlMs: 1_000,
        maxConnectionsPerDocument: 100,
      },
    });
    fixture.controls.refreshAccess = null;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-lazy-revoke");
    await authenticate(room, peer);
    vi.setSystemTime(1_101);

    await room.receive(peer, repairMessage());

    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.AuthenticationFailed,
      retryable: false,
    });
    expect(peer.closes).toContainEqual({ code: 1008, reason: "Unauthorized" });
  });

  it("periodically closes when authorization is revoked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 10,
      connection: {
        leaseRefreshIntervalMs: 10,
        leaseTtlMs: 100,
        maxConnectionsPerDocument: 100,
      },
    });
    fixture.controls.refreshAccess = null;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-periodic-revoke");
    await authenticate(room, peer);

    await vi.advanceTimersByTimeAsync(10);

    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Collaboration access was revoked",
    });
    expect(fixture.end).toHaveBeenCalledWith(
      expect.anything(),
      DOCUMENT_SESSION_END_REASON.AccessRevoked,
    );
  });

  it("periodically closes when the connection lease is lost", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 10,
      connection: {
        leaseRefreshIntervalMs: 10,
        leaseTtlMs: 100,
        maxConnectionsPerDocument: 100,
      },
    });
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-lease-loss");
    await authenticate(room, peer);
    fixture.leases[0]!.refreshResult = false;

    await vi.advanceTimersByTimeAsync(10);

    expect(fixture.leases[0]?.refreshCalls).toBe(1);
    expect(peer.closes).toContainEqual({
      code: 1013,
      reason: "Collaboration connection lease was lost",
    });
    expect(fixture.end).toHaveBeenCalledWith(
      expect.anything(),
      DOCUMENT_SESSION_END_REASON.PeerLeft,
    );
  });

  it("refreshes a lease at its own deadline when intervals do not divide evenly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 17,
      connection: {
        leaseRefreshIntervalMs: 20,
        leaseTtlMs: 21,
        maxConnectionsPerDocument: 100,
      },
    });
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-independent-deadlines");
    await authenticate(room, peer);

    await vi.advanceTimersByTimeAsync(20);

    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(fixture.leases[0]?.refreshCalls).toBe(1);
  });

  it("refreshes access while a durable append is still pending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const append = deferred<ReadonlyArray<string>>();
    const appendStarted = deferred<void>();
    const fixture = createFixture({
      authorizationRefreshIntervalMs: 10,
      connection: {
        leaseRefreshIntervalMs: 10,
        leaseTtlMs: 100,
        maxConnectionsPerDocument: 100,
      },
    });
    fixture.controls.appendImpl = async () => {
      appendStarted.resolve();
      return append.promise;
    };
    fixture.controls.refreshAccess = null;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-refresh-during-append");
    await authenticate(room, peer);

    const receiving = room.receive(peer, eventMessage());
    await appendStarted.promise;
    expect(fixture.append).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10);

    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(peer.closes).toContainEqual({
      code: 1008,
      reason: "Collaboration access was revoked",
    });
    append.resolve(["batch-1"]);
    await receiving;
    expect(
      peer.messages.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.Event,
      ),
    ).toBe(false);
  });
});

describe("createDocumentRoom durability, repair, and fan-out", () => {
  it("orders durable append before acknowledgement before fan-out", async () => {
    const timeline: string[] = [];
    const fixture = createFixture();
    fixture.controls.appendImpl = async (_documentId, _actorId, batches) => {
      timeline.push("append");
      return batches.map((batch) => batch.batchId);
    };
    fixture.fanout.onPublish = () => timeline.push("publish");
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-ordering");
    await authenticate(room, peer);
    peer.onSend = (message) => {
      if (message.type === COLLAB_MESSAGE_TYPE.DurableAck) timeline.push("ack");
    };

    await room.receive(peer, eventMessage());

    expect(timeline).toEqual(["append", "ack", "publish"]);
    expect(fixture.fanout.published).toEqual([
      { documentId: DOCUMENT_ID, batches: BATCHES },
    ]);
  });

  it("fans out a committed event even when DurableAck sending fails", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-ack-failure");
    await authenticate(room, peer);
    peer.sendFailures.add(COLLAB_MESSAGE_TYPE.DurableAck);

    await room.receive(peer, eventMessage());

    expect(
      peer.sendAttempts.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.DurableAck,
      ),
    ).toBe(true);
    expect(fixture.fanout.published).toHaveLength(1);
  });

  it("keeps a durable acknowledgement when fan-out publishing fails", async () => {
    const fixture = createFixture();
    const publishError = new Error("realtime unavailable");
    fixture.fanout.publishError = publishError;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-publish-failure");
    await authenticate(room, peer);
    peer.messages.length = 0;

    await room.receive(peer, eventMessage());

    expect(peer.messages).toContainEqual(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.DurableAck,
        batchIds: ["batch-1"],
      }),
    );
    expect(peer.closes).toHaveLength(0);
    expect(fixture.reportError).toHaveBeenCalledWith(publishError, {
      documentId: DOCUMENT_ID,
      messageType: "realtime-publish",
      peerId: peer.id,
    });
  });

  it.each([
    {
      error: new DocumentEventAuthorizationError("revoked"),
      code: COLLAB_ERROR_CODE.Forbidden,
      retryable: false,
    },
    {
      error: new DocumentEventConflictError("conflict", {
        conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.MissingParentHistory,
        documentId: DOCUMENT_ID,
      }),
      code: COLLAB_ERROR_CODE.Conflict,
      retryable: false,
    },
    {
      error: new DocumentEventStoreUnavailableError("database unavailable"),
      code: COLLAB_ERROR_CODE.PersistenceFailed,
      retryable: true,
    },
  ])("maps append failure to $code", async ({ error, code, retryable }) => {
    const fixture = createFixture();
    fixture.controls.appendImpl = async () => {
      throw error;
    };
    const room = createRoom(fixture);
    const peer = new FakePeer(`peer-${code}`);
    await authenticate(room, peer);
    peer.messages.length = 0;

    await room.receive(peer, eventMessage());

    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code,
      retryable,
    });
    expect(fixture.fanout.published).toHaveLength(0);
    expect(
      peer.messages.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.DurableAck,
      ),
    ).toBe(false);
  });

  it("echoes repair request metadata and maps read failures", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-repair");
    await authenticate(room, peer);

    await room.receive(
      peer,
      repairMessage({ afterCursor: "12", requestId: "repair-12" }),
    );
    expect(fixture.read).toHaveBeenCalledWith(DOCUMENT_ID, "12");
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.RepairResponse,
      requestId: "repair-12",
      nextCursor: "12",
    });

    fixture.controls.readImpl = async () => {
      throw new DocumentEventStoreUnavailableError("read unavailable");
    };
    await room.receive(peer, repairMessage({ requestId: "repair-error" }));
    expect(lastMessage(peer)).toMatchObject({
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.PersistenceFailed,
      retryable: true,
    });
  });

  it("discards cross-document fan-out and isolates one peer send failure", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const failing = new FakePeer("peer-fanout-fails");
    const healthy = new FakePeer("peer-fanout-healthy");
    await authenticate(room, failing);
    await authenticate(room, healthy, authMessage({ sessionId: "session-2" }));
    failing.messages.length = 0;
    healthy.messages.length = 0;
    failing.sendFailures.add(COLLAB_MESSAGE_TYPE.Event);

    await fixture.fanout.emit({
      documentId: OTHER_DOCUMENT_ID,
      batches: BATCHES,
    });
    expect(failing.sendAttempts).not.toContainEqual(
      expect.objectContaining({ type: COLLAB_MESSAGE_TYPE.Event }),
    );
    expect(healthy.messages).toHaveLength(0);

    await fixture.fanout.emit({ documentId: DOCUMENT_ID, batches: BATCHES });
    expect(
      failing.sendAttempts.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.Event,
      ),
    ).toBe(true);
    expect(healthy.messages).toContainEqual(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Event,
        batches: BATCHES,
      }),
    );
  });

  it("formats one committed event for mixed v2 and v3 sessions", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const legacy = new FakePeer("peer-fanout-v2");
    const current = new FakePeer("peer-fanout-v3");
    await authenticate(room, legacy, legacyAuthMessage());
    await authenticate(room, current, authMessage({ sessionId: "session-v3" }));
    legacy.messages.length = 0;
    current.messages.length = 0;

    await fixture.fanout.emit({ documentId: DOCUMENT_ID, batches: BATCHES });

    expect(legacy.messages).toContainEqual(
      expect.objectContaining({
        protocolVersion: LEGACY_COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Event,
        batches: BATCHES,
      }),
    );
    expect(current.messages).toContainEqual(
      expect.objectContaining({
        protocolVersion: COLLAB_PROTOCOL_VERSION,
        type: COLLAB_MESSAGE_TYPE.Event,
        batches: BATCHES,
      }),
    );
  });
});

describe("createDocumentRoom cleanup races", () => {
  it("retries a failed final unsubscribe before creating a replacement", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const first = new FakePeer("peer-first-subscription");
    await authenticate(room, first);
    fixture.fanout.unsubscribeFailuresRemaining = 1;

    await room.leave(first);

    expect(fixture.fanout.handlers.get(DOCUMENT_ID)?.size).toBe(1);
    const second = new FakePeer("peer-replacement-subscription");
    await authenticate(room, second, authMessage({ sessionId: "session-2" }));
    expect(fixture.fanout.unsubscribeCalls).toBe(2);
    expect(fixture.fanout.subscribeCalls).toBe(2);
    expect(fixture.fanout.handlers.get(DOCUMENT_ID)?.size).toBe(1);

    second.messages.length = 0;
    await fixture.fanout.emit({ documentId: DOCUMENT_ID, batches: BATCHES });
    expect(
      second.messages.filter(
        (message) => message.type === COLLAB_MESSAGE_TYPE.Event,
      ),
    ).toHaveLength(1);
  });

  it("still fans out when the peer leaves during a durable append", async () => {
    const append = deferred<ReadonlyArray<string>>();
    const fixture = createFixture();
    fixture.controls.appendImpl = async () => append.promise;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-leave-during-append");
    await authenticate(room, peer);

    const receiving = room.receive(peer, eventMessage());
    await vi.waitFor(() => expect(fixture.append).toHaveBeenCalledOnce());
    const leaving = room.leave(peer, ROOM_LEAVE_REASON.ConnectionClosed);
    append.resolve(["batch-1"]);
    await Promise.all([receiving, leaving]);

    expect(fixture.fanout.published).toHaveLength(1);
    expect(fixture.leases[0]?.releaseCalls).toBe(1);
  });

  it("releases setup acquired after a concurrent leave without sending Ready", async () => {
    const admission = deferred<ConnectionAdmission>();
    const fixture = createFixture();
    fixture.controls.acquireImpl = async () => admission.promise;
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-leave-during-setup");
    await room.join(peer);

    const authenticating = room.receive(peer, authMessage());
    await vi.waitFor(() => expect(fixture.acquire).toHaveBeenCalledOnce());
    const leaving = room.leave(peer);
    const lease = new FakeLease();
    admission.resolve({ accepted: true, lease });
    await Promise.all([authenticating, leaving]);

    expect(lease.releaseCalls).toBe(1);
    expect(
      peer.messages.some(
        (message) => message.type === COLLAB_MESSAGE_TYPE.Ready,
      ),
    ).toBe(false);
  });

  it("makes repeated leave and close cleanup idempotent", async () => {
    const fixture = createFixture();
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-idempotent-cleanup");
    await authenticate(room, peer);

    await Promise.all([room.leave(peer), room.leave(peer)]);
    await Promise.all([room.close(), room.close()]);

    expect(fixture.leases[0]?.releaseCalls).toBe(1);
    expect(fixture.fanout.unsubscribeCalls).toBe(1);
    expect(fixture.end).toHaveBeenCalledTimes(1);
    expect(fixture.end).toHaveBeenCalledWith(
      expect.anything(),
      DOCUMENT_SESSION_END_REASON.PeerLeft,
    );
  });

  it("makes concurrent close callers await the same cleanup", async () => {
    const sessionEnd = deferred<void>();
    const fixture = createFixture();
    fixture.end.mockImplementationOnce(async () => sessionEnd.promise);
    const room = createRoom(fixture);
    const peer = new FakePeer("peer-concurrent-close");
    await authenticate(room, peer);

    const firstClose = room.close();
    await vi.waitFor(() => expect(fixture.end).toHaveBeenCalledOnce());
    let secondResolved = false;
    const secondClose = room.close().then(() => {
      secondResolved = true;
    });
    await Promise.resolve();

    expect(secondResolved).toBe(false);
    sessionEnd.resolve();
    await Promise.all([firstClose, secondClose]);
    expect(secondResolved).toBe(true);
  });
});
