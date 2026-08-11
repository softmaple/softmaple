import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
} from "@softmaple/collab-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryRealtime,
  resetTopicBridgesForTests,
  setRealtimeForTests,
} from "../server/utils/realtime";
import { EVENT_CONFLICT_TYPE } from "../server/utils/event-conflict";
import { TEST_BOOTSTRAP_BATCH } from "./helpers/bootstrapBatch";
import { MockEventConflictError } from "./helpers/eventStoreMocks";

const VALID_BATCH = TEST_BOOTSTRAP_BATCH;

const mocks = vi.hoisted(() => ({
  authorizeDocument: vi.fn(),
  appendEventBatches: vi.fn(),
}));

vi.mock("nitro", () => ({
  defineWebSocketHandler: (hooks: unknown) => hooks,
}));

vi.mock("../server/utils/auth", () => ({
  authorizeDocument: mocks.authorizeDocument,
}));

vi.mock("../server/utils/event-store", async () => {
  const { eventStoreRouteMocks } = await import("./helpers/eventStoreMocks");
  return {
    appendEventBatches: mocks.appendEventBatches,
    ...eventStoreRouteMocks,
    readEventPage: vi.fn(),
  };
});

import documentRoute from "../server/routes/collab/document";

const mockedAppendEventBatches = vi.mocked(mocks.appendEventBatches);

interface TestPeer {
  readonly context: Record<string, unknown>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
}

interface TestRawMessage {
  readonly text: () => string;
}

interface TestDocumentRoute {
  readonly upgrade: (request: Request) => Promise<{
    readonly namespace: string;
    readonly context: Record<string, unknown>;
  }>;
  readonly message: (peer: TestPeer, message: TestRawMessage) => Promise<void>;
  readonly close: (peer: TestPeer) => Promise<void>;
}

const route = documentRoute as unknown as TestDocumentRoute;
const ALLOWED_ORIGIN = "http://localhost:3000";

const browserUpgradeRequest = (): Request =>
  new Request("http://localhost:3002/collab/document", {
    method: "GET",
    headers: { origin: ALLOWED_ORIGIN },
  });

const createPeer = (): TestPeer => ({
  context: {},
  close: vi.fn(),
  send: vi.fn(),
});

