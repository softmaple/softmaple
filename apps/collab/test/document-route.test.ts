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

const mocks = vi.hoisted(() => ({
  authorizeDocument: vi.fn(),
}));

vi.mock("nitro", () => ({
  defineWebSocketHandler: (hooks: unknown) => hooks,
}));

vi.mock("../server/utils/auth", () => ({
  authorizeDocument: mocks.authorizeDocument,
}));

vi.mock("../server/utils/event-store", () => ({
  appendEventBatches: vi.fn(),
  EventAuthorizationError: class EventAuthorizationError extends Error {},
  EventConflictError: class EventConflictError extends Error {},
  readEventPage: vi.fn(),
}));

import documentRoute from "../server/routes/collab/document";

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
    expect(peer.context.authenticationPending).toBe(true);

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

    expect(peer.context.authenticationPending).toBeUndefined();
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
      expect(peer.context.connectionCounted).toBe(true);
      peers.push(peer);
    }

    mocks.authorizeDocument.mockResolvedValueOnce(access);
    const blocked = createPeer();
    await route.message(blocked, authMessage("session-blocked", documentId));
    expect(blocked.close).toHaveBeenCalledWith(
      1013,
      "Document connection limit reached",
    );

    // Match the revocation path: clear cached access, then close.
    delete peers[0]?.context.documentAccess;
    delete peers[0]?.context.authorizationExpiresAt;
    await route.close(peers[0]!);

    mocks.authorizeDocument.mockResolvedValueOnce(access);
    const replacement = createPeer();
    await route.message(
      replacement,
      authMessage("session-replacement", documentId),
    );
    expect(replacement.context.connectionCounted).toBe(true);
    expect(replacement.close).not.toHaveBeenCalled();

    for (const peer of peers.slice(1)) await route.close(peer);
    await route.close(replacement);
  });
});
