import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import { compareEventIds, parseEventId } from "../graph/event-id";
import type { EventId, ExternalOperation, GraphEvent } from "../types";
import { IndexedSequence } from "./indexed-sequence";

const PLACEHOLDER_EVENT_ID = "__placeholder__";
const PLACEHOLDER_ID_PREFIX = "__placeholder__:";

/**
 * Identity of a {@link AugmentedCRDTItem} that represents a coalesced run
 * of contiguous single-character INSERT events from one author. The record
 * spans `content.length` events whose IDs are
 * `${replicaId}:${startSequence + offsetInRecord}` for
 * `offsetInRecord ∈ [0, content.length)`.
 *
 * Records produced by multi-character paste events and the initial-text
 * placeholder do **not** carry a {@link TypedRun}; for those, the
 * `eventId` field alone identifies the owning event.
 */
interface TypedRun {
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
 * {@link IndexedSequence}.
 */
interface AugmentedCRDTItem {
  readonly id: EventId;
  readonly eventId: EventId;
  content: string;
  originLeft: EventId | null;
  readonly originRight: EventId | null;
  everDeleted: boolean;
  prepareState: number;
  run: TypedRun | null;
}

const isPlaceholder = (item: AugmentedCRDTItem): boolean =>
  item.eventId === PLACEHOLDER_EVENT_ID;

interface EngineStats {
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
}

export interface GeneratedDocument {
  readonly text: string;
  readonly transformedOperations: ReadonlyArray<ExternalOperation>;
  readonly stats: EngineStats;
}

export interface GenerateOptions {
  readonly initialVersion?: ReadonlySet<EventId>;
  readonly eventGraph?: EventGraph;
}

export interface IncrementalApplyResult {
  readonly text: string;
  readonly transformedOperations: ReadonlyArray<ExternalOperation>;
}

const spliceText = (text: string, index: number, insertText: string): string =>
  `${text.slice(0, index)}${insertText}${text.slice(index)}`;

const deleteText = (text: string, index: number, length: number): string =>
  `${text.slice(0, index)}${text.slice(index + length)}`;

/**
 * Split a string into JS UTF-16 code units, one per array slot. Unlike
 * `Array.from(text)` (which iterates code points and would coalesce a
 * surrogate pair into one entry), this preserves the public-API code-unit
 * indexing on which the CRDT items are keyed.
 *
 * Lone surrogates are intentionally **not** rejected here: by the time a
 * string reaches this helper it has already been validated at the public
 * boundary (`EgWalkerReplica.assertWellFormedUtf16` for local inserts and
 * `assertRemoteEventWellFormed` for remote events). Bypassing the engine
 * directly with an ill-formed string would still materialise lone
 * surrogates as standalone CRDT items, but the public API never reaches
 * this path with such input.
 */
const stringCodeUnits = (text: string): string[] => text.split("");

/**
 * Direct implementation of the Eg-walker replay algorithm from Appendix B.
 *
 * The event graph and plain document text remain persistent state. This class is
 * temporary replay state: it creates augmented CRDT records with prepare-state
 * and effect-state, walks causal history, and then can be discarded.
 */
export class EgWalkerEngine {
  private readonly eventsById = new Map<EventId, GraphEvent>();
  private readonly eventOrder = new Map<EventId, number>();
  private graph = new EventGraph();
  private readonly eventItems = new Map<EventId, EventId[]>();
  private readonly deleteTargets = new Map<EventId, EventId[]>();
  private readonly itemsById = new Map<EventId, AugmentedCRDTItem>();
  // Reverse index: `target item id` -> set of item ids whose `originLeft`
  // points at it. Maintained alongside {@link itemsById} so that
  // {@link splitRecordAt} can cheaply rewrite the `originLeft` references
  // when it carves a placeholder in two. Without this rewrite the YATA
  // integration scan would see siblings anchored to the same logical
  // boundary as if they had different origins, which breaks partial
  // replay convergence.
  private readonly originLeftRefs = new Map<EventId, Set<EventId>>();
  // Reverse index: `target item id` -> set of delete event ids whose
  // {@link deleteTargets} list contains it. Maintained so that
  // {@link splitRecordAt} can extend the membership to the new right
  // half when it carves a previously-deleted record in two: without
  // this, retreating/advancing the delete only flips the prepare-state
  // of the left half and the right half stays prepare-visible even
  // though it is effect-deleted, which shifts later prepare-index
  // lookups (e.g. local inserts anchored at the document end) into
  // the middle of the deleted range.
  private readonly deleteTargetsByItem = new Map<EventId, Set<EventId>>();
  private readonly sequence = new IndexedSequence<AugmentedCRDTItem>(
    (item) => (item.prepareState === 1 ? item.content.length : 0),
    (item) => (item.everDeleted ? 0 : item.content.length),
  );
  private currentVersion = new Set<EventId>();
  private resultingText = "";
  private retreatCount = 0;
  private advanceCount = 0;
  private nonConflictingRunCount = 0;
  private fullReplayCount = 0;
  private placeholderCounter = 0;

