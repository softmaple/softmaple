import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
} from "@softmaple/collab-protocol";
import {
  COLLAB_GATEWAY_AUTH_HEADERS,
  createCollabGatewayAuthHeaders,
  parseCollabGatewaySignerConfig,
} from "@softmaple/collab-gateway-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import documentRoute from "../server/routes/document";

interface TestPeer {
  readonly context: Record<string, unknown>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly publish: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
  readonly subscribe: ReturnType<typeof vi.fn>;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
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
}

const route = documentRoute as unknown as TestDocumentRoute;
const GATEWAY_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const GATEWAY_KEY_ID = "2026-08";
const WEB_SOCKET_KEY = "dGhlIHNhbXBsZSBub25jZQ==";

const signedUpgradeRequest = (
  nowSeconds = Math.floor(Date.now() / 1000),
): Request => {
  const headers = createCollabGatewayAuthHeaders({
    config: parseCollabGatewaySignerConfig(GATEWAY_KEY_ID, GATEWAY_SECRET),
    webSocketKey: WEB_SOCKET_KEY,
    nowSeconds,
    nonce: Buffer.from([...Array(16).keys()]),
  });
  headers.set("sec-websocket-key", WEB_SOCKET_KEY);
  return new Request("http://localhost:3002/document", {
    method: "GET",
    headers,
  });
};

const createPeer = (): TestPeer => ({
  context: {},
  close: vi.fn(),
  publish: vi.fn(),
  send: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
});

const authMessage = (sessionId: string): TestRawMessage => ({
  text: () =>
    JSON.stringify({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Auth,
      accessToken: "access-token",
      documentId: "00000000-0000-4000-8000-000000000001",
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "COLLAB_GATEWAY_HMAC_KEYS",
      JSON.stringify({ [GATEWAY_KEY_ID]: GATEWAY_SECRET }),
    );
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a valid gateway signature before creating peer context", async () => {
    const upgrade = await route.upgrade(signedUpgradeRequest());

    expect(upgrade).toEqual({
      namespace: "softmaple-collab-v2",
      context: {
        gatewayAuthMode: "hmac",
        gatewayAuthKeyId: GATEWAY_KEY_ID,
      },
    });
  });

  it.each([
    ["direct", () => new Request("http://localhost:3002/document")],
    ["expired", () => signedUpgradeRequest(Math.floor(Date.now() / 1000) - 31)],
    [
      "tampered",
      () => {
        const request = signedUpgradeRequest();
        request.headers.set(
          COLLAB_GATEWAY_AUTH_HEADERS.signature,
          "A".repeat(43),
        );
        return request;
      },
    ],
  ])("rejects a %s upgrade with a generic 403", async (_case, request) => {
    await expect(route.upgrade(request())).rejects.toMatchObject({
      status: 403,
    });
  });

  it("never downgrades a malformed HMAC request to legacy Origin", async () => {
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", "https://softmaple.ink");
    const request = new Request("http://localhost:3002/document", {
      headers: {
        origin: "https://softmaple.ink",
        [COLLAB_GATEWAY_AUTH_HEADERS.version]: "1",
      },
    });

    await expect(route.upgrade(request)).rejects.toMatchObject({ status: 403 });
  });

  it("allows explicit legacy origins during the rollout window", async () => {
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", "https://softmaple.ink");
    const upgrade = await route.upgrade(
      new Request("http://localhost:3002/document", {
        headers: { origin: "https://softmaple.ink" },
      }),
    );

    expect(upgrade.context).toEqual({ gatewayAuthMode: "legacy" });
  });

  it("fails closed on malformed backend keyring configuration", async () => {
    vi.stubEnv("COLLAB_GATEWAY_HMAC_KEYS", "not-json");
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", "https://softmaple.ink");
    const request = new Request("http://localhost:3002/document", {
      headers: { origin: "https://softmaple.ink" },
    });

    await expect(route.upgrade(request)).rejects.toMatchObject({ status: 403 });
  });

  it("still rejects an invalid Supabase token after HMAC succeeds", async () => {
    const upgrade = await route.upgrade(signedUpgradeRequest());
    mocks.authorizeDocument.mockResolvedValueOnce(null);
    const peer = { ...createPeer(), context: { ...upgrade.context } };

    await route.message(peer, authMessage("session-invalid"));

    expect(mocks.authorizeDocument).toHaveBeenCalledWith(
      "access-token",
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
      documentId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      role: "EDITOR",
      canWrite: true,
    });
    await firstAuth;

    expect(peer.context.authenticationPending).toBeUndefined();
  });
});
