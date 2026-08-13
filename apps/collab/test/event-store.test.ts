import {
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  createBlockReplica,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaEventStoreMock } from "./helpers/prismaEventStoreMock";
import { TEST_BOOTSTRAP_BATCH } from "./helpers/bootstrapBatch";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const mocks = createPrismaEventStoreMock();

vi.doMock("../server/utils/prisma", () => ({
  prisma: mocks.prisma,
}));

const { appendEventBatches, EVENT_CONFLICT_TYPE, EventConflictError } =
  await import("../server/utils/event-store");

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";

const hasStoredBatch = (batchId: string): boolean =>
  [...mocks.state.batches.values()].some((row) => row.batch_id === batchId);

const BOOTSTRAP_BATCH = TEST_BOOTSTRAP_BATCH;

const createCausalBatches = (): {
  readonly first: RichTextEventBatch;
  readonly second: RichTextEventBatch;
} => {
  const replica = createBlockReplica("replica-a");
  const first = replica.transact((transaction) => {
    transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
  });
  const second = replica.transact((transaction) => {
    transaction.insertText(BOOTSTRAP_BLOCK_ID, 1, "B");
  });
  if (first === null || second === null) {
    throw new Error("expected local batches");
  }
  return { first, second };
};

describe("appendEventBatches conflict paths", () => {
  beforeEach(() => {
    mocks.reset();
    mocks.state.eventIds.set(BOOTSTRAP_EVENT_ID, "0");
  });

  it("rejects duplicate event IDs inside the incoming request", async () => {
    const { first } = createCausalBatches();
    const duplicate = {
      ...first,
      batchId: "other-batch",
      events: first.events,
    } as RichTextEventBatch;

    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [first, duplicate]),
    ).rejects.toMatchObject({
      name: "EventConflictError",
      details: {
        conflictType: EVENT_CONFLICT_TYPE.DuplicateIncomingEventId,
      },
    });
  });

  it("rejects batches that reference missing parent history", async () => {
    const { second } = createCausalBatches();

    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [second]),
    ).rejects.toMatchObject({
      name: "EventConflictError",
      message: expect.stringContaining("has not been stored"),
      details: {
        conflictType: EVENT_CONFLICT_TYPE.MissingParentHistory,
        missingParentIds: expect.arrayContaining([expect.any(String)]),
      },
    });
  });

  it("rejects the same batchId with a different payload", async () => {
    const { first, second } = createCausalBatches();
    await appendEventBatches(DOCUMENT_ID, ACTOR_ID, [first]);

    const conflicting = {
      ...second,
      batchId: first.batchId,
    } as RichTextEventBatch;

    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [conflicting]),
    ).rejects.toMatchObject({
      name: "EventConflictError",
      details: {
        conflictType: EVENT_CONFLICT_TYPE.BatchPayloadConflict,
        batchIds: [first.batchId],
      },
    });
  });

  it("accepts an exact duplicate batch resend idempotently", async () => {
    const { first } = createCausalBatches();
    const firstIds = await appendEventBatches(DOCUMENT_ID, ACTOR_ID, [first]);
    const secondIds = await appendEventBatches(DOCUMENT_ID, ACTOR_ID, [first]);
    expect(firstIds).toEqual([first.batchId]);
    expect(secondIds).toEqual([first.batchId]);
    expect(mocks.state.batches.size).toBe(1);
  });

  it("serializes overlapping concurrent appends so the child becomes durable", async () => {
    const { first, second } = createCausalBatches();
    const gate = deferred<void>();
    let createCount = 0;
    mocks.state.beforeCreateBatch = async () => {
      createCount += 1;
      if (createCount === 1) {
        // Hold the first transaction after it has the advisory lock and is
        // about to insert, while the overlapping request is already waiting.
        await gate.promise;
      }
    };

    const firstWrite = appendEventBatches(DOCUMENT_ID, ACTOR_ID, [first]);
    const overlappingWrite = appendEventBatches(DOCUMENT_ID, ACTOR_ID, [
      first,
      second,
    ]);

    await vi.waitFor(() => {
      expect(mocks.state.lockWaiters.length).toBe(1);
    });

    gate.resolve();
    await expect(firstWrite).resolves.toEqual([first.batchId]);
    await expect(overlappingWrite).resolves.toEqual([
      first.batchId,
      second.batchId,
    ]);
    expect(hasStoredBatch(first.batchId)).toBe(true);
    expect(hasStoredBatch(second.batchId)).toBe(true);
  });

  it("stores a causal child after its parent commits under lock ordering", async () => {
    const { first, second } = createCausalBatches();
    await appendEventBatches(DOCUMENT_ID, ACTOR_ID, [first]);
    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [second]),
    ).resolves.toEqual([second.batchId]);
  });

  it("rejects reversed causally dependent batches in one request", async () => {
    const { first, second } = createCausalBatches();
    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [second, first]),
    ).rejects.toMatchObject({
      name: "EventConflictError",
      details: {
        conflictType: EVENT_CONFLICT_TYPE.MissingParentHistory,
        batchIds: [second.batchId],
      },
    });
    expect(hasStoredBatch(first.batchId)).toBe(false);
    expect(hasStoredBatch(second.batchId)).toBe(false);
  });

  it("accepts causally ordered dependent batches in one request", async () => {
    const { first, second } = createCausalBatches();
    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [first, second]),
    ).resolves.toEqual([first.batchId, second.batchId]);
    expect(hasStoredBatch(first.batchId)).toBe(true);
    expect(hasStoredBatch(second.batchId)).toBe(true);
  });

  it("exposes structured conflict details for diagnostics", () => {
    const missing = new EventConflictError("missing", {
      conflictType: EVENT_CONFLICT_TYPE.MissingParentHistory,
      documentId: DOCUMENT_ID,
      missingParentIds: ["a"],
    });
    const payload = new EventConflictError("payload", {
      conflictType: EVENT_CONFLICT_TYPE.BatchPayloadConflict,
      documentId: DOCUMENT_ID,
      batchIds: ["b"],
    });
    expect(missing.details.conflictType).toBe(
      EVENT_CONFLICT_TYPE.MissingParentHistory,
    );
    expect(payload.details.conflictType).toBe(
      EVENT_CONFLICT_TYPE.BatchPayloadConflict,
    );
  });

  it("seeds bootstrap history without requiring a prior stored parent", async () => {
    mocks.state.eventIds.delete(BOOTSTRAP_EVENT_ID);
    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [BOOTSTRAP_BATCH]),
    ).resolves.toEqual([BOOTSTRAP_BATCH_ID]);
    expect(hasStoredBatch(BOOTSTRAP_BATCH_ID)).toBe(true);
    expect(mocks.state.eventIds.has(BOOTSTRAP_EVENT_ID)).toBe(true);
  });
});