  generate(
    events: ReadonlyArray<GraphEvent>,
    initialText: string = "",
    options: GenerateOptions = {},
  ): GeneratedDocument {
    this.reset(events, initialText, options);

    const transformedOperations: ExternalOperation[] = [];

    for (const event of events) {
      const transformed = this.processEvent(event);
      transformedOperations.push(...transformed);
    }

    return {
      text: this.resultingText,
      transformedOperations,
      stats: {
        retreatCount: this.retreatCount,
        advanceCount: this.advanceCount,
        eventsProcessed: events.length,
        nonConflictingRunCount: this.nonConflictingRunCount,
        fullReplayCount: this.fullReplayCount,
        sequenceRecordCount: this.itemsById.size,
      },
    };
  }

  /**
   * Apply a single new event on top of the current engine state without
   * resetting. The caller must ensure {@link graph} is the up-to-date event
   * graph that already contains {@link event}.
   */
  applyEvent(event: GraphEvent, graph: EventGraph): IncrementalApplyResult {
    if (!this.eventsById.has(event.id)) {
      this.eventsById.set(event.id, event);
      this.eventOrder.set(event.id, this.eventOrder.size);
    }
    this.graph = graph;

    const transformed = this.processEvent(event);
    return {
      text: this.resultingText,
      transformedOperations: transformed,
    };
  }

  getText(): string {
    return this.resultingText;
  }

  getCurrentVersion(): ReadonlySet<EventId> {
    return this.currentVersion;
  }

  getStats(): EngineStats {
    return {
      retreatCount: this.retreatCount,
      advanceCount: this.advanceCount,
      eventsProcessed: this.eventsById.size,
      nonConflictingRunCount: this.nonConflictingRunCount,
      fullReplayCount: this.fullReplayCount,
      sequenceRecordCount: this.itemsById.size,
    };
  }

  private processEvent(event: GraphEvent): ExternalOperation[] {
    // Section 3.4 "internal-document" fast path.
    //
    // When the event's parent version already equals the engine's current
    // version, the diff between them is empty by construction — there are
    // no events to retreat or advance — and the operation reduces to a
    // linear edit on top of the current state. We can therefore skip the
    // full diff/retreat/advance machinery, which is the dominant cost on
    // single-author traces and on remote events that simply extend the
    // shared frontier.
    //
    // Concurrent / divergent events still fall through to the full path
    // below, which retreats overlapping inserts/deletes back to the
    // event's prepare-view and re-advances after applying.
    if (this.isNonConflictingRun(event)) {
      const transformed = this.apply(event);
      this.currentVersion = new Set([event.id]);
      this.nonConflictingRunCount++;
      return transformed;
    }

    const { retreat, advance } = this.diffVersions(
      this.currentVersion,
      event.parentVersion,
    );

    for (const eventId of retreat) {
      this.retreat(eventId);
    }
    for (const eventId of advance) {
      this.advance(eventId);
    }

    const transformed = this.apply(event);
    this.currentVersion = new Set([event.id]);
    this.fullReplayCount++;
    return transformed;
  }

  /**
   * Section 3.4 non-conflicting-run detection.
   *
   * Returns true iff {@link event.parentVersion} matches
   * {@link currentVersion} exactly. Set equality is enough: each event's
   * parent version is already a frontier of the causal graph, so two
   * frontiers compare equal as sets iff they expand to the same ancestor
   * closure. When this holds, `diffVersions(currentVersion, parent)`
   * returns two empty sets and the retreat/advance loops are no-ops, so
   * the caller can skip them outright.
   */
  private isNonConflictingRun(event: GraphEvent): boolean {
    const parent = event.parentVersion;
    if (parent.size !== this.currentVersion.size) {
      return false;
    }
    for (const id of parent) {
      if (!this.currentVersion.has(id)) {
        return false;
      }
    }
    return true;
  }

