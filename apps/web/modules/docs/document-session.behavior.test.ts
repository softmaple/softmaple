/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  createBlockReplica,
} from "@softmaple/block-model";
import { isDocumentEditable } from "@/modules/docs/document-editability";
import { createSaveCoordinator } from "@/modules/docs/document-save-coordinator";
import {
  loadPrivateDocumentHistory,
  persistPrivateDocumentEvents,
} from "@/modules/docs/private-document-api";

describe("document session behavior contracts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => {
        throw new Error("WebSocket should not open for private documents");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should keep permission-based editability while a save is in flight", async () => {
    const editable = isDocumentEditable({
      permission: "editor",
      sessionMode: "authenticated",
    });
    expect(editable).toBe(true);

    let release: (() => void) | undefined;
    const coordinator = createSaveCoordinator(() => undefined);
    coordinator.requestSave(async () => {
      await new Promise<"empty">((resolve) => {
        release = () => resolve("empty");
      });
      return "empty";
    });

    // Saving must not flip editability.
    expect(
      isDocumentEditable({
        permission: "editor",
        sessionMode: "authenticated",
      }),
    ).toBe(true);
    release?.();
  });

  it("should persist edits made while a prior save is still running", async () => {
    const pending = new Map<string, string>();
    const persisted: string[] = [];
    const coordinator = createSaveCoordinator(() => undefined);

    let releaseFirst: (() => void) | undefined;
    const persist = async (): Promise<"ack" | "empty"> => {
      const snapshot = [...pending.keys()];
      if (snapshot.length === 0) return "empty";
      if (persisted.length === 0) {
        await new Promise<"ack">((resolve) => {
          releaseFirst = () => resolve("ack");
        });
      }
      for (const key of snapshot) {
        persisted.push(key);
        pending.delete(key);
      }
      return pending.size === 0 ? "empty" : "ack";
    };

    pending.set("edit-1", "A");
    coordinator.requestSave(persist);
    pending.set("edit-2", "B");
    coordinator.requestSave(persist);

    await vi.waitFor(() => {
      expect(releaseFirst).toBeTypeOf("function");
    });
    releaseFirst?.();
    await vi.waitFor(() => {
      expect(persisted).toEqual(["edit-1", "edit-2"]);
    });
  });

  it("should seed shared collaboration from existing private replica content", () => {
    const privateReplica = createBlockReplica("private-session");
    privateReplica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "ABCDE");
    });
    privateReplica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 5, "FG");
    });

    const sharedReplica = createBlockReplica("shared-session");
    const exported = privateReplica
      .exportEvents()
      .filter((batch) => batch.batchId !== BOOTSTRAP_BATCH_ID);
    sharedReplica.applyRemoteEvents(exported);

    // Content survives the private → shared handoff when history is flushed
    // before the collaboration socket connects.
    expect(sharedReplica.getDocument().blocks[0]?.text).toBe("ABCDEFG");
  });

  it("should load and save a private document without opening a WebSocket", async () => {
    const replica = createBlockReplica("private-http");
    const batch = replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "solo");
    });
    if (batch === null) throw new Error("expected batch");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            batches: [batch],
            nextCursor: "1",
            complete: true,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ batchIds: [batch.batchId] }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const history = await loadPrivateDocumentHistory({
      accessToken: "token",
      documentId: "00000000-0000-4000-8000-000000000099",
    });
    const batchIds = await persistPrivateDocumentEvents({
      accessToken: "token",
      batches: history,
      documentId: "00000000-0000-4000-8000-000000000099",
    });

    expect(batchIds).toEqual([batch.batchId]);
    expect(WebSocket).not.toHaveBeenCalled();
  });
});
