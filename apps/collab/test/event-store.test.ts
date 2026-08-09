import {
  BLOCK_MARKER,
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  BOOTSTRAP_TIMESTAMP,
  createBlockReplica,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import { Prisma } from "@softmaple/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredBatch = {
  readonly batch_id: string;
  readonly payload_hash: string;
  readonly payload: RichTextEventBatch;
  readonly id: bigint;
};

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

const mocks = vi.hoisted(() => {
  const state = {
    batches: new Map<string, StoredBatch>(),
    eventIds: new Map<string, string>(),
    role: "EDITOR" as string | null,
    nextRowId: 1n,
    lockHolders: 0,
    lockWaiters: [] as Array<() => void>,
    beforeCreateBatch: null as null | (() => Promise<void>),
  };

  const acquireLock = async (): Promise<void> => {
    if (state.lockHolders === 0) {
      state.lockHolders = 1;
      return;
    }
    await new Promise<void>((resolve) => {
      state.lockWaiters.push(resolve);
    });
    state.lockHolders = 1;
  };

  const releaseLock = (): void => {
    state.lockHolders = 0;
    const next = state.lockWaiters.shift();
    if (next) next();
  };

  const transactionClient = {
    $executeRaw: vi.fn(async () => {
      // appendEventBatches only uses $executeRaw for the document advisory lock.
      await acquireLock();
      return 0;
    }),
    $queryRaw: vi.fn(async () =>
      state.role === null ? [] : [{ role: state.role }],
    ),
    documentEventBatch: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          readonly where: {
            readonly document_id: string;
            readonly batch_id: { readonly in: ReadonlyArray<string> };
          };
        }) =>
          where.batch_id.in.flatMap((batchId) => {
            const row = state.batches.get(batchId);
            return row === undefined
              ? []
              : [{ batch_id: row.batch_id, payload_hash: row.payload_hash }];
          }),
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          readonly data: {
            readonly batch_id: string;
            readonly payload_hash: string;
            readonly payload: RichTextEventBatch;
          };
        }) => {
          if (state.beforeCreateBatch !== null) {
            await state.beforeCreateBatch();
          }
          if (state.batches.has(data.batch_id)) {
            throw new Prisma.PrismaClientKnownRequestError(
              "Unique constraint",
              {
                code: "P2002",
                clientVersion: "test",
              },
            );
          }
          const id = state.nextRowId;
          state.nextRowId += 1n;
          state.batches.set(data.batch_id, {
            batch_id: data.batch_id,
            payload_hash: data.payload_hash,
            payload: data.payload,
            id,
          });
          return { id };
        },
      ),
    },
    documentEventId: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          readonly where: {
            readonly event_id: { readonly in: ReadonlyArray<string> };
          };
        }) =>
          where.event_id.in.flatMap((eventId) =>
            state.eventIds.has(eventId) ? [{ event_id: eventId }] : [],
          ),
      ),
      createMany: vi.fn(
        async ({
          data,
        }: {
          readonly data: ReadonlyArray<{
            readonly event_id: string;
            readonly batch_row_id: bigint;
          }>;
        }) => {
          for (const row of data) {
            if (state.eventIds.has(row.event_id)) {
              throw new Prisma.PrismaClientKnownRequestError(
                "Unique constraint",
                {
                  code: "P2002",
                  clientVersion: "test",
                },
              );
            }
            state.eventIds.set(row.event_id, String(row.batch_row_id));
          }
          return { count: data.length };
        },
      ),
    },
  };

  return {
    state,
    releaseLock,
    prisma: {
      $transaction: vi.fn(
        async (fn: (tx: typeof transactionClient) => unknown) => {
          try {
            return await fn(transactionClient);
          } finally {
            releaseLock();
          }
        },
      ),
      documentEventBatch: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            readonly where: {
              readonly batch_id?: { readonly in: ReadonlyArray<string> };
            };
          }) => {
            const ids = where.batch_id?.in ?? [...state.batches.keys()];
            return ids.flatMap((batchId) => {
              const row = state.batches.get(batchId);
              return row === undefined
                ? []
                : [
                    {
                      batch_id: row.batch_id,
                      payload_hash: row.payload_hash,
                      id: row.id,
                      payload: row.payload,
                    },
                  ];
            });
          },
        ),
      },
    },
    transactionClient,
  };
});

vi.mock("../server/utils/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  appendEventBatches,
  EVENT_CONFLICT_TYPE,
  EventConflictError,
  isRetryableEventConflict,
} from "../server/utils/event-store";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000002";

const BOOTSTRAP_BATCH = {
  schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
  batchId: BOOTSTRAP_BATCH_ID,
  parentVersion: [],
  events: [
    {
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      id: BOOTSTRAP_EVENT_ID,
      parentVersion: [],
      timestamp: BOOTSTRAP_TIMESTAMP,
      operation: { type: "insert" as const, index: 0, text: BLOCK_MARKER },
      effect: {
        type: "bootstrap" as const,
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
    mocks.state.batches.clear();
    mocks.state.eventIds.clear();
    mocks.state.role = "EDITOR";
    mocks.state.nextRowId = 1n;
    mocks.state.lockHolders = 0;
    mocks.state.lockWaiters = [];
    mocks.state.beforeCreateBatch = null;
    mocks.state.eventIds.set(BOOTSTRAP_EVENT_ID, "0");
    vi.clearAllMocks();
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
    expect(mocks.state.batches.has(first.batchId)).toBe(true);
    expect(mocks.state.batches.has(second.batchId)).toBe(true);
  });

  it("stores a causal child after its parent commits under lock ordering", async () => {
    const { first, second } = createCausalBatches();
    await appendEventBatches(DOCUMENT_ID, ACTOR_ID, [first]);
    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [second]),
    ).resolves.toEqual([second.batchId]);
  });

  it("classifies missing-parent conflicts as retryable and payload clashes as fatal", () => {
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
    expect(isRetryableEventConflict(missing)).toBe(true);
    expect(isRetryableEventConflict(payload)).toBe(false);
  });

  it("seeds bootstrap history without requiring a prior stored parent", async () => {
    await expect(
      appendEventBatches(DOCUMENT_ID, ACTOR_ID, [BOOTSTRAP_BATCH]),
    ).resolves.toEqual([BOOTSTRAP_BATCH_ID]);
  });
});