const authMessage = (
  sessionId: string,
  documentId = "00000000-0000-4000-8000-000000000001",
): TestRawMessage => ({
  text: () =>
    JSON.stringify({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Auth,
      credential: { kind: "access-token", token: "access-token" },
      documentId,
      sessionId,
    }),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe("collaboration document authentication", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", ALLOWED_ORIGIN);
    await setRealtimeForTests(createMemoryRealtime());
    await resetTopicBridgesForTests();
  });

  afterEach(async () => {
    await resetTopicBridgesForTests();
    await setRealtimeForTests(null);
    vi.unstubAllEnvs();
  });

  it("accepts a same-origin browser upgrade before creating peer context", async () => {
    const upgrade = await route.upgrade(browserUpgradeRequest());

    expect(upgrade).toEqual({
      namespace: "softmaple-collab-v3",
      context: {
        browserOrigin: ALLOWED_ORIGIN,
      },
    });
  });

  it.each([
    [
      "missing origin",
      () => new Request("http://localhost:3002/collab/document"),
    ],
    [
      "disallowed origin",
      () =>
        new Request("http://localhost:3002/collab/document", {
          headers: { origin: "https://evil.example" },
        }),
    ],
  ])("rejects a %s upgrade with a generic 403", async (_case, request) => {
    const rejection = await route.upgrade(request()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(Response);
    expect((rejection as Response).status).toBe(403);
    expect(await (rejection as Response).text()).toBe("Forbidden");
  });

  it("fails closed when no allowed origins are configured", async () => {
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", undefined);
    const rejection = await route.upgrade(browserUpgradeRequest()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(Response);
    expect((rejection as Response).status).toBe(403);
    expect(await (rejection as Response).text()).toBe("Forbidden");
  });

  it("measures the raw UTF-8 payload and closes oversized messages", async () => {
    const peer = createPeer();

    await route.message(peer, {
      text: () => "界".repeat(90_000),
    });

    expect(peer.send).not.toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalledWith(
      1009,
      "Collaboration message is too large",
    );
    await route.close(peer);
  });

  it("keeps malformed JSON as a non-retryable protocol error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const peer = createPeer();

    await route.message(peer, { text: () => "{not-json" });

    expect(peer.send).toHaveBeenCalledWith({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Error,
      code: "invalid-message",
      message: "The collaboration message is invalid",
      retryable: false,
    });
    expect(peer.close).not.toHaveBeenCalled();
    await route.close(peer);
    errorSpy.mockRestore();
  });

  it("enforces the fixed-window message quota before parsing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const peer = createPeer();

    for (let index = 0; index <= 120; index += 1) {
      await route.message(peer, { text: () => "{}" });
    }

    expect(peer.send).toHaveBeenLastCalledWith({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Error,
      code: "invalid-message",
      message: "Too many collaboration messages",
      retryable: true,
    });
    expect(peer.close).toHaveBeenCalledWith(
      1013,
      "Message rate limit exceeded",
    );
    await route.close(peer);
    errorSpy.mockRestore();
  });

  it("still rejects an invalid Supabase token after Origin succeeds", async () => {
    const upgrade = await route.upgrade(browserUpgradeRequest());
    mocks.authorizeDocument.mockResolvedValueOnce(null);
    const peer = { ...createPeer(), context: { ...upgrade.context } };

    await route.message(peer, authMessage("session-invalid"));

    expect(mocks.authorizeDocument).toHaveBeenCalledWith(
      { kind: "access-token", token: "access-token" },
      "00000000-0000-4000-8000-000000000001",
    );
    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Error,
        code: "authentication-failed",
      }),
    );
    expect(peer.close).toHaveBeenCalledWith(1008, "Unauthorized");
    await route.close(peer);
  });

  it("allows a new document Auth after a temporary provider failure", async () => {
    const firstDocumentId = "00000000-0000-4000-8000-000000000011";
    const secondDocumentId = "00000000-0000-4000-8000-000000000022";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.authorizeDocument
      .mockRejectedValueOnce(new Error("auth unavailable"))
      .mockResolvedValueOnce({
        accessMode: "authenticated",
        documentId: secondDocumentId,
        userId: "00000000-0000-4000-8000-000000000002",
        role: "EDITOR",
        canWrite: true,
      });
    const peer = createPeer();

    await route.message(peer, authMessage("session-first", firstDocumentId));
    expect(peer.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Error,
        code: "authentication-failed",
        retryable: true,
      }),
    );
    expect(peer.close).not.toHaveBeenCalled();

    await route.message(peer, authMessage("session-second", secondDocumentId));
    expect(peer.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Ready,
        documentId: secondDocumentId,
      }),
    );
    expect(mocks.authorizeDocument).toHaveBeenNthCalledWith(
      2,
      { kind: "access-token", token: "access-token" },
      secondDocumentId,
    );

    await route.close(peer);
    errorSpy.mockRestore();
  });

  it("rejects a second Auth message while authorization is pending", async () => {
    const authorization = deferred<{
      readonly accessMode: "authenticated";
      readonly documentId: string;
      readonly userId: string;
      readonly role: "EDITOR";
      readonly canWrite: true;
    }>();
    mocks.authorizeDocument.mockReturnValueOnce(authorization.promise);
    const peer = createPeer();

    const firstAuth = route.message(peer, authMessage("session-1"));
    await vi.waitFor(() => {
      expect(mocks.authorizeDocument).toHaveBeenCalledTimes(1);
    });

    await route.message(peer, authMessage("session-2"));

    expect(mocks.authorizeDocument).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledWith(
      1008,
      "Authentication already in progress",
    );

    authorization.resolve({
      accessMode: "authenticated",
      documentId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      role: "EDITOR",
      canWrite: true,
    });
    await firstAuth;
    await route.close(peer);
  });

  it("releases the document connection slot when access is cleared before close", async () => {
    const documentId = "00000000-0000-4000-8000-000000000099";
    const access = {
      accessMode: "authenticated" as const,
      documentId,
      userId: "00000000-0000-4000-8000-000000000002",
      role: "EDITOR" as const,
      canWrite: true as const,
    };
    const peers: TestPeer[] = [];
    for (let index = 0; index < 100; index += 1) {
      mocks.authorizeDocument.mockResolvedValueOnce(access);
      const peer = createPeer();
      await route.message(peer, authMessage(`session-${index}`, documentId));
      expect(peer.close).not.toHaveBeenCalled();
      peers.push(peer);
    }

    mocks.authorizeDocument.mockResolvedValueOnce(access);
    const blocked = createPeer();
    await route.message(blocked, authMessage("session-blocked", documentId));
    expect(blocked.close).toHaveBeenCalledWith(
      1013,
      "Document connection limit reached",
    );
    await route.close(blocked);

    // Releasing a physical peer must make its distributed slot reusable.
    await route.close(peers[0]!);

    mocks.authorizeDocument.mockResolvedValueOnce(access);
    const replacement = createPeer();
    await route.message(
      replacement,
      authMessage("session-replacement", documentId),
    );
    expect(replacement.close).not.toHaveBeenCalled();

    for (const peer of peers.slice(1)) await route.close(peer);
    await route.close(replacement);
  });
});

