import { createHash } from "node:crypto";
import {
  BOOTSTRAP_EVENT_ID,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import {
  DOCUMENT_EVENT_CONFLICT_TYPE,
  DOCUMENT_EVENT_PAGE_LIMIT,
  DocumentEventConflictError,
  type DocumentEventBatches,
  type DocumentEventCursor,
  type DocumentEventPage,
  type DocumentEventStore,
} from "@softmaple/collab-runtime";

type StoredBatch = {
  readonly id: bigint;
  readonly batchId: string;
  readonly payloadHash: string;
  readonly payload: RichTextEventBatch;
};

/**
 * Infrastructure-independent durable event log for collaboration consistency
 * tests. Mirrors production append/repair conflict semantics without Prisma.
 */
export type InMemoryEventStore = DocumentEventStore & {
  /** Compatibility aliases retained for the existing Phase 1 tests. */
  readonly appendEventBatches: (
    documentId: string,
    actorId: string,
    batches: DocumentEventBatches,
  ) => Promise<ReadonlyArray<string>>;
  readonly readEventPage: (
    documentId: string,
    afterCursor: DocumentEventCursor,
  ) => Promise<DocumentEventPage>;
  readonly listBatchIds: (documentId: string) => ReadonlyArray<string>;
  readonly listBatches: (
    documentId: string,
  ) => ReadonlyArray<RichTextEventBatch>;
  readonly hasBatch: (documentId: string, batchId: string) => boolean;
  readonly setPageSize: (pageSize: number) => void;
  readonly pageSize: () => number;
};

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
      .flatMap((key) => {
        const entry = record[key];
        // Match JSON.stringify: omit undefined-valued properties.
        if (entry === undefined) return [];
        return [`${JSON.stringify(key)}:${canonicalJson(entry)}`];
      })
      .join(",")}}`;
  }
  throw new Error("event batch contains a non-JSON value");
};

const hashBatch = (batch: RichTextEventBatch): string =>
  createHash("sha256").update(canonicalJson(batch)).digest("hex");

type DocumentLog = {
  readonly batchesById: Map<string, StoredBatch>;
  readonly ordered: StoredBatch[];
  readonly eventIds: Set<string>;
  lockHolders: number;
  readonly lockWaiters: Array<() => void>;
};

const createDocumentLog = (): DocumentLog => ({
  batchesById: new Map(),
  ordered: [],
  eventIds: new Set(),
  lockHolders: 0,
  lockWaiters: [],
});

const acquireLock = async (log: DocumentLog): Promise<void> => {
  if (log.lockHolders === 0) {
    log.lockHolders = 1;
    return;
  }
  await new Promise<void>((resolve) => {
    log.lockWaiters.push(resolve);
  });
};

const releaseLock = (log: DocumentLog): void => {
  const next = log.lockWaiters.shift();
  if (next) {
    next();
    return;
  }
  log.lockHolders = 0;
};

export const createInMemoryEventStore = (options?: {
  readonly pageSize?: number;
}): InMemoryEventStore => {
  const documents = new Map<string, DocumentLog>();
  let pageSize = Math.min(
    DOCUMENT_EVENT_PAGE_LIMIT,
    Math.max(1, options?.pageSize ?? DOCUMENT_EVENT_PAGE_LIMIT),
  );

  const getLog = (documentId: string): DocumentLog => {
    const existing = documents.get(documentId);
    if (existing) return existing;
    const created = createDocumentLog();
    documents.set(documentId, created);
    return created;
  };

  const append = async (
    documentId: string,
    _actorId: string,
    batches: DocumentEventBatches,
  ): Promise<ReadonlyArray<string>> => {
    const incomingEventIds = batches.flatMap((batch) =>
      batch.events.map((event) => event.id),
    );
    if (new Set(incomingEventIds).size !== incomingEventIds.length) {
      throw new DocumentEventConflictError(
        "duplicate event IDs in incoming batches",
        {
          conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.DuplicateIncomingEventId,
          documentId,
          batchIds: batches.map((batch) => batch.batchId),
          eventIds: incomingEventIds,
        },
      );
    }

    const log = getLog(documentId);
    await acquireLock(log);
    try {
      // Stage first so a mid-request conflict cannot partially mutate the log.
      const stagedRows: StoredBatch[] = [];
      const stagedEventIds = new Set<string>();
      const availableEventIds = new Set<string>();

      for (const batch of batches) {
        const requiredParentIds = new Set<string>();
        const knownAtBatchStart = new Set(availableEventIds);
        const seenInBatch = new Set<string>();
        for (const parentId of batch.parentVersion) {
          if (
            parentId !== BOOTSTRAP_EVENT_ID &&
            !knownAtBatchStart.has(parentId)
          ) {
            requiredParentIds.add(parentId);
          }
        }
        for (const event of batch.events) {
          for (const parentId of event.parentVersion) {
            if (
              parentId !== BOOTSTRAP_EVENT_ID &&
              !knownAtBatchStart.has(parentId) &&
              !seenInBatch.has(parentId)
            ) {
              requiredParentIds.add(parentId);
            }
          }
          seenInBatch.add(event.id);
        }

        for (const parentId of requiredParentIds) {
          if (
            !log.eventIds.has(parentId) &&
            !stagedEventIds.has(parentId) &&
            !availableEventIds.has(parentId)
          ) {
            const missingParentIds = [...requiredParentIds]
              .filter(
                (eventId) =>
                  !log.eventIds.has(eventId) &&
                  !stagedEventIds.has(eventId) &&
                  !availableEventIds.has(eventId),
              )
              .sort();
            throw new DocumentEventConflictError(
              "event batch references document history that has not been stored",
              {
                conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.MissingParentHistory,
                documentId,
                batchIds: [batch.batchId],
                missingParentIds,
              },
            );
          }
          availableEventIds.add(parentId);
        }

        const payloadHash = hashBatch(batch);
        const existing =
          log.batchesById.get(batch.batchId) ??
          stagedRows.find((row) => row.batchId === batch.batchId);
        if (existing !== undefined) {
          if (existing.payloadHash !== payloadHash) {
            throw new DocumentEventConflictError(
              `conflicting payload for batch ${batch.batchId}`,
              {
                conflictType: DOCUMENT_EVENT_CONFLICT_TYPE.BatchPayloadConflict,
                documentId,
                batchIds: [batch.batchId],
              },
            );
          }
          for (const event of batch.events) {
            availableEventIds.add(event.id);
          }
          continue;
        }

        for (const event of batch.events) {
          if (log.eventIds.has(event.id) || stagedEventIds.has(event.id)) {
            throw new DocumentEventConflictError(
              "event IDs conflict with stored document history",
              {
                conflictType:
                  DOCUMENT_EVENT_CONFLICT_TYPE.StoredEventIdConflict,
                documentId,
                batchIds: batches.map((entry) => entry.batchId),
                eventIds: incomingEventIds,
              },
            );
          }
        }

        const row: StoredBatch = {
          id: BigInt(log.ordered.length + stagedRows.length + 1),
          batchId: batch.batchId,
          payloadHash,
          payload: batch,
        };
        stagedRows.push(row);
        for (const event of batch.events) {
          stagedEventIds.add(event.id);
          availableEventIds.add(event.id);
        }
      }

      for (const row of stagedRows) {
        log.batchesById.set(row.batchId, row);
        log.ordered.push(row);
        for (const event of row.payload.events) {
          log.eventIds.add(event.id);
        }
      }
    } finally {
      releaseLock(log);
    }

    return batches.map((batch) => batch.batchId);
  };

  const read = async (
    documentId: string,
    afterCursor: DocumentEventCursor,
  ): Promise<DocumentEventPage> => {
    const log = getLog(documentId);
    const after = BigInt(afterCursor);
    const rows = log.ordered.filter((row) => row.id > after);
    const pageRows = rows.slice(0, pageSize);
    const lastRow = pageRows.at(-1);
    return {
      batches: pageRows.map((row) => row.payload),
      nextCursor: lastRow?.id.toString() ?? afterCursor,
      complete: rows.length <= pageSize,
    };
  };

  return {
    append,
    read,
    appendEventBatches: append,
    readEventPage: read,
    listBatchIds: (documentId) =>
      getLog(documentId).ordered.map((row) => row.batchId),
    listBatches: (documentId) =>
      getLog(documentId).ordered.map((row) => row.payload),
    hasBatch: (documentId, batchId) =>
      getLog(documentId).batchesById.has(batchId),
    setPageSize: (next) => {
      pageSize = Math.min(DOCUMENT_EVENT_PAGE_LIMIT, Math.max(1, next));
    },
    pageSize: () => pageSize,
  };
};
