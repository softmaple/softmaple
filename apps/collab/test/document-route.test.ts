import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
} from "@softmaple/collab-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  readonly message: (peer: TestPeer, message: TestRawMessage) => Promise<void>;
}

const route = documentRoute as unknown as TestDocumentRoute;

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
