import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import { compareEventIds, parseEventId } from "../graph/event-id";
import type { EventId, ExternalOperation, GraphEvent } from "../types";
import { IndexedSequence } from "./indexed-sequence";
import { DeleteTargetIndex } from "./internals/delete-target-index";
import {
  PLACEHOLDER_EVENT_ID,
  PLACEHOLDER_ID_PREFIX,
  type AugmentedCRDTItem,
  type EngineStats,
  type GeneratedDocument,
  type GenerateOptions,
  type IncrementalApplyResult,
  type TypedRun,
} from "./internals/engine-types";
import { OriginLeftIndex } from "./internals/origin-left-index";
import { PendingInsertBuffer } from "./internals/pending-insert-buffer";
import { RecordSplitter } from "./internals/record-splitter";
import {
  coalesceDeleteRuns,
  deleteText,
  spliceText,
  stringCodeUnits,
} from "./internals/text-utils";
import { findIntegrationPosition } from "./internals/yata-integration";

export type {
  EngineStats,
  GeneratedDocument,
  GenerateOptions,
  IncrementalApplyResult,
} from "./internals/engine-types";

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
  private readonly itemsById = new Map<EventId, AugmentedCRDTItem>();
  private readonly originLeftIndex = new OriginLeftIndex();
  private readonly deleteTargets = new DeleteTargetIndex();
  private readonly sequence = new IndexedSequence<AugmentedCRDTItem>(
    (item) => (item.prepareState === 1 ? item.content.length : 0),
    (item) => (item.everDeleted ? 0 : item.content.length),
  );
  private readonly recordSplitter = new RecordSplitter({
    sequence: this.sequence,
    itemsById: this.itemsById,
    eventItems: this.eventItems,
    originLeftIndex: this.originLeftIndex,
    deleteTargets: this.deleteTargets,
    nextPlaceholderId: () => this.nextPlaceholderId(),
  });
  private readonly pendingInsert = new PendingInsertBuffer();
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

    // The typed-run coalescing path may have left an open buffer of
    // appended text. The returned document is observable, so materialise
    // it before handing back the snapshot. This is the load-bearing flush
    // for batch (non-incremental) callers of `generate`; the per-event
    // `applyEvent` return flush below is what `EgWalkerReplica` relies on.
    this.flushPendingInsert();

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
    // {@link EgWalkerReplica.applyRemoteEvent} reads the returned `text`
    // (and then `getText()`) immediately after this call, so the
    // incremental return value must reflect the post-event document. This
    // is the load-bearing flush for the incremental path; a subsequent
    // `getText` call will see an empty buffer and short-circuit on the
    // function's internal early-out.
    this.flushPendingInsert();
    return {
      text: this.resultingText,
      transformedOperations: transformed,
    };
  }

  getText(): string {
    // Materialise any deferred typed-run appends before exposing the
    // text. Most callers (`EgWalkerReplica`) read `getText` immediately
    // after `applyEvent`, which has already flushed, so the function's
    // internal early-out keeps this branch effectively free in the
    // incremental hot path. The flush is load-bearing for direct callers
    // that drive `apply*` themselves without going through `applyEvent`
    // (tests, serializers, ad-hoc inspection between `generate` calls).
    this.flushPendingInsert();
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
    this.itemsById.clear();
    this.originLeftIndex.clear();
    this.sequence.clear();
    this.currentVersion = new Set(options.initialVersion ?? []);
    this.resultingText = initialText;
    this.pendingInsert.reset();
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
        ? this.recordSplitter.splitRecordAt(
            landing.position,
            landing.offsetInRecord,
          )
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
    // ordering unchanged — split-on-demand carves the run when a
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
        // boundary — those items chose this id as their `originLeft` at a
        // moment when the record ended one code unit earlier, and stretching
        // the content would shift the boundary they were anchored to.
        !this.originLeftIndex.has(leftRecord.id)
      ) {
        const effectIndex =
          this.itemToEffectIndex(leftRecord) + leftRecord.content.length;
        leftRecord.content += operation.text;
        this.sequence.updateItem(leftRecord);
        this.eventItems.set(event.id, [leftRecord.id]);
        // Defer the splice on {@link resultingText} into the
        // pending-insert buffer so a long single-author typed run doesn't
        // pay an O(document length) string realloc per keystroke.
        // {@link flushPendingInsert} materialises the buffer before any
        // non-coalesced read or write of the document text.
        this.pendingInsert.append(
          effectIndex,
          operation.text,
          this.applyPendingSplice,
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
      actualFirstPosition = findIntegrationPosition(
        firstItem,
        this.sequence,
        this.itemsById,
      );
      this.sequence.insert(actualFirstPosition, firstItem);
    }
    this.itemsById.set(firstItem.id, firstItem);
    this.originLeftIndex.track(firstItem.id, firstItem.originLeft);
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
      this.originLeftIndex.track(item.id, item.originLeft);
      insertedIds.push(item.id);
      left = item.id;
    }

    this.eventItems.set(event.id, insertedIds);

    const firstInserted = this.requireItem(insertedIds[0] ?? event.id);
    const effectIndex = this.itemToEffectIndex(firstInserted);
    // A non-coalesced insert (multi-character event, new typed-run seed,
    // or non-empty conflict region) must observe the current document so
    // {@link effectIndex} aligns with {@link resultingText}. Drain any
    // open typed-run buffer before splicing. Hoist the empty-buffer check
    // inline because this is the per-event hot path for non-coalescing
    // inserts and the buffer is empty on every full-replay event.
    if (!this.pendingInsert.isEmpty()) {
      this.flushPendingInsert();
    }
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
    // Any concurrent insert or delete breaks the typed-run we may have
    // been coalescing into the pending-insert buffer. Flush before we
    // start carving records and slicing the document text so the per-slot
    // {@link effectIndex} arithmetic below operates on the materialised
    // document. Hoist the empty-buffer check inline because `applyDelete`
    // is on the per-event hot path and the buffer is empty on every
    // non-coalescing trace, so the inline check saves a function call on
    // the common case.
    if (!this.pendingInsert.isEmpty()) {
      this.flushPendingInsert();
    }
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
        (candidate.eventId === PLACEHOLDER_EVENT_ID ||
          candidate.run !== null) &&
        candidate.content.length > 1;
      if (isMultiCharRecord) {
        const availableInRecord =
          candidate.content.length - landing.offsetInRecord;
        const toDelete = Math.min(remaining, availableInRecord);
        const middle = this.recordSplitter.splitRecordForDelete(
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

    this.deleteTargets.record(event.id, deletedItemIds);

    return coalesceDeleteRuns(outputDeleteIndexes);
  }

  private retreat(eventId: EventId): void {
    const event = this.eventsById.get(eventId);
    if (!event) {
      return;
    }

    if (event.operation.type === OPERATION_TYPE.INSERT) {
      this.recordSplitter.isolateRunSliceForEvent(eventId);
      for (const itemId of this.eventItems.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState -= 1;
        this.sequence.updateItem(item);
      }
    } else {
      for (const itemId of this.deleteTargets.targetsOf(eventId) ?? []) {
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
      this.recordSplitter.isolateRunSliceForEvent(eventId);
      for (const itemId of this.eventItems.get(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState += 1;
        this.sequence.updateItem(item);
      }
    } else {
      for (const itemId of this.deleteTargets.targetsOf(eventId) ?? []) {
        const item = this.requireItem(itemId);
        item.prepareState += 1;
        this.sequence.updateItem(item);
      }
    }

    this.advanceCount++;
  }

  private itemToEffectIndex(target: AugmentedCRDTItem): number {
    const position = this.sequence.positionOf(target);
    if (position === -1) {
      throw new Error(`Item ${target.id} not found`);
    }
    return this.sequence.effectIndexBeforePosition(position);
  }

  /**
   * Splice the deferred typed-run span into {@link resultingText}.
   *
   * Arrow-field instead of a method so the buffer can store the
   * reference once and call back into the engine without `this`
   * rebinding. The buffer is the only caller — never invoke this
   * directly; go through {@link flushPendingInsert} (or pass it to
   * {@link PendingInsertBuffer.append}) so the buffer first clears its
   * own state and we don't double-apply on a reentrant flush.
   */
  private readonly applyPendingSplice = (
    effectIndex: number,
    text: string,
  ): void => {
    this.resultingText = spliceText(this.resultingText, effectIndex, text);
  };

  private flushPendingInsert(): void {
    this.pendingInsert.flush(this.applyPendingSplice);
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
