import { createHash } from "node:crypto";
import {
  BOOTSTRAP_EVENT_ID,
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import { Prisma } from "@softmaple/db";
import { EVENT_CONFLICT_TYPE, EventConflictError } from "./event-conflict";
import { prisma } from "./prisma";

export {
  EVENT_CONFLICT_TYPE,
  EventConflictError,
  type EventConflictDetails,
  type EventConflictType,
} from "./event-conflict";

const REPAIR_PAGE_SIZE = 100;
const CONFLICT_VERIFY_ATTEMPTS = 3;
const CONFLICT_VERIFY_DELAY_MS = 20;
/** Wait to start an interactive transaction when the pool is busy. */
const APPEND_TRANSACTION_MAX_WAIT_MS = 10_000;
/**
 * Bound for the whole append transaction, including time spent waiting on the
 * per-document advisory lock under concurrent writers.
 */
const APPEND_TRANSACTION_TIMEOUT_MS = 30_000;

export class EventAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventAuthorizationError";
  }
}

const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("event batch contains a non-JSON value");
};

const hashBatch = (batch: RichTextEventBatch): string =>
  createHash("sha256").update(canonicalJson(batch)).digest("hex");

const toPrismaJson = (batch: RichTextEventBatch): Prisma.InputJsonValue =>
  batch as unknown as Prisma.InputJsonValue;

type BatchLookupClient = Pick<Prisma.TransactionClient, "documentEventBatch">;

const existingBatchHashes = async (
  client: BatchLookupClient,
  documentId: string,
  batches: ReadonlyArray<RichTextEventBatch>,
): Promise<ReadonlyMap<string, string>> => {
  const existing = await client.documentEventBatch.findMany({
    where: {
      document_id: documentId,
      batch_id: { in: batches.map((batch) => batch.batchId) },
    },
    select: { batch_id: true, payload_hash: true },
  });
  return new Map(
    existing.map((row) => [row.batch_id, row.payload_hash] as const),
  );
};

const verifyExistingBatches = async (
  documentId: string,
  batches: ReadonlyArray<RichTextEventBatch>,
): Promise<boolean> => {
  const hashes = await existingBatchHashes(prisma, documentId, batches);
  return batches.every(
    (batch) => hashes.get(batch.batchId) === hashBatch(batch),
  );
};

const verifyExistingBatchesWithRetry = async (
  documentId: string,
  batches: ReadonlyArray<RichTextEventBatch>,
): Promise<boolean> => {
  for (let attempt = 0; attempt < CONFLICT_VERIFY_ATTEMPTS; attempt += 1) {
    if (await verifyExistingBatches(documentId, batches)) return true;
    if (attempt + 1 < CONFLICT_VERIFY_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, CONFLICT_VERIFY_DELAY_MS * (attempt + 1)),
      );
    }
  }
  return false;
};

/**
 * Serialize durable appends for one document across serverless instances.
 * Transaction-scoped so the lock is released on commit/rollback.
 */
