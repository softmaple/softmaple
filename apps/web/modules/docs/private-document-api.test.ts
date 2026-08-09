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

  it("should load history pages until complete", async () => {
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
  });

  it("should post event batches for private persistence", async () => {
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
      expect.objectContaining({ method: "POST" }),
    );
  });
});
