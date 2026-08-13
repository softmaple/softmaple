import type { RichTextEventBatch } from "@softmaple/block-model";
import { Prisma } from "@softmaple/db";
import { vi } from "vitest";

type StoredBatch = {
  readonly batch_id: string;
  readonly document_id: string;
  readonly payload_hash: string;
  readonly payload: RichTextEventBatch;
  readonly id: bigint;
};

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

/**
 * A hand-rolled `prisma` mock reproducing the exact behaviour
 * `appendEventBatches`/`readEventPage` (`server/utils/event-store.ts`) rely
 * on: the per-document advisory-lock transaction, the write-access role
 * check, unique-constraint conflicts on `documentEventBatch`/`documentEventId`,
 * and paginated reads. Shared by `event-store.test.ts` (direct conflict-path
 * tests) and `document-event-store-conformance.test.ts` (the cross-runtime
 * conformance suite run against the real `prismaDocumentEventStore` adapter).
 */
export const createPrismaEventStoreMock = () => {
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
    // Ownership was transferred by releaseLock; do not toggle holders here.
  };

  const releaseLock = (): void => {
    const next = state.lockWaiters.shift();
    if (next) {
      // Keep the lock held while transferring ownership to the next waiter.
      next();
      return;
    }
    state.lockHolders = 0;
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
            readonly document_id: string;
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
            document_id: data.document_id,
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

  const prisma = {
    $transaction: vi.fn(
      async (
        fn: (tx: typeof transactionClient) => unknown,
        _options?: { readonly maxWait?: number; readonly timeout?: number },
      ) => {
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
          take,
        }: {
          readonly where: {
            readonly batch_id?: { readonly in: ReadonlyArray<string> };
            readonly document_id?: string;
            readonly id?: { readonly gt: bigint };
          };
          readonly take?: number;
        }) => {
          // Two distinct callers share this mock: the P2002-conflict-retry
          // verification path looks up specific batch ids; readEventPage
          // paginates by id cursor within one document. Only the latter
          // needs document scoping / id-order / take.
          if (where.batch_id !== undefined) {
            return where.batch_id.in.flatMap((batchId) => {
              const row = state.batches.get(batchId);
              return row === undefined
                ? []
                : [{ batch_id: row.batch_id, payload_hash: row.payload_hash }];
            });
          }
          const after = where.id?.gt ?? 0n;
          const rows = [...state.batches.values()]
            .filter(
              (row) =>
                row.id > after &&
                (where.document_id === undefined ||
                  row.document_id === where.document_id),
            )
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          const limited = take === undefined ? rows : rows.slice(0, take);
          return limited.map((row) => ({ id: row.id, payload: row.payload }));
        },
      ),
    },
  };

  const reset = (): void => {
    state.batches.clear();
    state.eventIds.clear();
    state.role = "EDITOR";
    state.nextRowId = 1n;
    state.lockHolders = 0;
    state.lockWaiters = [];
    state.beforeCreateBatch = null;
    vi.clearAllMocks();
  };

  return { deferred, prisma, releaseLock, reset, state, transactionClient };
};
