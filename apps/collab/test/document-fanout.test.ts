import {
  BLOCK_MARKER,
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  BOOTSTRAP_TIMESTAMP,
} from "@softmaple/block-model";
import {
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
} from "@softmaple/collab-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryRealtime,
  documentRealtimeChannel,
  documentTopicHub,
  getDocumentTopicBridge,
  resetTopicBridgesForTests,
  setRealtimeForTests,
} from "../server/utils/realtime";

const VALID_BATCH = {
  schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
  batchId: BOOTSTRAP_BATCH_ID,
  parentVersion: [],
  events: [
    {
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      id: BOOTSTRAP_EVENT_ID,
      parentVersion: [],
      timestamp: BOOTSTRAP_TIMESTAMP,
      operation: { type: "insert", index: 0, text: BLOCK_MARKER },
      effect: {
        type: "bootstrap",
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

vi.mock("../server/utils/event-store", () => ({
  appendEventBatches: mocks.appendEventBatches,
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

interface TestDocumentRoute {
  readonly message: (
    peer: TestPeer,
    message: { readonly text: () => string },
  ) => Promise<void>;
  readonly close: (peer: TestPeer) => Promise<void>;
}

const route = documentRoute as unknown as TestDocumentRoute;
const ALLOWED_ORIGIN = "http://localhost:3000";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";

const createPeer = (): TestPeer => ({
  context: { browserOrigin: ALLOWED_ORIGIN },
  close: vi.fn(),
  send: vi.fn(),
});

const authMessage = {
  text: () =>
    JSON.stringify({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Auth,
      credential: { kind: "access-token", token: "access-token" },
      documentId: DOCUMENT_ID,
      sessionId: "session-writer",
    }),
};

describe("document event fan-out across instances", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COLLAB_ALLOWED_ORIGINS", ALLOWED_ORIGIN);
    setRealtimeForTests(createMemoryRealtime());
    await resetTopicBridgesForTests();
    mocks.authorizeDocument.mockResolvedValue({
      accessMode: "authenticated",
      documentId: DOCUMENT_ID,
      userId: "00000000-0000-4000-8000-000000000002",
      role: "EDITOR",
      canWrite: true,
    });
    mocks.appendEventBatches.mockResolvedValue(["batch-1"]);
  });

  afterEach(async () => {
    await resetTopicBridgesForTests();
    setRealtimeForTests(null);
    vi.unstubAllEnvs();
  });

  it("publishes persisted events to peers on another simulated instance", async () => {
    const writer = createPeer();
    await route.message(writer, authMessage);

    const remoteChannel = documentRealtimeChannel(
      DOCUMENT_ID,
      COLLAB_PROTOCOL_VERSION,
    );
    const remotePeer = { send: vi.fn() };
    const unsubscribeRemote = documentTopicHub.subscribe(
      remoteChannel,
      remotePeer,
    );
    // Simulate a second instance retaining the same distributed channel.
    await getDocumentTopicBridge().retain(remoteChannel);

    const batches = [VALID_BATCH];
    await route.message(writer, {
      text: () =>
        JSON.stringify({
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Event,
          batches,
        }),
    });

    expect(mocks.appendEventBatches).toHaveBeenCalledTimes(1);
    expect(writer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.DurableAck,
        batchIds: ["batch-1"],
      }),
    );
    expect(remotePeer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Event,
        batches,
      }),
    );

    unsubscribeRemote();
    await getDocumentTopicBridge().release(remoteChannel);
    await route.close(writer);
  });

  it("does not publish when durable persistence fails", async () => {
    mocks.appendEventBatches.mockRejectedValueOnce(new Error("db down"));
    const writer = createPeer();
    await route.message(writer, authMessage);

    const remoteChannel = documentRealtimeChannel(
      DOCUMENT_ID,
      COLLAB_PROTOCOL_VERSION,
    );
    const remotePeer = { send: vi.fn() };
    const unsubscribeRemote = documentTopicHub.subscribe(
      remoteChannel,
      remotePeer,
    );
    await getDocumentTopicBridge().retain(remoteChannel);

    await route.message(writer, {
      text: () =>
        JSON.stringify({
          protocolVersion: COLLAB_PROTOCOL_VERSION,
          type: COLLAB_MESSAGE_TYPE.Event,
          batches: [VALID_BATCH],
        }),
    });

    expect(remotePeer.send).not.toHaveBeenCalled();
    expect(writer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COLLAB_MESSAGE_TYPE.Error,
        code: "persistence-failed",
      }),
    );

    unsubscribeRemote();
    await getDocumentTopicBridge().release(remoteChannel);
    await route.close(writer);
  });
});
