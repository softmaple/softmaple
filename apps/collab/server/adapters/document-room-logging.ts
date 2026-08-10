const LOG_ID_SAMPLE_LIMIT = 8;

interface ConflictDetails {
  readonly batchIds?: ReadonlyArray<string>;
  readonly conflictType: string;
  readonly eventIds?: ReadonlyArray<string>;
  readonly missingParentIds?: ReadonlyArray<string>;
}

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const conflictDetailsFromError = (error: unknown): ConflictDetails | null => {
  if (!(error instanceof Error) || !("details" in error)) return null;
  const details = error.details;
  if (
    typeof details !== "object" ||
    details === null ||
    !("conflictType" in details) ||
    typeof details.conflictType !== "string"
  ) {
    return null;
  }
  return {
    conflictType: details.conflictType,
    ...("batchIds" in details && isStringArray(details.batchIds)
      ? { batchIds: details.batchIds }
      : {}),
    ...("eventIds" in details && isStringArray(details.eventIds)
      ? { eventIds: details.eventIds }
      : {}),
    ...("missingParentIds" in details && isStringArray(details.missingParentIds)
      ? { missingParentIds: details.missingParentIds }
      : {}),
  };
};

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
  const conflict = conflictDetailsFromError(error);
  console.error("Collaboration request failed", {
    documentId,
    messageType,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...(conflict !== null
      ? {
          conflictType: conflict.conflictType,
          batchIds: boundedIdSample(conflict.batchIds),
          eventIds: boundedIdSample(conflict.eventIds),
          missingParentIds: boundedIdSample(conflict.missingParentIds),
        }
      : {}),
  });
};
