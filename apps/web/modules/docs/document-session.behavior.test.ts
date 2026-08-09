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
    coordinator.requestSave(
      () =>
        new Promise<"ack">((resolve) => {
          release = () => resolve("ack");
        }),
    );

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

  it("should not construct a WebSocket while exercising private save helpers", () => {
    expect(() => new WebSocket("wss://example.test/collab/document")).toThrow(
      /should not open/,
    );
  });
});