  private reset(
    events: ReadonlyArray<GraphEvent>,
    initialText: string,
    options: GenerateOptions,
  ): void {
    this.eventsById.clear();
    this.eventOrder.clear();
    this.graph = options.eventGraph ?? new EventGraph();
    this.eventItems.clear();
    this.deleteTargets.clear();
    this.deleteTargetsByItem.clear();
    this.itemsById.clear();
    this.originLeftRefs.clear();
    this.sequence.clear();
    this.currentVersion = new Set(options.initialVersion ?? []);
    this.resultingText = initialText;
    this.retreatCount = 0;
    this.advanceCount = 0;
    this.nonConflictingRunCount = 0;
    this.fullReplayCount = 0;
    this.placeholderCounter = 0;

    const graphEvents = options.eventGraph?.getTopologicalOrder() ?? events;
    graphEvents.forEach((event, index) => {
      this.eventsById.set(event.id, event);
      this.eventOrder.set(event.id, index);
      if (!options.eventGraph) {
        this.graph.addEvent(event);
      }
    });

    if (initialText.length === 0) {
      return;
    }

    // Sections 3.4 / 3.6 of the paper: store the seeded text as a single
    // run-length record instead of one CRDT item per UTF-16 code unit. The
    // partial-replay path already did this for the pre-checkpoint suffix
    // (one placeholder record split on demand by intervening inserts and
    // deletes); doing the same for the full-replay seed makes the
    // steady-state memory of a non-empty document independent of the seed
    // length — a long initial document is a single record until concurrent
    // edits land inside it.
    //
    // The placeholder eventId is engine-internal and never persisted, so
    // collapsing all initial text into a placeholder doesn't change any
    // user-observable id. `splitRecordAt` carves placeholders into smaller
    // records when later concurrent inserts/deletes anchor inside them,
    // matching the partial-replay path that has been exercising this code
    // since Section 3.6 landed.
    const placeholder: AugmentedCRDTItem = {
      id: this.nextPlaceholderId(),
      eventId: PLACEHOLDER_EVENT_ID,
      content: initialText,
      originLeft: null,
      originRight: null,
      everDeleted: false,
      prepareState: 1,
      run: null,
    };
    this.sequence.push(placeholder);
    this.itemsById.set(placeholder.id, placeholder);
  }

  private nextPlaceholderId(): EventId {
    return `${PLACEHOLDER_ID_PREFIX}${this.placeholderCounter++}`;
  }

  private apply(event: GraphEvent): ExternalOperation[] {
    const operation = event.operation;

    if (operation.type === OPERATION_TYPE.INSERT) {
      return this.applyInsert(event, operation);
    }

    return this.applyDelete(event, operation);
  }

