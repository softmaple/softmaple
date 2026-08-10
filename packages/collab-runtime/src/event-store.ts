import type {
  ClientEventMessage,
  RepairRequestMessage,
  RepairResponseMessage,
} from "@softmaple/collab-protocol";

/** Reuses the protocol's validated block-model batch shape. */
export type DocumentEventBatches = ClientEventMessage["batches"];

/** A non-negative decimal string; the initial durable-history cursor is `0`. */
export type DocumentEventCursor = RepairRequestMessage["afterCursor"];

export const INITIAL_DOCUMENT_EVENT_CURSOR: DocumentEventCursor = "0";
export const DOCUMENT_EVENT_PAGE_LIMIT = 100 as const;

/**
 * Durable history page before request identifiers and protocol metadata are
 * added to a wire-level RepairResponse message. Reads are exclusive of the
 * input cursor and ordered monotonically, with no more than
 * DOCUMENT_EVENT_PAGE_LIMIT batches. An empty page preserves the input
 * cursor; every non-empty page advances it to that page's final durable row.
 * `complete` means no later durable row was observed by that page read.
 */
export type DocumentEventPage = Pick<
  RepairResponseMessage,
  "batches" | "complete" | "nextCursor"
>;

export const DOCUMENT_EVENT_CONFLICT_TYPE = {
  BatchPayloadConflict: "batch-payload-conflict",
  DuplicateIncomingEventId: "duplicate-incoming-event-id",
  MissingParentHistory: "missing-parent-history",
  StoredEventIdConflict: "stored-event-id-conflict",
} as const;

export type DocumentEventConflictType =
  (typeof DOCUMENT_EVENT_CONFLICT_TYPE)[keyof typeof DOCUMENT_EVENT_CONFLICT_TYPE];

export interface DocumentEventConflictDetails {
  readonly batchIds?: ReadonlyArray<string>;
  readonly conflictType: DocumentEventConflictType;
  readonly documentId: string;
  readonly eventIds?: ReadonlyArray<string>;
  readonly missingParentIds?: ReadonlyArray<string>;
}

export const DOCUMENT_EVENT_STORE_ERROR_KIND = {
  Authorization: "authorization",
  Conflict: "conflict",
  Unavailable: "unavailable",
} as const;

export class DocumentEventAuthorizationError extends Error {
  readonly kind = DOCUMENT_EVENT_STORE_ERROR_KIND.Authorization;
  readonly retryable = false;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentEventAuthorizationError";
  }
}

export class DocumentEventConflictError extends Error {
  readonly details: DocumentEventConflictDetails;
  readonly kind = DOCUMENT_EVENT_STORE_ERROR_KIND.Conflict;
  readonly retryable = false;

  constructor(
    message: string,
    details: DocumentEventConflictDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentEventConflictError";
    this.details = details;
  }
}

export class DocumentEventStoreUnavailableError extends Error {
  readonly kind = DOCUMENT_EVENT_STORE_ERROR_KIND.Unavailable;
  readonly retryable = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentEventStoreUnavailableError";
  }
}

export type DocumentEventStoreError =
  | DocumentEventAuthorizationError
  | DocumentEventConflictError
  | DocumentEventStoreUnavailableError;

/**
 * Durable event-log capability used by a DocumentRoom implementation.
 *
 * Each append is atomic, same-document appends serialize across room/runtime
 * instances, and exact batch resends are idempotent. The returned ids must
 * correspond to every input batch in input order, and append must not resolve
 * until all of them are durable. The store must recheck actor write access
 * inside that serialized durable boundary.
 *
 * Append rejects only with DocumentEventAuthorizationError,
 * DocumentEventConflictError, or DocumentEventStoreUnavailableError. Read
 * rejects with DocumentEventStoreUnavailableError.
 */
export interface DocumentEventStore {
  append(
    documentId: string,
    actorId: string,
    batches: DocumentEventBatches,
  ): Promise<ReadonlyArray<string>>;
  read(
    documentId: string,
    afterCursor: DocumentEventCursor,
  ): Promise<DocumentEventPage>;
}
