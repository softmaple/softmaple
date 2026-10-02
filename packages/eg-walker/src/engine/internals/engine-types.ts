import type { EventGraph } from "../../graph/event-graph";
import type { PersistentUtf16Rope } from "../../text/persistent-utf16-rope";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import type { RunItemNode } from "./event-item-index";
import type { IndexedSequenceItem, LeafNode } from "./indexed-sequence-node";
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
 * A record takes one of three run-length shapes:
 *
 * - **Placeholder** (`agent === PLACEHOLDER_AGENT`, `run === false`):
 *   contiguous run of pre-checkpoint / initial-text content, split on
 *   demand by concurrent inserts and deletes. Splits assign fresh
 *   placeholder serials to the right half.
 * - **Typed-run record** (`run === true`): coalesced run of contiguous
 *   single-character INSERT events of `agent`, starting at `sequence`
 *   (Section 3.4 "smaller" lever). Splits move whole-event slices to new
 *   records that start at the later sequence.
 * - **Insert-run record** (any other agent, `run === false`): code units
 *   `offset .. offset + content.length` of one INSERT event. An insert is
 *   integrated as a single record; the code unit at offset `k` keeps the ID
 *   `(event, k)`, so a split only moves the right half's `offset`. Splits
 *   happen where a concurrent insert or delete lands, and every fragment
 *   stays registered under its event for retreat / advance.
 *
 * Typed-run and insert-run records compress a chain of per-code-unit CRDT
 * items in which each code unit's left origin is the one before it. A split
 * restores the chain boundary by giving the right half the left half as its
 * left origin.
 *
 * `content` is mutable to support in-place run extension and splits without
 * moving the record in `IndexedSequence`. Ordinary and typed-run records use
 * strings; checkpoint placeholders use immutable rope views that split
 * without materializing the retained document.
 *
 * The engine's indexes keep their per-item state in fields of the item
 * instead of side tables keyed by it: `sequenceLeaf` belongs to
 * `IndexedSequence` and `runNode` to `EventItemIndex`. Every creation site
 * declares every field below, in order, so that all items share one hidden
 * class. A new item starts with `sequenceLeaf: null` and `runNode: null`.
 */
export interface AugmentedCRDTItem
  extends IndexedSequenceItem<AugmentedCRDTItem> {
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
  /** Deferred checkpoint state; `undefined` for ordinary records. */
  placeholder: PlaceholderPhysicalSlice<AugmentedCRDTItem> | undefined;
  /**
   * Verbatim string IDs of an item restored from a record whose IDs do not
   * follow the `${eventId}:${offset}` scheme, so it round-trips unchanged.
   */
  readonly external: ExternalItemIds | undefined;
  /** Leaf of the `IndexedSequence` that holds the item, or `null`. */
  sequenceLeaf: LeafNode<AugmentedCRDTItem> | null;
  /** Typed-run range node of the `EventItemIndex` that registered it. */
  runNode: RunItemNode | null;
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
   * unit. Initial document text, pre-checkpoint placeholders, typed runs and
   * multi-character inserts are stored as run-length records; concurrent
   * inserts and deletes split records on demand. Tracking the count lets
   * tests prove the coalescing happened
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
   * Test-only: how an insert whose conflict region is not empty finds its
   * position. Production leaves it unset, which means `"adaptive"`:
   *
   * - `"adaptive"`: the linear scan, within {@link integrationScanBudget}.
   *   The first scan that would overrun it builds the `FugueOrderIndex`,
   *   which places that insert and every later one.
   * - `"indexed"`: maintain the `FugueOrderIndex` from the start.
   * - `"linear-oracle"`: the unbounded linear scan and no index, without the
   *   shortcuts that append to the previous insert's record.
   */
  readonly integrationMode?: "adaptive" | "indexed" | "linear-oracle";
  /**
   * Test-only: the adaptive scan's probe budget. Defaults to
   * {@link DEFAULT_INTEGRATION_SCAN_BUDGET}.
   */
  readonly integrationScanBudget?: IntegrationScanBudget;
}

/**
 * Probes the adaptive conflict scan may spend since the engine's last reset
 * before the engine builds its `FugueOrderIndex`: `initial`, plus `perRecord`
 * for each record in the sequence.
 */
export interface IntegrationScanBudget {
  readonly initial: number;
  readonly perRecord: number;
}

/**
 * Two probes per record cost about what maintaining the index for that record
 * would. On the paper traces nearly every scan stops at its first record, and
 * the few that cross thousands stay within the budget. Concurrent inserts that
 * keep landing at one position spend it within a dozen inserts, after which
 * the index keeps the burst O(n log n).
 */
export const DEFAULT_INTEGRATION_SCAN_BUDGET: IntegrationScanBudget =
  Object.freeze({ initial: 32, perRecord: 2 });

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