  private applyInsert(
    event: GraphEvent,
    operation: Extract<
      ExternalOperation,
      { type: typeof OPERATION_TYPE.INSERT }
    >,
  ): ExternalOperation[] {
    if (operation.text.length === 0) {
      this.eventItems.set(event.id, []);
      return [];
    }

    const landing = this.sequence.prepareIndexToPositionAndOffset(
      operation.index,
      true,
    );
    const firstInsertPosition =
      landing.offsetInRecord > 0
        ? this.splitRecordAt(landing.position, landing.offsetInRecord)
        : landing.position;
    // YATA-style origins: anchor against the records visible in the
    // event's parent version (prepare-state >= 1), NOT against whichever
    // concurrent records happen to be sitting in the sequence right now.
    // Without this filter the engine would assign different origins to
    // the same event depending on which concurrent siblings were
    // integrated first, breaking traversal-order independence.
    const originLeftPosition =
      this.sequence.previousPrepareVisiblePosition(firstInsertPosition);
    const originLeft =
      originLeftPosition === null
        ? null
        : (this.sequence.at(originLeftPosition)?.id ?? null);
    const originRightPosition =
      this.sequence.nextPrepareVisiblePosition(firstInsertPosition);
    const originRight =
      originRightPosition === null
        ? null
        : (this.sequence.at(originRightPosition)?.id ?? null);

    // Section 3.4 internal-document fast path for the first item.
    //
    // The YATA integration scan walks the sequence positions strictly
    // between `originLeft` and `originRight`. When that range is empty
    // (no retreated, deleted, or otherwise non-prepare-visible records
    // sit in it) the scan is provably a no-op, so we can place the
    // first item at `firstInsertPosition` without invoking it. The
    // dominant case for this is a non-conflicting run: no concurrent
    // siblings have been integrated near the insertion point, so the
    // previous-prepare-visible record is the literal neighbour of
    // `firstInsertPosition`.
    const leftBound = originLeftPosition ?? -1;
    const rightBound = originRightPosition ?? this.sequence.length;
    const conflictRegionEmpty =
      leftBound + 1 === firstInsertPosition &&
      firstInsertPosition === rightBound;

    // Section 3.4 "smaller" lever: typed-run coalescing.
    //
    // When a single-character INSERT lands at the right boundary of an
    // adjacent typed-run record from the same author whose run extends by
    // exactly one sequence number, append to that record's content
    // instead of allocating a new CRDT item. The columnar codec already
    // groups events into id-runs by (replicaId, contiguous sequence) for
    // wire encoding; mirroring that grouping in the ranked B-tree
    // collapses a 20k-character linear single-author trace to ~1 record
    // (down from one per code unit) while leaving multi-author / multi-event
    // ordering unchanged \u2014 split-on-demand carves the run when a
    // concurrent insert or delete anchors inside it.
    const parsed = parseEventId(event.id);
    if (
      conflictRegionEmpty &&
      operation.text.length === 1 &&
      parsed !== null &&
      originLeftPosition !== null &&
      originLeftPosition === firstInsertPosition - 1
    ) {
      const leftRecord = this.sequence.at(originLeftPosition);
      if (
        leftRecord !== undefined &&
        leftRecord.run !== null &&
        leftRecord.run.replicaId === parsed.replicaId &&
        leftRecord.run.startSequence + leftRecord.content.length ===
          parsed.sequence &&
        leftRecord.prepareState === 1 &&
        !leftRecord.everDeleted &&
        // Don't extend a run that already has items anchored to its right
        // boundary \u2014 those items chose this id as their `originLeft` at a
        // moment when the record ended one code unit earlier, and stretching
        // the content would shift the boundary they were anchored to.
        !this.hasOriginLeftRefs(leftRecord.id)
      ) {
        const effectIndex =
          this.itemToEffectIndex(leftRecord) + leftRecord.content.length;
        leftRecord.content += operation.text;
        this.sequence.updateItem(leftRecord);
        this.eventItems.set(event.id, [leftRecord.id]);
        this.resultingText = spliceText(
          this.resultingText,
          effectIndex,
          operation.text,
        );

        return [
          {
            type: OPERATION_TYPE.INSERT,
            index: effectIndex,
            text: operation.text,
          },
        ];
      }
    }

    const codeUnits = stringCodeUnits(operation.text);
    const insertedIds: EventId[] = [];
    let left = originLeft;

    // First code unit: pay the full integration scan if the conflict region
    // isn't empty. Single-character INSERTs from a canonical
    // `replicaId:sequence` author seed a typed-run record so that later
    // contiguous events from the same author can extend it in-place (the
    // coalescing branch above). Multi-character INSERTs and IDs that don't
    // parse keep `run = null` and behave like the pre-coalescing engine.
    const firstRun: TypedRun | null =
      parsed !== null && operation.text.length === 1
        ? { replicaId: parsed.replicaId, startSequence: parsed.sequence }
        : null;
    const firstItem: AugmentedCRDTItem = {
      id: `${event.id}:0`,
      eventId: event.id,
      content: codeUnits[0] ?? "",
      originLeft: left,
      originRight,
      everDeleted: false,
      prepareState: 1,
      run: firstRun,
    };
    let actualFirstPosition: number;
    if (conflictRegionEmpty) {
      actualFirstPosition = firstInsertPosition;
      this.sequence.insert(actualFirstPosition, firstItem);
    } else {
      actualFirstPosition = this.findIntegrationPosition(firstItem);
      this.sequence.insert(actualFirstPosition, firstItem);
    }
    this.itemsById.set(firstItem.id, firstItem);
    this.trackOriginLeft(firstItem.id, firstItem.originLeft);
    insertedIds.push(firstItem.id);
    left = firstItem.id;

    // Multi-character inserts: every subsequent item is chained off the
    // previous item via `originLeft`. No record that existed before this
    // event can reference that brand-new id, so the YATA scan for chars
    // 1..N terminates on its first iteration and the integration
    // position is unconditionally `previous + 1`. We bypass the scan
    // and place them at sequential positions instead of paying
    // `findIntegrationPosition`'s setup cost per character. The items
    // stay `run = null` because typed-run coalescing operates on
    // single-character events from contiguous sequence numbers, not on
    // the per-code-unit fragments of one multi-character INSERT.
    for (let offset = 1; offset < codeUnits.length; offset++) {
      const item: AugmentedCRDTItem = {
        id: `${event.id}:${offset}`,
        eventId: event.id,
        content: codeUnits[offset] ?? "",
        originLeft: left,
        originRight,
        everDeleted: false,
        prepareState: 1,
        run: null,
      };
      this.sequence.insert(actualFirstPosition + offset, item);
      this.itemsById.set(item.id, item);
      this.trackOriginLeft(item.id, item.originLeft);
      insertedIds.push(item.id);
      left = item.id;
    }

    this.eventItems.set(event.id, insertedIds);

    const firstInserted = this.requireItem(insertedIds[0] ?? event.id);
    const effectIndex = this.itemToEffectIndex(firstInserted);
    this.resultingText = spliceText(
      this.resultingText,
      effectIndex,
      operation.text,
    );

    return [
      {
        type: OPERATION_TYPE.INSERT,
        index: effectIndex,
        text: operation.text,
      },
    ];
  }

