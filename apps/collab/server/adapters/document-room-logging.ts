import { EventConflictError } from "../utils/event-store";

const LOG_ID_SAMPLE_LIMIT = 8;

const boundedIdSample = (
  ids: ReadonlyArray<string> | undefined,
):
  | {
      readonly count: number;
      readonly sample: ReadonlyArray<string>;
    }
  | undefined => {
  if (ids === undefined) return undefined;
  return {
    count: ids.length,
    sample: ids.slice(0, LOG_ID_SAMPLE_LIMIT),
  };
};

export const logDocumentRoomError = (
  error: unknown,
  documentId: string | null,
  messageType: string,
): void => {
  console.error("Collaboration request failed", {
    documentId,
    messageType,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...(error instanceof EventConflictError
      ? {
          conflictType: error.details.conflictType,
          batchIds: boundedIdSample(error.details.batchIds),
          eventIds: boundedIdSample(error.details.eventIds),
          missingParentIds: boundedIdSample(error.details.missingParentIds),
        }
      : {}),
  });
};
