import type { PositionOperation } from "./position-operation";

/**
 * Discriminated status returned by
 * {@link EgWalkerReplica.applyRemoteEvent}.
 *
 * - `"integrated"` — the event was added to the event graph and the
 *   document state advanced. When the engine took the incremental
 *   apply path and produced exactly one transformed operation, that
 *   operation is reported in {@link IntegratedApplyRemoteEventResult.operation}.
 *   Otherwise (partial/full replay, multi-op coalesced delete,
 *   no-op insert/delete) the operation is `null` — see
 *   {@link IntegratedApplyRemoteEventResult.operation} for details.
 * - `"buffered"` — at least one parent of the event has not been seen
 *   yet, so the event is held in the replica's buffer. The document
 *   text is unchanged. The event will be flushed automatically once
 *   every parent arrives via a later `applyRemoteEvent` call.
 * - `"duplicate"` — the event id is already in the graph or already
 *   buffered. The call is a no-op.
 */
export const APPLY_REMOTE_EVENT_STATUS = {
  Integrated: "integrated",
  Buffered: "buffered",
  Duplicate: "duplicate",
} as const;

export type ApplyRemoteEventStatus =
  (typeof APPLY_REMOTE_EVENT_STATUS)[keyof typeof APPLY_REMOTE_EVENT_STATUS];

export interface IntegratedApplyRemoteEventResult {
  readonly status: typeof APPLY_REMOTE_EVENT_STATUS.Integrated;
  /**
   * The visible position operation produced by integrating this event,
   * in the replica's UTF-16 code-unit index unit.
   *
   * `null` when the engine cannot attribute a single
   * {@link PositionOperation} to this event in isolation:
   *
   * - The event triggered a partial or full replay (concurrent
   *   integration retransforms multiple events, so the per-event
   *   effect is no longer expressible as one insert/delete on the
   *   pre-event document).
   * - The integrated insert or delete coalesced into multiple disjoint
   *   effect-index runs (rare; happens when concurrent inserts split
   *   the visible deletion span).
   * - The event was a no-op at the visible layer (empty insert,
   *   zero-length delete, or a delete fully covering already-deleted
   *   characters).
   * - Accepting the event also flushed one or more previously-buffered
   *   descendants. The call changed the document through multiple events, so
   *   no single position operation describes the full visible delta.
   *
   * Consumers driving selection mapping should treat `null` as
   * "remap from text diff" rather than skipping the remap entirely.
   */
  readonly operation: PositionOperation | null;
}

export interface BufferedApplyRemoteEventResult {
  readonly status: typeof APPLY_REMOTE_EVENT_STATUS.Buffered;
}

export interface DuplicateApplyRemoteEventResult {
  readonly status: typeof APPLY_REMOTE_EVENT_STATUS.Duplicate;
}

export type ApplyRemoteEventResult =
  | IntegratedApplyRemoteEventResult
  | BufferedApplyRemoteEventResult
  | DuplicateApplyRemoteEventResult;

/**
 * Result of atomically accepting a remote batch.
 *
 * `results` is aligned with the caller's input. `operations` follows actual
 * causal integration order and is `null` when replay or a multi-operation
 * effect prevents an exact position-operation sequence from being reported.
 */
export interface ApplyRemoteEventsResult {
  readonly results: ReadonlyArray<ApplyRemoteEventResult>;
  readonly operations: ReadonlyArray<PositionOperation> | null;
}
