import { BOOTSTRAP_BLOCK_ID, createBlockReplica } from "@softmaple/block-model";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgePendingBatches,
  addPendingBatches,
  loadPendingBatches,
} from "@/modules/docs/collab-pending-store";

const createBatch = (replicaId: string, text: string) => {
  const replica = createBlockReplica(replicaId);
  const batch = replica.transact((transaction) => {
    transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, text);
  });
  if (batch === null) throw new Error("Expected a non-empty event batch");
  return batch;
};

describe("collaboration pending store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores batches after a page lifecycle and deduplicates retries", () => {
    const first = createBatch("session-a", "one");
    const second = createBatch("session-b", "two");

    addPendingBatches(window.localStorage, "document-1", "user-1", [first]);
    addPendingBatches(window.localStorage, "document-1", "user-1", [
      first,
      second,
    ]);

    expect(
      loadPendingBatches(window.localStorage, "document-1", "user-1"),
    ).toEqual([first, second]);
  });

  it("removes only batches acknowledged by the collaboration server", () => {
    const first = createBatch("session-a", "one");
    const second = createBatch("session-b", "two");
    addPendingBatches(window.localStorage, "document-1", "user-1", [
      first,
      second,
    ]);

    acknowledgePendingBatches(window.localStorage, "document-1", "user-1", [
      first.batchId,
    ]);

    expect(
      loadPendingBatches(window.localStorage, "document-1", "user-1"),
    ).toEqual([second]);
  });

  it("rejects corrupt persisted data instead of applying it to a replica", () => {
    const key = "softmaple:collab-pending:v2:user-1:document-1";
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, batches: [{ batchId: "broken" }] }),
    );

    expect(() =>
      loadPendingBatches(window.localStorage, "document-1", "user-1"),
    ).toThrow();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("removes invalid JSON before rethrowing its parse error", () => {
    const key = "softmaple:collab-pending:v2:user-1:document-1";
    window.localStorage.setItem(key, "not-json");

    expect(() =>
      loadPendingBatches(window.localStorage, "document-1", "user-1"),
    ).toThrow(SyntaxError);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("isolates pending edits by signed-in user", () => {
    const first = createBatch("session-a", "one");
    addPendingBatches(window.localStorage, "document-1", "user-1", [first]);

    expect(
      loadPendingBatches(window.localStorage, "document-1", "user-2"),
    ).toEqual([]);
  });
});
