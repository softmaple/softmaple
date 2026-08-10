import {
  DocumentEventAuthorizationError,
  DocumentEventConflictError,
  DocumentEventStoreUnavailableError,
  type DocumentEventStore,
} from "@softmaple/collab-runtime";
import {
  appendEventBatches,
  EventAuthorizationError,
  EventConflictError,
  readEventPage,
} from "../utils/event-store";
import { logDocumentRoomError } from "./document-room-logging";

export const prismaDocumentEventStore: DocumentEventStore = {
  async append(documentId, actorId, batches) {
    try {
      return await appendEventBatches(documentId, actorId, batches);
    } catch (error) {
      logDocumentRoomError(error, documentId, "event");
      if (error instanceof EventAuthorizationError) {
        throw new DocumentEventAuthorizationError(error.message, {
          cause: error,
        });
      }
      if (error instanceof EventConflictError) {
        throw new DocumentEventConflictError(
          error.message,
          {
            conflictType: error.details.conflictType,
            documentId,
            batchIds: error.details.batchIds,
            eventIds: error.details.eventIds,
            missingParentIds: error.details.missingParentIds,
          },
          { cause: error },
        );
      }
      throw new DocumentEventStoreUnavailableError(
        "Document event append is unavailable",
        { cause: error },
      );
    }
  },
  async read(documentId, afterCursor) {
    try {
      return await readEventPage(documentId, afterCursor);
    } catch (error) {
      logDocumentRoomError(error, documentId, "repair-request");
      throw new DocumentEventStoreUnavailableError(
        "Document event history is unavailable",
        { cause: error },
      );
    }
  },
};