  private applyDelete(
    event: GraphEvent,
    operation: Extract<
      ExternalOperation,
      { type: typeof OPERATION_TYPE.DELETE }
    >,
  ): ExternalOperation[] {
    const deletedItemIds: EventId[] = [];
    const outputDeleteIndexes: number[] = [];
    let remaining = operation.length;

    while (remaining > 0) {
      // A delete event whose `length` runs past the prepare-visible items at
      // the engine's current parent version legitimately stops short — this
      // is exercised by the "deletes that run past visible prepare items"
      // test. The previous implementation wrapped the throwing
      // `prepareIndexToPositionAndOffset` in a catch-all try/catch, which
      // also swallowed real bugs (e.g. ranked-B-tree aggregate corruption).
      // Use the explicit non-throwing variant for the expected end-of-text
      // case, and let other errors surface.
      const landing = this.sequence.tryPrepareIndexToPositionAndOffset(
        operation.index,
        false,
      );
      if (!landing) {
        break;
      }
      const candidate = this.sequence.at(landing.position);
      if (!candidate) {
        // The ranked B-tree just told us the prepare-weight prefix sum lands
        // on `landing.position`, so a missing record there means the tree's
        // aggregates disagree with its children — a structural bug we want
        // to surface, not silently truncate the delete around.
        throw new Error(
          `Engine bug: prepare-index ${operation.index} landed at sequence position ` +
            `${landing.position} but no record exists there (remaining=${remaining}).`,
        );
      }

      // Multi-character records (placeholders and typed-run leaves coalesced
      // by Section 3.4) are split on demand so the deleted slice is its own
      // record. Single-character records and per-code-unit paste fragments
      // skip the split entirely and are marked in place.
      const isMultiCharRecord =
        (isPlaceholder(candidate) || candidate.run !== null) &&
        candidate.content.length > 1;
      if (isMultiCharRecord) {
        const availableInRecord =
          candidate.content.length - landing.offsetInRecord;
        const toDelete = Math.min(remaining, availableInRecord);
        const middle = this.splitRecordForDelete(
          landing.position,
          landing.offsetInRecord,
          toDelete,
        );

        deletedItemIds.push(middle.id);
        // A concurrent delete that lands on an already-effect-deleted slice
        // (e.g. after retreating an overlapping sibling) must NOT remove
        // characters from the text again. Without this, two concurrent
        // deletes of the same region replay to a shorter string than full
        // replay produces.
        if (!middle.everDeleted) {
          const effectIndex = this.itemToEffectIndex(middle);
          for (let k = 0; k < toDelete; k++) {
            outputDeleteIndexes.push(effectIndex);
          }
          this.resultingText = deleteText(
            this.resultingText,
            effectIndex,
            toDelete,
          );
        }

        middle.everDeleted = true;
        middle.prepareState += 1;
        this.sequence.updateItem(middle);
        remaining -= toDelete;
        continue;
      }

      deletedItemIds.push(candidate.id);
      if (!candidate.everDeleted) {
        const effectIndex = this.itemToEffectIndex(candidate);
        outputDeleteIndexes.push(effectIndex);
        this.resultingText = deleteText(this.resultingText, effectIndex, 1);
      }
      candidate.everDeleted = true;
      candidate.prepareState += 1;
      this.sequence.updateItem(candidate);
      remaining -= 1;
    }

    this.recordDeleteTargets(event.id, deletedItemIds);

    return coalesceDeleteRuns(outputDeleteIndexes);
  }

  /**
   * Split a multi-character record so that `offsetInRecord` code units
   * remain in place and the rest become a new record at `position + 1`.
   * Returns the position of the new right-hand record — i.e. where neighbours
   * sandwiched between the two halves should be inserted. Single-character
   * records and offset-0 calls are no-ops.
   *
   * Two record shapes carry multi-character content and can be split:
   *
   * - **Placeholder:** right gets a fresh placeholder id; both halves stay
   *   anonymous, owned by the engine-internal `PLACEHOLDER_EVENT_ID`.
   * - **Typed-run record:** right inherits the run's replicaId with
   *   `startSequence` advanced by `offsetInRecord`, and the `eventItems`
   *   entry for every event whose sequence moved to the right half is
   *   repointed from `left.id` to `right.id` so retreat / advance still
   *   land on the right slice.
   */
  private splitRecordAt(position: number, offsetInRecord: number): number {
    const left = this.sequence.at(position);
    if (!left || offsetInRecord <= 0 || offsetInRecord >= left.content.length) {
      return position + (offsetInRecord > 0 ? 1 : 0);
    }

    const leftOriginalLength = left.content.length;
    const rightContent = left.content.slice(offsetInRecord);
    left.content = left.content.slice(0, offsetInRecord);
    this.sequence.updateItem(left);

    const right = this.buildSplitRightHalf(left, offsetInRecord, rightContent);
    this.sequence.insert(position + 1, right);
    this.itemsById.set(right.id, right);

    // Existing items with `originLeft = left.id` were anchored to the
    // right boundary of the pre-split record; that boundary now lives
    // at the end of {@link right}, so transfer their `originLeft`
    // references over. `originRight = left.id` references still point
    // at the left edge of the original record, which is unchanged.
    this.rewriteOriginLeftReferences(left.id, right.id);
    // Extend any prior delete-target memberships to cover {@link right}
    // as well. The pre-split record was already part of `deleteTargets`
    // for every event in this set; both halves now share the same
    // `everDeleted` and `prepareState` and must move together under
    // future retreat / advance calls for those events.
    this.extendDeleteTargetMembership(left.id, right.id);
    this.rewriteEventItemsForRunSplit(
      left,
      right,
      offsetInRecord,
      leftOriginalLength,
    );
    return position + 1;
  }

