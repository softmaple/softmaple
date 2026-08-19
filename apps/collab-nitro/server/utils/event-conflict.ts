export const EVENT_CONFLICT_TYPE = {
  DuplicateIncomingEventId: "duplicate-incoming-event-id",
  MissingParentHistory: "missing-parent-history",
  BatchPayloadConflict: "batch-payload-conflict",
  StoredEventIdConflict: "stored-event-id-conflict",
} as const;

export type EventConflictType =
  (typeof EVENT_CONFLICT_TYPE)[keyof typeof EVENT_CONFLICT_TYPE];

export interface EventConflictDetails {
  readonly conflictType: EventConflictType;
  readonly documentId?: string;
  readonly batchIds?: ReadonlyArray<string>;
  readonly eventIds?: ReadonlyArray<string>;
  readonly missingParentIds?: ReadonlyArray<string>;
}

export class EventConflictError extends Error {
  readonly details: EventConflictDetails;

  constructor(message: string, details: EventConflictDetails) {
    super(message);
    this.name = "EventConflictError";
    this.details = details;
  }
}
