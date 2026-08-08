import { createHash } from "node:crypto";
import {
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_EVENT_ID,
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import {
  CollabErrorCode,
  CollabProtocolError,
  type WireBatch,
} from "@softmaple/collab-protocol";
import type { Prisma, PrismaClient } from "@softmaple/db";

export type AppendBatchResult =
  | {
      readonly kind: "inserted";
      readonly cursor: string;
      readonly batch: RichTextEventBatch;
    }
  | {
      readonly kind: "idempotent";
      readonly cursor: string;
      readonly batch: RichTextEventBatch;
    };

export interface StoredBatchPage {
  readonly batches: ReadonlyArray<{
    readonly cursor: string;
    readonly batch: WireBatch;
  }>;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export const hashPayload = (payload: unknown): string =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");

const asWireBatch = (batch: RichTextEventBatch): WireBatch => batch;

const collectKnownEventIds = async (
  db: Prisma.TransactionClient | PrismaClient,
  documentId: string,
): Promise<Set<string>> => {
  const rows = await db.documentEventId.findMany({
    where: { document_id: documentId },
    select: { event_id: true },
  });
  // Bootstrap is deterministic and local to every replica; treat it as known
  // even when not written to the durable log.
  const known = new Set<string>([BOOTSTRAP_EVENT_ID]);
  for (const row of rows) known.add(row.event_id);
  return known;
};

const assertParentsKnown = (
  batch: RichTextEventBatch,
  knownEventIds: ReadonlySet<string>,
): void => {
  for (const parentId of batch.parentVersion) {
    if (!knownEventIds.has(parentId)) {
      throw new CollabProtocolError(
        CollabErrorCode.UnknownParent,
        `Unknown parent event ${parentId}`,
        { parentId, batchId: batch.batchId },
      );
    }
  }
  // Intra-batch parents are validated by parseRichTextEventBatch chain rules.
  for (let index = 1; index < batch.events.length; index++) {
    const event = batch.events[index]!;
    for (const parentId of event.parentVersion) {
      const previousIds = new Set(
        batch.events.slice(0, index).map((item) => item.id),
      );
      if (!knownEventIds.has(parentId) && !previousIds.has(parentId)) {
        throw new CollabProtocolError(
          CollabErrorCode.UnknownParent,
          `Unknown parent event ${parentId}`,
          { parentId, batchId: batch.batchId },
        );
      }
    }
  }
};

export const appendEventBatch = async (
  prisma: PrismaClient,
  input: {
    readonly documentId: string;
    readonly createdBy: string;
    readonly payload: unknown;
  },
): Promise<AppendBatchResult> => {
  let batch: RichTextEventBatch;
  try {
    batch = parseRichTextEventBatch(input.payload);
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Invalid RichTextEventBatch";
    throw new CollabProtocolError(CollabErrorCode.InvalidBatch, message);
  }

  const payloadHash = hashPayload(batch);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.documentEventBatch.findUnique({
      where: {
        document_id_batch_id: {
          document_id: input.documentId,
          batch_id: batch.batchId,
        },
      },
    });

    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw new CollabProtocolError(
          CollabErrorCode.BatchConflict,
          `Batch ${batch.batchId} already exists with a different payload`,
          { batchId: batch.batchId },
        );
      }
      return {
        kind: "idempotent" as const,
        cursor: existing.id.toString(),
        batch,
      };
    }

    const eventIds = batch.events.map((event) => event.id);
    const conflicts = await tx.documentEventId.findMany({
      where: {
        document_id: input.documentId,
        event_id: { in: eventIds },
      },
      select: { event_id: true, batch_id: true },
    });
    if (conflicts.length > 0) {
      const conflict = conflicts[0]!;
      throw new CollabProtocolError(
        CollabErrorCode.EventIdConflict,
        `Event ID ${conflict.event_id} already used by batch ${conflict.batch_id}`,
        {
          eventId: conflict.event_id,
          existingBatchId: conflict.batch_id,
          batchId: batch.batchId,
        },
      );
    }

    if (batch.batchId === BOOTSTRAP_BATCH_ID) {
      // Optional: persist bootstrap for repair completeness; parents are empty.
    } else {
      const known = await collectKnownEventIds(tx, input.documentId);
      if (batch.parentVersion.length === 0) {
        throw new CollabProtocolError(
          CollabErrorCode.UnknownParent,
          "Non-bootstrap batches require parent events",
          { batchId: batch.batchId },
        );
      }
      assertParentsKnown(batch, known);
    }

    try {
      const inserted = await tx.documentEventBatch.create({
        data: {
          document_id: input.documentId,
          batch_id: batch.batchId,
          schema_version: batch.schemaVersion,
          parent_version: [...batch.parentVersion],
          payload: batch as unknown as Prisma.InputJsonValue,
          payload_hash: payloadHash,
          created_by: input.createdBy,
          events: {
            create: eventIds.map((eventId) => ({
              event_id: eventId,
              document: { connect: { id: input.documentId } },
            })),
          },
        },
      });

      return {
        kind: "inserted" as const,
        cursor: inserted.id.toString(),
        batch,
      };
    } catch (cause) {
      // Concurrent insert race → re-check idempotency.
      const raced = await tx.documentEventBatch.findUnique({
        where: {
          document_id_batch_id: {
            document_id: input.documentId,
            batch_id: batch.batchId,
          },
        },
      });
      if (raced && raced.payload_hash === payloadHash) {
        return {
          kind: "idempotent" as const,
          cursor: raced.id.toString(),
          batch,
        };
      }
      if (raced) {
        throw new CollabProtocolError(
          CollabErrorCode.BatchConflict,
          `Batch ${batch.batchId} already exists with a different payload`,
          { batchId: batch.batchId },
        );
      }
      throw cause;
    }
  });
};

export const listEventBatchesAfter = async (
  prisma: PrismaClient,
  documentId: string,
  afterCursor: string | null,
  limit: number,
): Promise<StoredBatchPage> => {
  const afterId =
    afterCursor === null || afterCursor === undefined || afterCursor === ""
      ? 0n
      : BigInt(afterCursor);

  const rows = await prisma.documentEventBatch.findMany({
    where: {
      document_id: documentId,
      id: { gt: afterId },
    },
    orderBy: { id: "asc" },
    take: limit + 1,
  });

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const batches = page.map((row) => ({
    cursor: row.id.toString(),
    batch: asWireBatch(parseRichTextEventBatch(row.payload)),
  }));
  const nextCursor =
    hasMore && page.length > 0
      ? page[page.length - 1]!.id.toString()
      : page.length > 0
        ? page[page.length - 1]!.id.toString()
        : afterCursor;

  return {
    batches,
    nextCursor: hasMore ? nextCursor : null,
    hasMore,
  };
};