  private buildSplitRightHalf(
    left: AugmentedCRDTItem,
    offsetInRecord: number,
    rightContent: string,
  ): AugmentedCRDTItem {
    if (left.run !== null) {
      const startSequence = left.run.startSequence + offsetInRecord;
      return {
        id: `${left.run.replicaId}:${startSequence}:0`,
        eventId: `${left.run.replicaId}:${startSequence}`,
        content: rightContent,
        originLeft: null,
        originRight: null,
        everDeleted: left.everDeleted,
        prepareState: left.prepareState,
        run: {
          replicaId: left.run.replicaId,
          startSequence,
        },
      };
    }
    return {
      id: this.nextPlaceholderId(),
      eventId: PLACEHOLDER_EVENT_ID,
      content: rightContent,
      originLeft: null,
      originRight: null,
      everDeleted: left.everDeleted,
      prepareState: left.prepareState,
      run: null,
    };
  }

  private rewriteEventItemsForRunSplit(
    left: AugmentedCRDTItem,
    right: AugmentedCRDTItem,
    offsetInRecord: number,
    leftOriginalLength: number,
  ): void {
    if (left.run === null) {
      return;
    }
    // Each sequence in `[startSequence + offsetInRecord, startSequence + N)`
    // is a single-character INSERT whose `eventItems` entry currently lists
    // `left.id`. Repoint those entries to `right.id` so retreat / advance
    // visit the half that actually holds the slice.
    const runStart = left.run.startSequence + offsetInRecord;
    const runEnd = left.run.startSequence + leftOriginalLength;
    for (let sequence = runStart; sequence < runEnd; sequence++) {
      const eventId: EventId = `${left.run.replicaId}:${sequence}`;
      const items = this.eventItems.get(eventId);
      if (!items) {
        continue;
      }
      let mutated = false;
      const next = items.map((id) => {
        if (id === left.id) {
          mutated = true;
          return right.id;
        }
        return id;
      });
      if (mutated) {
        this.eventItems.set(eventId, next);
      }
    }
  }

  private recordDeleteTargets(
    deleteEventId: EventId,
    itemIds: ReadonlyArray<EventId>,
  ): void {
    this.deleteTargets.set(deleteEventId, [...itemIds]);
    for (const itemId of itemIds) {
      let owners = this.deleteTargetsByItem.get(itemId);
      if (!owners) {
        owners = new Set<EventId>();
        this.deleteTargetsByItem.set(itemId, owners);
      }
      owners.add(deleteEventId);
    }
  }

  private extendDeleteTargetMembership(
    fromItemId: EventId,
    toItemId: EventId,
  ): void {
    const owners = this.deleteTargetsByItem.get(fromItemId);
    if (!owners || owners.size === 0) {
      return;
    }
    let mirrored = this.deleteTargetsByItem.get(toItemId);
    for (const deleteEventId of owners) {
      // Invariant: `toItemId` is a freshly minted `nextPlaceholderId()`,
      // so it cannot already appear in this delete event's target list.
      // Guard defensively so a future call site that breaks the freshness
      // assumption doesn't silently produce duplicate entries (which would
      // double-toggle prepare-state on retreat/advance).
      if (mirrored?.has(deleteEventId)) {
        continue;
      }
      const targets = this.deleteTargets.get(deleteEventId);
      if (!targets) {
        continue;
      }
      targets.push(toItemId);
      if (!mirrored) {
        mirrored = new Set<EventId>();
        this.deleteTargetsByItem.set(toItemId, mirrored);
      }
      mirrored.add(deleteEventId);
    }
  }

  private trackOriginLeft(itemId: EventId, originLeft: EventId | null): void {
    if (originLeft === null) {
      return;
    }
    const set = this.originLeftRefs.get(originLeft) ?? new Set<EventId>();
    set.add(itemId);
    this.originLeftRefs.set(originLeft, set);
  }

  private hasOriginLeftRefs(itemId: EventId): boolean {
    const refs = this.originLeftRefs.get(itemId);
    return refs !== undefined && refs.size > 0;
  }

  private rewriteOriginLeftReferences(
    oldOriginLeft: EventId,
    newOriginLeft: EventId,
  ): void {
    const refs = this.originLeftRefs.get(oldOriginLeft);
    if (!refs || refs.size === 0) {
      return;
    }
    this.originLeftRefs.delete(oldOriginLeft);
    const merged = this.originLeftRefs.get(newOriginLeft) ?? new Set<EventId>();
    for (const itemId of refs) {
      const item = this.itemsById.get(itemId);
      if (!item || item.originLeft !== oldOriginLeft) {
        continue;
      }
      item.originLeft = newOriginLeft;
      merged.add(itemId);
    }
    if (merged.size > 0) {
      this.originLeftRefs.set(newOriginLeft, merged);
    }
  }

