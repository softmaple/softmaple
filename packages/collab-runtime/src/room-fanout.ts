import type { DocumentEventBatches } from "./event-store";

/** A notification that may only be created after the batches are durable. */
export interface CommittedDocumentEvent {
  readonly batches: DocumentEventBatches;
  readonly documentId: string;
}

export type RoomFanoutHandler = (
  event: CommittedDocumentEvent,
) => void | Promise<void>;

export interface RoomFanoutSubscription {
  /** Releases this subscription; repeated calls must be safe. */
  unsubscribe(): Promise<void>;
}

/**
 * Cross-room-instance committed-event delivery. Presence and connection
 * leases are intentionally outside this channel. Publish must make the event
 * observable to matching same-instance and remote subscriptions, including
 * the publisher's own room. A subscriber must discard an event whose
 * documentId does not match its subscription.
 */
export interface RoomFanout {
  publish(event: CommittedDocumentEvent): Promise<void>;
  subscribe(
    documentId: string,
    handler: RoomFanoutHandler,
  ): Promise<RoomFanoutSubscription>;
}