const lockDocumentEventLog = async (
  transaction: Prisma.TransactionClient,
  documentId: string,
): Promise<void> => {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${documentId}::text, 0))`,
  );
};

export const appendEventBatches = async (
  documentId: string,
  actorId: string,
  batches: ReadonlyArray<RichTextEventBatch>,
): Promise<ReadonlyArray<string>> => {
  const incomingEventIds = batches.flatMap((batch) =>
    batch.events.map((event) => event.id),
  );
  if (new Set(incomingEventIds).size !== incomingEventIds.length) {
    throw new EventConflictError("duplicate event IDs in incoming batches", {
      conflictType: EVENT_CONFLICT_TYPE.DuplicateIncomingEventId,
      documentId,
      batchIds: batches.map((batch) => batch.batchId),
      eventIds: incomingEventIds,
    });
  }

  try {
    await prisma.$transaction(
      async (transaction) => {
        await lockDocumentEventLog(transaction, documentId);

        const writeAccess = await transaction.$queryRaw<
          ReadonlyArray<{ readonly role: string }>
        >(Prisma.sql`
        SELECT member.role::text AS role
        FROM public.workspace_members AS member
        INNER JOIN public.documents AS document
          ON document.workspace_id = member.workspace_id
        WHERE document.id = ${documentId}::uuid
          AND member.user_id = ${actorId}::uuid
        FOR SHARE OF member
      `);
        if (
          writeAccess.length !== 1 ||
          (writeAccess[0]?.role !== "OWNER" &&
            writeAccess[0]?.role !== "EDITOR")
        ) {
          throw new EventAuthorizationError(
            "actor no longer has document write access",
          );
        }

        const incomingEventIdSet = new Set(incomingEventIds);
        const requiredParentIds = new Set(
          batches
            .flatMap((batch) => [
              ...batch.parentVersion,
              ...batch.events.flatMap((event) => event.parentVersion),
            ])
            .filter(
              (eventId) =>
                eventId !== BOOTSTRAP_EVENT_ID &&
                !incomingEventIdSet.has(eventId),
            ),
        );
        if (requiredParentIds.size > 0) {
          const storedParents = await transaction.documentEventId.findMany({
            where: {
              document_id: documentId,
              event_id: { in: [...requiredParentIds] },
            },
            select: { event_id: true },
          });
          if (storedParents.length !== requiredParentIds.size) {
            const stored = new Set(storedParents.map((row) => row.event_id));
            const missingParentIds = [...requiredParentIds]
              .filter((eventId) => !stored.has(eventId))
              .sort();
            throw new EventConflictError(
              "event batch references document history that has not been stored",
              {
                conflictType: EVENT_CONFLICT_TYPE.MissingParentHistory,
                documentId,
                batchIds: batches.map((batch) => batch.batchId),
                missingParentIds,
              },
            );
          }
        }

        const existingHashes = await existingBatchHashes(
          transaction,
          documentId,
          batches,
        );
        for (const batch of batches) {
          const payloadHash = hashBatch(batch);
          const existingHash = existingHashes.get(batch.batchId);
          if (existingHash !== undefined) {
            if (existingHash !== payloadHash) {
              throw new EventConflictError(
                `conflicting payload for batch ${batch.batchId}`,
                {
                  conflictType: EVENT_CONFLICT_TYPE.BatchPayloadConflict,
                  documentId,
                  batchIds: [batch.batchId],
                },
              );
            }
            continue;
          }

          const created = await transaction.documentEventBatch.create({
            data: {
              document_id: documentId,
              batch_id: batch.batchId,
              schema_version: batch.schemaVersion,
              parent_version: [...batch.parentVersion],
              payload: toPrismaJson(batch),
              payload_hash: payloadHash,
              actor_id: actorId,
            },
            select: { id: true },
          });
          await transaction.documentEventId.createMany({
            data: batch.events.map((event) => ({
              document_id: documentId,
              event_id: event.id,
              batch_row_id: created.id,
            })),
          });
        }
      },
      {
        maxWait: APPEND_TRANSACTION_MAX_WAIT_MS,
        timeout: APPEND_TRANSACTION_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (
      error instanceof EventConflictError ||
      error instanceof EventAuthorizationError
    ) {
      throw error;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      if (await verifyExistingBatchesWithRetry(documentId, batches)) {
        return batches.map((batch) => batch.batchId);
      }
      throw new EventConflictError(
        "event IDs conflict with stored document history",
        {
          conflictType: EVENT_CONFLICT_TYPE.StoredEventIdConflict,
          documentId,
          batchIds: batches.map((batch) => batch.batchId),
          eventIds: incomingEventIds,
        },
      );
    }
    throw error;
  }

  return batches.map((batch) => batch.batchId);
};

export interface EventPage {
  readonly batches: ReadonlyArray<RichTextEventBatch>;
  readonly nextCursor: string;
  readonly complete: boolean;
}

export const readEventPage = async (
  documentId: string,
  afterCursor: string,
): Promise<EventPage> => {
  const rows = await prisma.documentEventBatch.findMany({
    where: {
      document_id: documentId,
      id: { gt: BigInt(afterCursor) },
    },
    orderBy: { id: "asc" },
    take: REPAIR_PAGE_SIZE + 1,
    select: { id: true, payload: true },
  });
  const pageRows = rows.slice(0, REPAIR_PAGE_SIZE);
  const lastRow = pageRows.at(-1);

  return {
    batches: pageRows.map((row) => parseRichTextEventBatch(row.payload)),
    nextCursor: lastRow?.id.toString() ?? afterCursor,
    complete: rows.length <= REPAIR_PAGE_SIZE,
  };
};