  /**
   * Split a multi-character record so that the `length` code units starting
   * at `offsetInRecord` become an isolated record that the caller can mark
   * as deleted. Returns that middle record. Surrounding prefix/suffix halves
   * remain undeleted so future events can still reference the original
   * region. Used for placeholder, typed-run, and multi-character paste
   * records alike — the {@link splitRecordAt} dispatch picks the right
   * shape for each side.
   */
  private splitRecordForDelete(
    position: number,
    offsetInRecord: number,
    length: number,
  ): AugmentedCRDTItem {
    if (offsetInRecord > 0) {
      const afterPrefix = this.splitRecordAt(position, offsetInRecord);
      position = afterPrefix;
    }
    const middle = this.sequence.at(position);
    if (!middle) {
      throw new Error(`Record split missing record at position ${position}`);
    }
    if (length < middle.content.length) {
      this.splitRecordAt(position, length);
    }
    return middle;
  }

  /**
   * Ensure the slice owned by `eventId` is a single record before
   * retreat / advance toggle its `prepareState`. A typed-run leaf that
   * still holds more than this one event's code unit is carved into prefix /
   * slice / suffix records via {@link splitRecordAt}, which also remaps the
   * other events' `eventItems` entries to point at the new neighbours.
   * After the call, `eventItems.get(eventId)` references exactly the slice
   * to toggle.
   */
  private isolateRunSliceForEvent(eventId: EventId): void {
    const items = this.eventItems.get(eventId);
    if (!items || items.length === 0) {
      // Event hasn't been integrated yet (e.g. a delete-only or pre-effect
      // retreat). Nothing to toggle.
      return;
    }
    if (items.length > 1) {
      // Multi-character INSERT events stay one record per code unit, each with
      // its own id and `run === null`. The retreat / advance loop already
      // toggles every slice in order; no isolation is needed.
      return;
    }
    const itemId = items[0];
    if (itemId === undefined) {
      return;
    }
    const record = this.itemsById.get(itemId);
    if (!record) {
      throw new Error(
        `eventItems pointed at unknown item ${itemId} for event ${eventId}`,
      );
    }
    if (record.run === null) {
      // Placeholder or per-code-unit paste record — nothing to coalesce, so
      // the slice is already this event's whole contribution.
      return;
    }
    const parsed = parseEventId(eventId);
    if (parsed === null || parsed.replicaId !== record.run.replicaId) {
      // A non-canonical event id ended up pointing at a typed-run record.
      // The run-extension guard in `applyInsert` only seeds runs from
      // canonical `replicaId:sequence` ids, so this should be unreachable;
      // bail out conservatively rather than splitting at a wrong offset.
      return;
    }
    const offsetInRecord = parsed.sequence - record.run.startSequence;
    if (offsetInRecord < 0 || offsetInRecord >= record.content.length) {
      // Same defensive bail-out: the eventItems entry should never point at
      // a record whose run no longer covers this event's sequence.
      return;
    }
    if (offsetInRecord === 0 && record.content.length === 1) {
      // Slice is already its own record.
      return;
    }

    let position = this.sequence.positionOf(record);
    if (position === -1) {
      throw new Error(`Record ${record.id} missing from sequence index`);
    }
    if (offsetInRecord > 0) {
      position = this.splitRecordAt(position, offsetInRecord);
    }
    const middle = this.sequence.at(position);
    if (middle && middle.content.length > 1) {
      this.splitRecordAt(position, 1);
    }
  }

  private retreat(eventId: EventId): void {
    const event = this.eventsById.get(eventId);
    if (!event) {
      return;
    }

    if (event.operation.type === OPERATION_TYPE.INSERT) {
      this.isolateRunSliceForEvent(eventId);
      for (const itemId of this.eventItems.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState -= 1;
        this.sequence.updateItem(item);
      }
    } else {
      for (const itemId of this.deleteTargets.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState -= 1;
        this.sequence.updateItem(item);
      }
    }

    this.retreatCount++;
  }

  private advance(eventId: EventId): void {
    const event = this.eventsById.get(eventId);
    if (!event) {
      return;
    }

    if (event.operation.type === OPERATION_TYPE.INSERT) {
      this.isolateRunSliceForEvent(eventId);
      for (const itemId of this.eventItems.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState += 1;
        this.sequence.updateItem(item);
      }
    } else {
      for (const itemId of this.deleteTargets.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState += 1;
        this.sequence.updateItem(item);
      }
    }

    this.advanceCount++;
  }

  private integrate(item: AugmentedCRDTItem): void {
    if (this.itemsById.has(item.id)) {
      return;
    }

    const position = this.findIntegrationPosition(item);
    this.sequence.insert(position, item);
  }

