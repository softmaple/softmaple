import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOTSTRAP_BLOCK_ID, createBlockReplica } from "@softmaple/block-model";
import {
  loadPrivateDocumentHistory,
  persistPrivateDocumentEvents,
} from "@/modules/docs/private-document-api";

describe("private document HTTP API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should load history pages until complete and send the bearer token", async () => {
    const replica = createBlockReplica("api-test");
    const batch = replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "private");
    });
    if (batch === null) throw new Error("expected batch");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            batches: [],
            nextCursor: "1",
            complete: false,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            batches: [batch],
            nextCursor: "2",
            complete: true,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const batches = await loadPrivateDocumentHistory({
      accessToken: "token",
      documentId: "00000000-0000-4000-8000-000000000001",
    });

    expect(batches).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/collab/document-history",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer token",
        }),
      }),
    );
  });

  it("should reject a non-advancing history cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          batches: [],
          nextCursor: "0",
          complete: false,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadPrivateDocumentHistory({
        accessToken: "token",
        documentId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("Document history pagination did not advance");
  });

  it("should throw when history loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );

    await expect(
      loadPrivateDocumentHistory({
        accessToken: "token",
        documentId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("Could not load document history (500)");
  });

  it("should throw when history payload shape is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ batches: "nope", complete: true }), {
          status: 200,
        }),
      ),
    );

    await expect(
      loadPrivateDocumentHistory({
        accessToken: "token",
        documentId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("Document history response is invalid");
  });

  it("should post event batches for private persistence with auth", async () => {
    const replica = createBlockReplica("api-test-2");
    const batch = replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "save-me");
    });
    if (batch === null) throw new Error("expected batch");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ batchIds: [batch.batchId] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const batchIds = await persistPrivateDocumentEvents({
      accessToken: "token",
      batches: [batch],
      documentId: "00000000-0000-4000-8000-000000000001",
    });

    expect(batchIds).toEqual([batch.batchId]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/collab/document-events"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer token",
        }),
      }),
    );
  });

  it("should throw when save responses are invalid", async () => {
    const replica = createBlockReplica("api-test-3");
    const batch = replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "broken");
    });
    if (batch === null) throw new Error("expected batch");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ batchIds: "nope" }), { status: 200 }),
        ),
    );

    await expect(
      persistPrivateDocumentEvents({
        accessToken: "token",
        batches: [batch],
        documentId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("Save response is invalid");
  });

  it("should throw when save requests fail", async () => {
    const replica = createBlockReplica("api-test-4");
    const batch = replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "fail");
    });
    if (batch === null) throw new Error("expected batch");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 403 })),
    );

    await expect(
      persistPrivateDocumentEvents({
        accessToken: "token",
        batches: [batch],
        documentId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("Could not save document (403)");
  });
});
