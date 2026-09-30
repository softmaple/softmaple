import type { EventGraph } from "../../graph/event-graph";
import type { PersistentUtf16Rope } from "../../text/persistent-utf16-rope";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import type { RecordContent } from "./record-content";
import type { PlaceholderPhysicalSlice } from "./segmented-placeholder";

export const PLACEHOLDER_EVENT_ID = "__placeholder__";
export const PLACEHOLDER_ID_PREFIX = "__placeholder__:";

/**
 * Engine-local key of an {@link AugmentedCRDTItem}. Keys are dense, start at
 * 1 and are never reused by one engine, so per-item state lives in arrays
 * indexed by key instead of string-keyed maps.
 */
export type ItemKey = number;

/**
 * `agent` of an item whose event ID is not a canonical `replicaId:sequence`;
 * its `sequence` holds the event's local version.
 */
export const CUSTOM_EVENT_AGENT = -1;

/** `agent` of a placeholder item; its `sequence` holds the placeholder serial. */
export const PLACEHOLDER_AGENT = -2;

/**
 * Augmented CRDT item used during replay.
 *
 * An item names the event that inserted its first code unit numerically:
 * `(agent, sequence)` for a canonical event ID, the event's local version for
 * any other ID, or a placeholder serial. `offset` is the code unit's index in
 * that event. The persisted string form `${eventId}:${offset}` (and
 * `__placeholder__:${serial}`) is formatted only at snapshot and recovery
 * boundaries.
 *
 * A record can take two coalesced shapes (or be a single-event item):
 *
 * - **Placeholder** (`agent === PLACEHOLDER_AGENT`, `run === false`):
 *   contiguous run of pre-checkpoint / initial-text content, split on
 *   demand by concurrent inserts and deletes. Splits assign fresh
 *   placeholder serials to the right half.
 * - **Typed-run record** (`run === true`): coalesced run of contiguous
 *   single-character INSERT events of `agent`, starting at `sequence`
 *   (Section 3.4 "smaller" lever). Splits move whole-event slices to new
 *   records that start at the later sequence.
 *
 * Multi-character INSERT events stay one record per code unit (each with
 * `run === false` and its `offset`); we do not coalesce them, since the
 * per-code-unit IDs already serve as anchors for concurrent siblings.
 *
 * `content` is mutable to support in-place run extension and splits without
 * invalidating the `WeakMap` location index in `IndexedSequence`. Ordinary
 * and typed-run records use strings; checkpoint placeholders use immutable
 * rope views that split without materializing the retained document.
 */
export interface AugmentedCRDTItem {
  readonly id: ItemKey;
  readonly agent: number;
  readonly sequence: number;
  readonly offset: number;
  content: RecordContent;
  originLeft: ItemKey | null;
  readonly originRight: ItemKey | null;
  everDeleted: boolean;
  prepareState: number;
  readonly run: boolean;
  /** Deferred checkpoint state; absent from ordinary and serialized records. */
  placeholder?: PlaceholderPhysicalSlice<AugmentedCRDTItem>;
  /**
   * Verbatim string IDs of an item restored from a record whose IDs do not
   * follow the `${eventId}:${offset}` scheme, so it round-trips unchanged.
   */
  readonly external?: ExternalItemIds;
}

export interface ExternalItemIds {
  readonly id: EventId;
  readonly eventId: EventId;
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
  readonly integrationProbeCount: number;
  readonly fugueComparisons: number;
  readonly fugueMarkerOperations: number;
  readonly fugueRotations: number;
  readonly fugueRebuilds: number;
  readonly sequenceTreeOperations: number;
}

export interface GenerateOptions {
  readonly initialVersion?: ReadonlySet<EventId>;
  readonly initialTextBuffer?: PersistentUtf16Rope;
  readonly eventGraph?: EventGraph;
  /**
   * Whether batch replay should retain every transformed operation.
   *
   * Defaults to `true` for compatibility. Full-replay callers that only need
   * the resulting document can disable collection to avoid retaining an
   * operation array proportional to the number of replayed events. The
   * generated result returns an empty array when collection is disabled.
   */
  readonly collectTransformedOperations?: boolean;
  /**
   * Topological rank source for prepare/effect retreat/advance ordering.
   *
   * When omitted, the engine uses `eventGraph.getTopologicalOrder()` if a
   * graph is provided. Partial replay can pass the already-computed divergent
   * suffix order here so reset does not rebuild full-graph ordering on every
   * checkpoint replay.
   */
  readonly eventOrder?: ReadonlyArray<GraphEvent>;
  /**
   * {@link eventOrder} as local versions of `eventGraph`, for callers that
   * already hold a numeric suffix order.
   */
  readonly eventOrderLocalVersions?: ReadonlyArray<number>;
  /** Test-only slow oracle; production always uses FugueOrderIndex. */
  readonly integrationMode?: "indexed" | "linear-oracle";
}

export interface GeneratedDocument {
  readonly text: string;
  readonly textBuffer: PersistentUtf16Rope;
  readonly transformedOperations: ReadonlyArray<ExternalOperation>;
  readonly stats: EngineStats;
}

export interface IncrementalApplyResult {
  readonly text: string;
  readonly textBuffer: PersistentUtf16Rope;
  readonly transformedOperations: ReadonlyArray<ExternalOperation>;
}

/**
 * The items of one engine, indexed by {@link ItemKey}. Items are never
 * removed, so keys stay dense and the table's size is the record count.
 */
export class ItemTable {
  private items: Array<AugmentedCRDTItem | undefined> = [undefined];

  get size(): number {
    return this.items.length - 1;
  }

  /** The key the next item must use. */
  nextKey(): ItemKey {
    return this.items.length;
  }

  add(item: AugmentedCRDTItem): void {
    if (item.id !== this.items.length) {
      throw new Error(`CRDT item ${item.id} is out of key order`);
    }
    this.items.push(item);
  }

  at(itemId: ItemKey): AugmentedCRDTItem | undefined {
    return this.items[itemId];
  }

  require(itemId: ItemKey): AugmentedCRDTItem {
    const item = this.items[itemId];
    if (item === undefined) {
      throw new Error(`CRDT item ${itemId} not found`);
    }
    return item;
  }

  clear(): void {
    this.items = [undefined];
  }
}

export const formatPlaceholderId = (serial: number): EventId =>
  `${PLACEHOLDER_ID_PREFIX}${serial}`;

/** Serial of a `__placeholder__:N` ID, or `-1` when `id` is not one. */
export const placeholderSerialOf = (id: EventId): number => {
  if (!id.startsWith(PLACEHOLDER_ID_PREFIX)) {
    return -1;
  }
  const suffix = id.slice(PLACEHOLDER_ID_PREFIX.length);
  const serial = Number(suffix);
  return Number.isSafeInteger(serial) &&
    serial >= 0 &&
    String(serial) === suffix
    ? serial
    : -1;
};