  /**
   * YATA-style integration scan (Nicolaescu et al., 2016; Yjs `Item.integrate`).
   *
   * The destination range is the slice of the sequence strictly between
   * `originLeft` and `originRight`. Walk it left-to-right and decide,
   * for each concurrent neighbour, whether the new item belongs before
   * or after it. The decision depends only on the two items' origins and
   * event IDs, never on the order in which concurrent siblings were
   * integrated, so the engine converges to the same sequence regardless
   * of which valid topological order the caller hands it.
   *
   * Two concurrent items with identical origins are ordered by
   * {@link compareEventIds}: the smaller event ID wins and is placed
   * first, matching Yjs's `id.client` tie-break.
   */
  private findIntegrationPosition(item: AugmentedCRDTItem): number {
    const leftItem = item.originLeft
      ? this.itemsById.get(item.originLeft)
      : null;
    const rightItem = item.originRight
      ? this.itemsById.get(item.originRight)
      : null;
    const leftPos = leftItem ? this.sequence.positionOf(leftItem) : -1;
    const rightPos = rightItem
      ? this.sequence.positionOf(rightItem)
      : this.sequence.length;

    let insertPos = leftPos + 1;
    let scanPos = leftPos + 1;
    const scanned = new Set<EventId>();
    let conflicting = new Set<EventId>();

    while (scanPos < rightPos) {
      const other = this.sequence.at(scanPos);
      if (!other) {
        break;
      }
      scanned.add(other.id);
      conflicting.add(other.id);

      if (other.originLeft === item.originLeft) {
        // Same left anchor: tie-break by event ID (smaller wins, goes
        // first). If `other` has a larger event ID and shares our right
        // anchor, the new item is placed immediately before it. If the
        // right anchors differ, fall through and continue scanning.
        if (compareEventIds(other.eventId, item.eventId) < 0) {
          insertPos = scanPos + 1;
          conflicting = new Set();
        } else if (other.originRight === item.originRight) {
          break;
        }
      } else if (
        other.originLeft !== null &&
        scanned.has(other.originLeft) &&
        !conflicting.has(other.originLeft)
      ) {
        // `other`'s left anchor is a record we have already accepted as
        // belonging to the left of the new item, so the new item must
        // continue past `other` too.
        insertPos = scanPos + 1;
        conflicting = new Set();
      } else if (other.originLeft === null || !scanned.has(other.originLeft)) {
        // `other`'s left anchor sits outside the conflict region (either
        // null or a record we have not passed yet), so `other` dominates
        // the remaining slice and the new item stays before it.
        break;
      }
      scanPos++;
    }

    return insertPos;
  }

  private itemToEffectIndex(target: AugmentedCRDTItem): number {
    const position = this.sequence.positionOf(target);
    if (position === -1) {
      throw new Error(`Item ${target.id} not found`);
    }
    return this.sequence.effectIndexBeforePosition(position);
  }

  private diffVersions(
    currentVersion: ReadonlySet<EventId>,
    targetVersion: ReadonlySet<EventId>,
  ): { retreat: EventId[]; advance: EventId[] } {
    const { onlyInLeft, onlyInRight } = this.graph.diffVersions(
      currentVersion,
      targetVersion,
    );

    const retreat = Array.from(onlyInLeft).sort((left, right) =>
      this.compareByTopologicalOrder(right, left),
    );
    const advance = Array.from(onlyInRight).sort((left, right) =>
      this.compareByTopologicalOrder(left, right),
    );

    return { retreat, advance };
  }

  private compareByTopologicalOrder(left: EventId, right: EventId): number {
    const leftOrder = this.eventOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = this.eventOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return compareEventIds(left, right);
  }

  private requireItem(itemId: EventId): AugmentedCRDTItem {
    const item = this.itemsById.get(itemId);
    if (!item) {
      throw new Error(`CRDT item ${itemId} not found`);
    }
    return item;
  }
}

/**
 * Coalesce a sequence of in-order effect-index deletes into the smallest list
 * of {index, length} operations that, applied in order, produces the same
 * deletes. Two consecutive deletes are contiguous when the second targets the
 * same effect index as the first (the next character shifted into the slot).
 */
const coalesceDeleteRuns = (
  effectIndexes: ReadonlyArray<number>,
): ExternalOperation[] => {
  const runs: ExternalOperation[] = [];
  let runStart = -1;
  let runLength = 0;

  for (const index of effectIndexes) {
    if (runLength === 0) {
      runStart = index;
      runLength = 1;
      continue;
    }

    if (index === runStart) {
      runLength += 1;
      continue;
    }

    runs.push({
      type: OPERATION_TYPE.DELETE,
      index: runStart,
      length: runLength,
    });
    runStart = index;
    runLength = 1;
  }

  if (runLength > 0) {
    runs.push({
      type: OPERATION_TYPE.DELETE,
      index: runStart,
      length: runLength,
    });
  }

  return runs;
};
