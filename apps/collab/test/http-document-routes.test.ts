import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeDocument: vi.fn(),
  appendEventBatches: vi.fn(),
  readEventPage: vi.fn(),
  authenticateBrowserOrigin: vi.fn(),
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

vi.mock("../server/utils/event-store", () => ({
  appendEventBatches: mocks.appendEventBatches,
  EventAuthorizationError: class EventAuthorizationError extends Error {},
  EventConflictError: class EventConflictError extends Error {
    readonly details: { readonly conflictType: string };
    constructor(
      message: string,
      details: { readonly conflictType: string } = {
        conflictType: "stored-event-id-conflict",
      },
    ) {
      super(message);
      this.name = "EventConflictError";
      this.details = details;
    }
  },
  isRetryableEventConflict: (error: {
    readonly details: { readonly conflictType: string };
  }) => error.details.conflictType === "missing-parent-history",
  readEventPage: mocks.readEventPage,
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
});