describe("collaboration document event conflicts", () => {
  const authenticatedPeers: TestPeer[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    authenticatedPeers.length = 0;
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", ALLOWED_ORIGIN);
    await setRealtimeForTests(createMemoryRealtime());
    await resetTopicBridgesForTests();
    mocks.authorizeDocument.mockResolvedValue({
      accessMode: "authenticated",
      documentId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      role: "EDITOR",
      canWrite: true,
    });
  });

  afterEach(async () => {
    for (const peer of authenticatedPeers) {
      await route.close(peer);
    }
    authenticatedPeers.length = 0;
    await resetTopicBridgesForTests();
    await setRealtimeForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const authedPeer = async (): Promise<TestPeer> => {
    const peer = createPeer();
    await route.message(peer, authMessage("session-writer"));
    peer.send.mockClear();
    authenticatedPeers.push(peer);
    return peer;
  };

  it("marks missing-parent conflicts non-retryable to avoid reconnect loops", async () => {
    mockedAppendEventBatches.mockRejectedValueOnce(
      new MockEventConflictError(
        "event batch references document history that has not been stored",
        {
          conflictType: EVENT_CONFLICT_TYPE.MissingParentHistory,
        },
      ),
    );
    const peer = await authedPeer();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await route.message(peer, {
      text: () =>
        JSON.stringify({
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Event,
          batches: [VALID_BATCH],
        }),
    });

    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Error,
        code: "conflict",
        retryable: false,
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Collaboration request failed",
      expect.objectContaining({
        errorName: "EventConflictError",
        errorMessage: expect.stringContaining("has not been stored"),
        conflictType: EVENT_CONFLICT_TYPE.MissingParentHistory,
      }),
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps payload conflicts non-retryable", async () => {
    mockedAppendEventBatches.mockRejectedValueOnce(
      new MockEventConflictError("conflicting payload for batch batch-1", {
        conflictType: EVENT_CONFLICT_TYPE.BatchPayloadConflict,
        batchIds: ["batch-1"],
      }),
    );
    const peer = await authedPeer();

    await route.message(peer, {
      text: () =>
        JSON.stringify({
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Event,
          batches: [VALID_BATCH],
        }),
    });

    expect(peer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Error,
        code: "conflict",
        retryable: false,
      }),
    );
  });
});
