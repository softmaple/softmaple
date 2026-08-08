import {
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_EVENT_ID,
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import {
  CollabErrorCode,
  CollabProtocolError,
  DEFAULT_REPAIR_PAGE_SIZE,
  MAX_REPAIR_PAGE_SIZE,
  type WireBatch,
} from "@softmaple/collab-protocol";
import type { Prisma, PrismaClient } from "@softmaple/db";
import { hashPayload } from "../utils/hash";

export { hashPayload };

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

const asWireBatch = (batch: RichTextEventBatch): WireBatch => batch;

const isPrismaUniqueViolation = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) return false;
  return Reflect.get(cause, "code") === "P2002";
};

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

  const previousIds = new Set<string>();
  for (const event of batch.events) {
    for (const parentId of event.parentVersion) {
      if (!knownEventIds.has(parentId) && !previousIds.has(parentId)) {
        throw new CollabProtocolError(
          CollabErrorCode.UnknownParent,
          `Unknown parent event ${parentId}`,
          { parentId, batchId: batch.batchId },
        );
      }
    }
    previousIds.add(event.id);
  }
};

const resolveRaceResult = async (
  prisma: PrismaClient,
  documentId: string,
  batch: RichTextEventBatch,
  payloadHash: string,
): Promise<AppendBatchResult> => {
  const raced = await prisma.documentEventBatch.findUnique({
    where: {
      document_id_batch_id: {
        document_id: documentId,
        batch_id: batch.batchId,
      },
    },
  });
  if (raced && raced.payload_hash === payloadHash) {
    return {
      kind: "idempotent",
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
  throw new CollabProtocolError(
    CollabErrorCode.PersistenceFailed,
    `Unique constraint race for batch ${batch.batchId} but row was not found`,
    { batchId: batch.batchId },
  );
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

  // hashPayload requires normalized parser output (see utils/hash.ts).
  const payloadHash = hashPayload(batch);

  try {
    return await prisma.$transaction(async (tx) => {
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

      // Bootstrap may be persisted optionally; non-bootstrap requires parents.
      if (batch.batchId !== BOOTSTRAP_BATCH_ID) {
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
    });
  } catch (cause) {
    if (cause instanceof CollabProtocolError) throw cause;
    if (!isPrismaUniqueViolation(cause)) throw cause;
    // Recovery runs after the failed transaction has rolled back.
    return resolveRaceResult(prisma, input.documentId, batch, payloadHash);
  }
};

const parseAfterCursor = (afterCursor: string | null): bigint => {
  if (afterCursor === null || afterCursor === undefined || afterCursor === "") {
    return 0n;
  }
  if (!/^\d+$/.test(afterCursor)) {
    throw new CollabProtocolError(
      CollabErrorCode.InvalidMessage,
      "afterCursor must be a non-negative integer string",
      { afterCursor },
    );
  }
  return BigInt(afterCursor);
};

export const listEventBatchesAfter = async (
  prisma: PrismaClient,
  documentId: string,
  afterCursor: string | null,
  limit: number,
): Promise<StoredBatchPage> => {
  const afterId = parseAfterCursor(afterCursor);
  const pageSize = Math.min(
    Math.max(
      1,
      Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_REPAIR_PAGE_SIZE,
    ),
    MAX_REPAIR_PAGE_SIZE,
  );

  const rows = await prisma.documentEventBatch.findMany({
    where: {
      document_id: documentId,
      id: { gt: afterId },
    },
    orderBy: { id: "asc" },
    take: pageSize + 1,
  });

  const page = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  const batches = page.map((row) => ({
    cursor: row.id.toString(),
    batch: asWireBatch(parseRichTextEventBatch(row.payload)),
  }));

  return {
    batches,
    nextCursor: hasMore ? page[page.length - 1]!.id.toString() : null,
    hasMore,
  };
};
