export const CollabErrorCode = {
  Unauthorized: "UNAUTHORIZED",
  Forbidden: "FORBIDDEN",
  InvalidMessage: "INVALID_MESSAGE",
  InvalidBatch: "INVALID_BATCH",
  BatchConflict: "BATCH_CONFLICT",
  EventIdConflict: "EVENT_ID_CONFLICT",
  UnknownParent: "UNKNOWN_PARENT",
  ReadOnly: "READ_ONLY",
  NotAuthenticated: "NOT_AUTHENTICATED",
  PersistenceFailed: "PERSISTENCE_FAILED",
  Internal: "INTERNAL",
} as const;

export type CollabErrorCode =
  (typeof CollabErrorCode)[keyof typeof CollabErrorCode];

export class CollabProtocolError extends Error {
  readonly code: CollabErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: CollabErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CollabProtocolError";
    this.code = code;
    this.details = details;
  }
}
