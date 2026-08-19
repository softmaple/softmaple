import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventStoreRouteMocks } from "./helpers/eventStoreMocks";
import { TEST_BOOTSTRAP_BATCH } from "./helpers/bootstrapBatch";

const mocks = vi.hoisted(() => ({
  authorizeDocument: vi.fn(),
  appendEventBatches: vi.fn(),
  readEventPage: vi.fn(),
  authenticateBrowserOrigin: vi.fn(),
  logDocumentMetric: vi.fn(),
}));

vi.mock("nitro", () => ({
  defineHandler: (handler: unknown) => handler,
}));

vi.mock("../server/utils/auth", () => ({
  authorizeDocument: mocks.authorizeDocument,
}));

vi.mock("../server/utils/origin-auth", () => ({
  authenticateBrowserOrigin: mocks.authenticateBrowserOrigin,
}));

vi.mock("../server/utils/event-store", async () => {
  const { eventStoreRouteMocks: routeMocks } = await import(
    "./helpers/eventStoreMocks"
  );
  return {
    appendEventBatches: mocks.appendEventBatches,
    ...routeMocks,
    readEventPage: mocks.readEventPage,
  };
});

vi.mock("../server/adapters/nitro-document-host", () => ({
  logDocumentMetric: mocks.logDocumentMetric,
}));

vi.mock("../server/adapters/prisma-document-event-store", () => ({
  runtimeConflictType: (conflictType: string) => conflictType,
}));

import historyRoute from "../server/routes/collab/document-history.get";
import eventsRoute from "../server/routes/collab/document-events.post";

type RouteHandler = (event: {
  readonly req: Request;
}) => Promise<Response> | Response;

const history = historyRoute as unknown as RouteHandler;
const events = eventsRoute as unknown as RouteHandler;

describe("private document HTTP routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateBrowserOrigin.mockReturnValue({
      browserOrigin: "http://localhost:3000",
    });
  });

  it("should reject unauthenticated history reads", async () => {
    const response = await history({
      req: new Request(
        "http://localhost:3002/collab/document-history?documentId=00000000-0000-4000-8000-000000000001&after=0",
      ),
    });
    expect(response.status).toBe(401);
  });

  it("should return history for an authorized member", async () => {
    mocks.authorizeDocument.mockResolvedValue({
      accessMode: "authenticated",
      documentId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      role: "EDITOR",
      canWrite: true,
    });
    mocks.readEventPage.mockResolvedValue({
      batches: [],
      nextCursor: "0",
      complete: true,
    });

    const response = await history({
      req: new Request(
        "http://localhost:3002/collab/document-history?documentId=00000000-0000-4000-8000-000000000001&after=0",
        {
          headers: {
            authorization: "Bearer token",
            origin: "http://localhost:3000",
          },
        },
      ),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batches: [],
      nextCursor: "0",
      complete: true,
    });
  });

  it("should reject writes from viewers", async () => {
    mocks.authorizeDocument.mockResolvedValue({
      accessMode: "authenticated",
      documentId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      role: "VIEWER",
      canWrite: false,
    });

    const response = await events({
      req: new Request("http://localhost:3002/collab/document-events", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          documentId: "00000000-0000-4000-8000-000000000001",
          batches: [],
        }),
      }),
    });

    expect(response.status).toBe(403);
    expect(mocks.appendEventBatches).not.toHaveBeenCalled();
  });

  it("should log a conflict metric and return 409 on write conflict", async () => {
    mocks.authorizeDocument.mockResolvedValue({
      accessMode: "authenticated",
      documentId: "00000000-0000-4000-8000-000000000001",
      userId: "user-1",
      role: "EDITOR",
      canWrite: true,
    });
    mocks.appendEventBatches.mockRejectedValue(
      new eventStoreRouteMocks.EventConflictError("conflict", {
        conflictType: "missing-parent-history",
        documentId: "00000000-0000-4000-8000-000000000001",
      }),
    );

    const response = await events({
      req: new Request("http://localhost:3002/collab/document-events", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          documentId: "00000000-0000-4000-8000-000000000001",
          batches: [TEST_BOOTSTRAP_BATCH],
        }),
      }),
    });

    expect(response.status).toBe(409);
    expect(mocks.logDocumentMetric).toHaveBeenCalledWith({
      type: "event-conflict",
      conflictType: "missing-parent-history",
      documentId: "00000000-0000-4000-8000-000000000001",
      messageType: "http-append",
    });
  });
});
