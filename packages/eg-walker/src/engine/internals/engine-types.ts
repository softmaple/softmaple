import type { EventGraph } from "../../graph/event-graph";
import type { EventId, ExternalOperation } from "../../types";

export const PLACEHOLDER_EVENT_ID = "__placeholder__";
export const PLACEHOLDER_ID_PREFIX = "__placeholder__:";

/**
 * Identity of an {@link AugmentedCRDTItem} that represents a coalesced run
 * of contiguous single-character INSERT events from one author. The record
 * spans `content.length` events whose IDs are
 * `${replicaId}:${startSequence + offsetInRecord}` for
 * `offsetInRecord ∈ [0, content.length)`.
 *
 * Records produced by multi-character paste events and the initial-text
 * placeholder do **not** carry a {@link TypedRun}; for those, the
 * `eventId` field alone identifies the owning event.
 */
export interface TypedRun {
  readonly replicaId: string;
  readonly startSequence: number;
}

/**
 * Augmented CRDT item used during replay.
 *
 * A record can take two coalesced shapes (or be a single-event item):
 *
 * - **Placeholder** (`eventId === PLACEHOLDER_EVENT_ID`, `run === null`):
 *   contiguous run of pre-checkpoint / initial-text content, split on
 *   demand by concurrent inserts and deletes. Splits assign fresh
 *   placeholder IDs to the right half.
 * - **Typed-run record** (`run !== null`): coalesced run of contiguous
 *   single-character INSERT events from one author (Section 3.4 "smaller"
 *   lever). Splits move whole-event slices to new records with IDs
 *   `${replicaId}:${startSequence + offsetInRecord}:0`.
 *
 * Multi-character INSERT events stay one record per code unit (each with
 * `run === null` and a real `eventId`); we do not coalesce them, since the
 * per-code-unit IDs already serve as anchors for concurrent siblings.
 *
 * `content` is mutable to support in-place run extension and splits
 * without invalidating the `WeakMap` location index in
 * `IndexedSequence`.
 */
export interface AugmentedCRDTItem {
  readonly id: EventId;
  readonly eventId: EventId;
  content: string;
  originLeft: EventId | null;
  readonly originRight: EventId | null;
  everDeleted: boolean;
  prepareState: number;
  run: TypedRun | null;
}

export interface EngineStats {
  readonly retreatCount: number;
  readonly advanceCount: number;
  readonly eventsProcessed: number;
  /**
   * Section 3.4 internal-document fast path: number of events whose
   * `parentVersion` already matched the engine's current version, so they
   * skipped the diff/retreat/advance machinery entirely and applied through
   * a direct integration position (no YATA scan when the destination range
   * is empty, no per-character scan for multi-character inserts after the
   * first).
   */
  readonly nonConflictingRunCount: number;
  /**
   * Counterpart to {@link nonConflictingRunCount}: events that fell through
   * to the full prepare/effect replay path because either their parent
   * version diverged from the current version or the destination range
   * still contained concurrent siblings.
   */
  readonly fullReplayCount: number;
  /**
   * Number of CRDT records currently held in the underlying ranked B-tree.
   *
   * The paper's "Smaller" lever (Section 3.4) is run-length leaves — a
   * single record covering many code units instead of one record per code
   * unit. Initial document text and pre-checkpoint placeholders are stored
   * as run-length records; concurrent inserts and deletes split records on
   * demand. Tracking the count lets tests prove the coalescing happened
   * and lets memory regressions surface as a quantitative jump rather than
   * a slowdown.
   */
  readonly sequenceRecordCount: number;
  /**
   * High-water mark of {@link sequenceRecordCount} across **this engine
   * instance's** lifetime. Sampled after each `apply` (and after the
   * initial-text placeholder is seeded in `reset`). Useful for benchmarks
   * because the steady-state `sequenceRecordCount` can hide transient
   * pressure during a heavy concurrent merge — the peak surfaces that
   * pressure even when later deletes/coalescing have shrunk the live
   * record set.
   *
   * Note: this peak resets on `reset`, so any caller that swaps engines
   * (e.g. {@link EgWalkerReplica} during partial/full replay) must fold
   * the outgoing engine's peak into its own monotonic counter before the
   * swap if it wants a lifetime-of-replica figure.
   */
  readonly peakSequenceRecordCount: number;
}

export interface GenerateOptions {
  readonly initialVersion?: ReadonlySet<EventId>;
  readonly eventGraph?: EventGraph;
}

export interface GeneratedDocument {
  readonly text: string;
  readonly transformedOperations: ReadonlyArray<ExternalOperation>;
  readonly stats: EngineStats;
}

export interface IncrementalApplyResult {
  readonly text: string;
  readonly transformedOperations: ReadonlyArray<ExternalOperation>;
}
