import { describe, expect, it, vi } from "vitest";
import {
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  BOOTSTRAP_TIMESTAMP,
  BLOCK_MARKER,
  BLOCK_MODEL_SCHEMA_VERSION,
} from "@softmaple/block-model";
import {
  CollabErrorCode,
  CollabProtocolError,
} from "@softmaple/collab-protocol";
import { appendEventBatch, hashPayload } from "./event-batches";

const bootstrapBatch = {
  schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
  batchId: BOOTSTRAP_BATCH_ID,
  parentVersion: [] as string[],
  events: [
    {
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      id: BOOTSTRAP_EVENT_ID,
      parentVersion: [] as string[],
      timestamp: BOOTSTRAP_TIMESTAMP,
      operation: { type: "insert" as const, index: 0, text: BLOCK_MARKER },
      effect: {
        type: "bootstrap" as const,
        blockId: BOOTSTRAP_BLOCK_ID,
        fields: {
          type: "paragraph" as const,
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
};

const documentId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

const sampleBatch = {
  schemaVersion: 1,
  batchId: "replica-a:1",
  parentVersion: [BOOTSTRAP_EVENT_ID],
  events: [
    {
      schemaVersion: 1,
      id: "replica-a:1",
      parentVersion: [BOOTSTRAP_EVENT_ID],
      timestamp: 1,
      operation: { type: "insert" as const, index: 1, text: "Hi" },
      effect: {
        type: "text-insert" as const,
        blockId: "softmaple:block-model:bootstrap:block:v1",
        text: "Hi",
      },
    },
  ],
};

type BatchRow = {
  id: bigint;
  document_id: string;
  batch_id: string;
  payload_hash: string;
  payload: unknown;
};

const createMockPrisma = () => {
  const batches = new Map<string, BatchRow>();
  const eventIds = new Map<string, { event_id: string; batch_id: string }>();
  let nextId = 1n;

  const tx = {
    documentEventBatch: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            document_id_batch_id: { document_id: string; batch_id: string };
          };
        }) => {
          const key = `${where.document_id_batch_id.document_id}:${where.document_id_batch_id.batch_id}`;
          return batches.get(key) ?? null;
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            document_id: string;
            batch_id: string;
            payload_hash: string;
            payload: unknown;
            events: { create: Array<{ event_id: string; batch_id?: string }> };
          };
        }) => {
          const key = `${data.document_id}:${data.batch_id}`;
          const row: BatchRow = {
            id: nextId++,
            document_id: data.document_id,
            batch_id: data.batch_id,
            payload_hash: data.payload_hash,
            payload: data.payload,
          };
          batches.set(key, row);
          for (const event of data.events.create) {
            eventIds.set(`${data.document_id}:${event.event_id}`, {
              event_id: event.event_id,
              batch_id: data.batch_id,
            });
          }
          return row;
        },
      ),
    },
    documentEventId: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            document_id: string;
            event_id?: { in: string[] };
          };
        }) => {
          const rows = [...eventIds.values()].filter((row) => {
            const full = [...eventIds.entries()].find(
              ([, value]) => value === row,
            );
            return full?.[0]?.startsWith(`${where.document_id}:`);
          });
          if (where.event_id?.in) {
            return rows.filter((row) =>
              where.event_id!.in.includes(row.event_id),
            );
          }
          return [...eventIds.entries()]
            .filter(([key]) => key.startsWith(`${where.document_id}:`))
            .map(([, value]) => value);
        },
      ),
    },
  };

  return {
    prisma: {
      $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx),
    },
    tx,
    batches,
    eventIds,
  };
};

