import {
  DOCUMENT_EVENT_CONFLICT_TYPE,
  DocumentEventAuthorizationError,
  DocumentEventConflictError,
  type DocumentEventConflictType,
  type DocumentEventStore,
  DocumentEventStoreUnavailableError,
} from "@softmaple/collab-runtime";
import {
  appendEventBatches,
  EventAuthorizationError,
  EventConflictError,
  readEventPage,
} from "../utils/event-store";
import {
  EVENT_CONFLICT_TYPE,
  type EventConflictType,
} from "../utils/event-conflict";

export const runtimeConflictType = (
  conflictType: EventConflictType,
): DocumentEventConflictType => {
  switch (conflictType) {
    case EVENT_CONFLICT_TYPE.BatchPayloadConflict:
      return DOCUMENT_EVENT_CONFLICT_TYPE.BatchPayloadConflict;
    case EVENT_CONFLICT_TYPE.DuplicateIncomingEventId:
      return DOCUMENT_EVENT_CONFLICT_TYPE.DuplicateIncomingEventId;
    case EVENT_CONFLICT_TYPE.MissingParentHistory:
      return DOCUMENT_EVENT_CONFLICT_TYPE.MissingParentHistory;
    case EVENT_CONFLICT_TYPE.StoredEventIdConflict:
      return DOCUMENT_EVENT_CONFLICT_TYPE.StoredEventIdConflict;
  }
};

const unavailableStoreError = (
  operation: "append" | "read",
  error: unknown,
): DocumentEventStoreUnavailableError =>
  new DocumentEventStoreUnavailableError(
    `Document event ${operation} is unavailable`,
    { cause: error },
  );

const appendError = (
  documentId: string,
  error: unknown,
):
  | DocumentEventAuthorizationError
  | DocumentEventConflictError
  | DocumentEventStoreUnavailableError => {
  if (error instanceof EventAuthorizationError) {
    return new DocumentEventAuthorizationError(error.message);
  }
  if (error instanceof EventConflictError) {
    return new DocumentEventConflictError(error.message, {
      conflictType: runtimeConflictType(error.details.conflictType),
      documentId: error.details.documentId ?? documentId,
      ...(error.details.batchIds === undefined
        ? {}
        : { batchIds: error.details.batchIds }),
      ...(error.details.eventIds === undefined
        ? {}
        : { eventIds: error.details.eventIds }),
      ...(error.details.missingParentIds === undefined
        ? {}
        : { missingParentIds: error.details.missingParentIds }),
    });
  }
  return unavailableStoreError("append", error);
};

/** Prisma/Postgres event log presented through the runtime event-store port. */
export const prismaDocumentEventStore: DocumentEventStore = {
  async append(documentId, actorId, batches) {
    try {
      return await appendEventBatches(documentId, actorId, batches);
    } catch (error) {
      throw appendError(documentId, error);
    }
  },

  async read(documentId, afterCursor) {
    try {
      return await readEventPage(documentId, afterCursor);
    } catch (error) {
      throw unavailableStoreError("read", error);
    }
  },
};