describe("appendEventBatch", () => {
  it("inserts a valid batch and is idempotent on retry", async () => {
    const { prisma } = createMockPrisma();
    const first = await appendEventBatch(prisma as never, {
      documentId,
      createdBy: userId,
      payload: sampleBatch,
    });
    expect(first.kind).toBe("inserted");

    const second = await appendEventBatch(prisma as never, {
      documentId,
      createdBy: userId,
      payload: sampleBatch,
    });
    expect(second.kind).toBe("idempotent");
    expect(second.cursor).toBe(first.cursor);
  });

  it("rejects payload conflicts for the same batch id", async () => {
    const { prisma } = createMockPrisma();
    await appendEventBatch(prisma as never, {
      documentId,
      createdBy: userId,
      payload: sampleBatch,
    });

    const conflicting = {
      ...sampleBatch,
      events: [
        {
          ...sampleBatch.events[0]!,
          operation: { type: "insert" as const, index: 1, text: "Yo" },
          effect: {
            type: "text-insert" as const,
            blockId: "softmaple:block-model:bootstrap:block:v1",
            text: "Yo",
          },
        },
      ],
    };

    await expect(
      appendEventBatch(prisma as never, {
        documentId,
        createdBy: userId,
        payload: conflicting,
      }),
    ).rejects.toMatchObject({ code: CollabErrorCode.BatchConflict });
  });

  it("rejects reused event ids across batches", async () => {
    const { prisma } = createMockPrisma();
    await appendEventBatch(prisma as never, {
      documentId,
      createdBy: userId,
      payload: sampleBatch,
    });

    const reused = {
      schemaVersion: 1,
      batchId: "replica-b:1",
      parentVersion: ["replica-a:1"],
      events: [
        {
          schemaVersion: 1,
          id: "replica-a:1",
          parentVersion: ["replica-a:1"],
          timestamp: 2,
          operation: { type: "insert" as const, index: 3, text: "!" },
          effect: {
            type: "text-insert" as const,
            blockId: "softmaple:block-model:bootstrap:block:v1",
            text: "!",
          },
        },
      ],
    };

    // batchId must equal first event id — adjust to pass schema, still reuse id
    const reusedFixed = {
      ...reused,
      batchId: "replica-a:1",
      parentVersion: [BOOTSTRAP_EVENT_ID],
      events: [
        {
          ...reused.events[0]!,
          id: "replica-a:1",
          parentVersion: [BOOTSTRAP_EVENT_ID],
        },
      ],
    };

    // Same batch id hits conflict path; use different batch with same event via mock
    const { prisma: prisma2, eventIds } = createMockPrisma();
    eventIds.set(`${documentId}:shared:1`, {
      event_id: "shared:1",
      batch_id: "other",
    });
    // Pre-seed a known parent event so unknown-parent does not fire first.
    eventIds.set(`${documentId}:${BOOTSTRAP_EVENT_ID}`, {
      event_id: BOOTSTRAP_EVENT_ID,
      batch_id: "bootstrap",
    });
    eventIds.set(`${documentId}:shared:1`, {
      event_id: "shared:1",
      batch_id: "prior-batch",
    });

    const batch = {
      schemaVersion: 1,
      batchId: "shared:1",
      parentVersion: [BOOTSTRAP_EVENT_ID],
      events: [
        {
          schemaVersion: 1,
          id: "shared:1",
          parentVersion: [BOOTSTRAP_EVENT_ID],
          timestamp: 1,
          operation: { type: "insert" as const, index: 1, text: "x" },
          effect: {
            type: "text-insert" as const,
            blockId: "softmaple:block-model:bootstrap:block:v1",
            text: "x",
          },
        },
      ],
    };

    await expect(
      appendEventBatch(prisma2 as never, {
        documentId,
        createdBy: userId,
        payload: batch,
      }),
    ).rejects.toMatchObject({ code: CollabErrorCode.EventIdConflict });

    void reusedFixed;
  });

  it("rejects unknown parents", async () => {
    const { prisma } = createMockPrisma();
    const orphan = {
      schemaVersion: 1,
      batchId: "replica-a:9",
      parentVersion: ["missing:1"],
      events: [
        {
          schemaVersion: 1,
          id: "replica-a:9",
          parentVersion: ["missing:1"],
          timestamp: 1,
          operation: { type: "insert" as const, index: 1, text: "x" },
          effect: {
            type: "text-insert" as const,
            blockId: "softmaple:block-model:bootstrap:block:v1",
            text: "x",
          },
        },
      ],
    };

    await expect(
      appendEventBatch(prisma as never, {
        documentId,
        createdBy: userId,
        payload: orphan,
      }),
    ).rejects.toBeInstanceOf(CollabProtocolError);

    await expect(
      appendEventBatch(prisma as never, {
        documentId,
        createdBy: userId,
        payload: orphan,
      }),
    ).rejects.toMatchObject({ code: CollabErrorCode.UnknownParent });
  });

  it("accepts the bootstrap batch", async () => {
    const { prisma } = createMockPrisma();
    const result = await appendEventBatch(prisma as never, {
      documentId,
      createdBy: userId,
      payload: bootstrapBatch,
    });
    expect(result.kind).toBe("inserted");
    expect(hashPayload(bootstrapBatch)).toHaveLength(64);
  });
});
