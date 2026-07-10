import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import { compareEventIds } from "../graph/event-id";
import type { EventId, ExternalOperation, GraphEvent } from "../types";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import { IndexedSequence } from "./indexed-sequence";
import {
  DeleteTargetIndex,
  iterateCompactDeleteTargets,
  type CompactDeleteTargetRecords,
  type DeleteTargetRecord,
} from "./internals/delete-target-index";
import {
  applyDelete,
  type DeleteHandlerDeps,
} from "./internals/delete-handler";
import {
  PLACEHOLDER_EVENT_ID,
  PLACEHOLDER_ID_PREFIX,
  type AugmentedCRDTItem,
  type EngineStats,
  type GeneratedDocument,
  type GenerateOptions,
  type IncrementalApplyResult,
} from "./internals/engine-types";
import { EventItemIndex } from "./internals/event-item-index";
import {
  applyInsert,
  type InsertHandlerDeps,
} from "./internals/insert-handler";
import { OriginLeftIndex } from "./internals/origin-left-index";
import { PendingInsertBuffer } from "./internals/pending-insert-buffer";
import { RecordSplitter } from "./internals/record-splitter";
import {
  itemsFromCompactRecords,
  itemsFromRecords,
  recordsFromItems,
  type CompactEngineSequenceRecords,
  type EngineSequenceRecord,
} from "./internals/sequence-records";

export type {
  EngineStats,
  GeneratedDocument,
  GenerateOptions,
  IncrementalApplyResult,
} from "./internals/engine-types";
export {
  recordsFromCompactDeleteTargets,
  type CompactDeleteTargetRecords,
  type DeleteTargetRecord,
} from "./internals/delete-target-index";

export interface EngineSnapshotState {
  readonly graph: EventGraph;
  readonly currentVersion: ReadonlySet<EventId>;
  readonly text: string;
  readonly textBuffer?: PersistentUtf16Rope;
  readonly sequenceRecords?: ReadonlyArray<EngineSequenceRecord>;
  readonly compactSequenceRecords?: CompactEngineSequenceRecords;
  readonly deleteTargets?: ReadonlyArray<DeleteTargetRecord>;
  readonly compactDeleteTargets?: CompactDeleteTargetRecords;
}

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
  private eventIndexesComplete = false;
  private graph = new EventGraph();
  private readonly eventItems = new EventItemIndex();
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
  private resultingText = PersistentUtf16Rope.from("");
  private retreatCount = 0;
  private advanceCount = 0;
  private nonConflictingRunCount = 0;
  private fullReplayCount = 0;
  private peakSequenceRecordCount = 0;
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

    const textBuffer = this.resultingText;
    return {
      get text(): string {
        return textBuffer.toString();
      },
      textBuffer,
      transformedOperations,
      stats: {
        retreatCount: this.retreatCount,
        advanceCount: this.advanceCount,
        eventsProcessed: events.length,
        nonConflictingRunCount: this.nonConflictingRunCount,
        fullReplayCount: this.fullReplayCount,
        sequenceRecordCount: this.itemsById.size,
        peakSequenceRecordCount: this.peakSequenceRecordCount,
      },
    };
  }

  static fromSnapshotState(state: EngineSnapshotState): EgWalkerEngine {
    const engine = new EgWalkerEngine();
    engine.restoreSnapshotState(state);
    return engine;
  }

  /**
   * Apply a single new event on top of the current engine state without
   * resetting. The caller must ensure {@link graph} is the up-to-date event
   * graph that already contains {@link event}.
   */
  applyEvent(event: GraphEvent, graph: EventGraph): IncrementalApplyResult {
    if (this.eventIndexesComplete && !this.eventsById.has(event.id)) {
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
    const textBuffer = this.resultingText;
    return {
      get text(): string {
        return textBuffer.toString();
      },
      textBuffer,
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
    return this.resultingText.toString();
  }

  getTextBuffer(): PersistentUtf16Rope {
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
      eventsProcessed: this.eventIndexesComplete
        ? this.eventsById.size
        : this.graph.getEventCount(),
      nonConflictingRunCount: this.nonConflictingRunCount,
      fullReplayCount: this.fullReplayCount,
      sequenceRecordCount: this.itemsById.size,
      peakSequenceRecordCount: this.peakSequenceRecordCount,
    };
  }

  /** Restore diagnostic counters after an exceptional replica rollback. */
  restoreStats(stats: EngineStats): void {
    this.retreatCount = stats.retreatCount;
    this.advanceCount = stats.advanceCount;
    this.nonConflictingRunCount = stats.nonConflictingRunCount;
    this.fullReplayCount = stats.fullReplayCount;
    this.peakSequenceRecordCount = stats.peakSequenceRecordCount;
  }

  getSequenceRecords(): EngineSequenceRecord[] {
    this.flushPendingInsert();
    return recordsFromItems(this.sequence.toArray());
  }

  getDeleteTargetRecords(): DeleteTargetRecord[] {
    return this.deleteTargets.entries();
  }

  private restoreSnapshotState(state: EngineSnapshotState): void {
    const items = state.compactSequenceRecords
      ? itemsFromCompactRecords(state.compactSequenceRecords)
      : itemsFromRecords(state.sequenceRecords ?? []);

    this.eventsById.clear();
    this.eventOrder.clear();
    this.eventIndexesComplete = false;
    this.graph = state.graph;
    this.eventItems.clear();
    this.deleteTargets.clear();
    this.itemsById.clear();
    this.originLeftIndex.clear();
    this.sequence.resetFromRecords(items);
    this.currentVersion = new Set(state.currentVersion);
    this.resultingText =
      state.textBuffer ?? PersistentUtf16Rope.from(state.text);
    this.pendingInsert.reset();
    this.retreatCount = 0;
    this.advanceCount = 0;
    this.nonConflictingRunCount = 0;
    this.fullReplayCount = 0;
    this.peakSequenceRecordCount = items.length;
    this.placeholderCounter = inferNextPlaceholderCounter(items);

    for (const item of items) {
      this.itemsById.set(item.id, item);
      this.originLeftIndex.track(item.id, item.originLeft);
      this.trackEventItems(item);
    }

    const deleteTargets = state.compactDeleteTargets
      ? iterateCompactDeleteTargets(state.compactDeleteTargets)
      : (state.deleteTargets ?? []);
    for (const target of deleteTargets) {
      this.deleteTargets.record(target.deleteEventId, target.targetIds);
    }
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
      this.samplePeakSequenceRecordCount();
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
    this.samplePeakSequenceRecordCount();
    return transformed;
  }

  /**
   * Update the high-water mark for {@link sequenceRecordCount}. Sampling
   * after each `apply` (and after the initial-text placeholder seed in
   * `reset`) is sufficient: every record creation goes through `apply` or
   * the placeholder seed path, and the post-apply sample captures any
   * mid-apply growth that splits/inserts produced.
   */
  private samplePeakSequenceRecordCount(): void {
    const live = this.itemsById.size;
    if (live > this.peakSequenceRecordCount) {
      this.peakSequenceRecordCount = live;
    }
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
    this.eventIndexesComplete = false;
    this.graph = options.eventGraph ?? new EventGraph();
    this.eventItems.clear();
    this.deleteTargets.clear();
    this.itemsById.clear();
    this.originLeftIndex.clear();
    this.sequence.clear();
    this.currentVersion = new Set(options.initialVersion ?? []);
    this.resultingText =
      options.initialTextBuffer ?? PersistentUtf16Rope.from(initialText);
    this.pendingInsert.reset();
    this.retreatCount = 0;
    this.advanceCount = 0;
    this.nonConflictingRunCount = 0;
    this.fullReplayCount = 0;
    this.peakSequenceRecordCount = 0;
    this.placeholderCounter = 0;

    const graphEvents =
      options.eventOrder ?? options.eventGraph?.getTopologicalOrder() ?? events;
    graphEvents.forEach((event, index) => {
      this.eventsById.set(event.id, event);
      this.eventOrder.set(event.id, index);
      if (!options.eventGraph) {
        this.graph.addEvent(event);
      }
    });
    this.eventIndexesComplete = true;

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
    this.samplePeakSequenceRecordCount();
  }

  private nextPlaceholderId(): EventId {
    return `${PLACEHOLDER_ID_PREFIX}${this.placeholderCounter++}`;
  }

  private trackEventItems(item: AugmentedCRDTItem): void {
    if (item.run !== null) {
      this.eventItems.registerRunItem(item);
      return;
    }

    if (item.eventId !== PLACEHOLDER_EVENT_ID) {
      this.eventItems.add(item.eventId, item.id);
    }
  }

  private apply(event: GraphEvent): ExternalOperation[] {
    const operation = event.operation;

    if (operation.type === OPERATION_TYPE.INSERT) {
      return applyInsert(event, operation, this.insertDeps);
    }

    return applyDelete(event, operation, this.deleteDeps);
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
    this.resultingText = this.resultingText.insert(effectIndex, text);
  };

  // Built once per engine instance so {@link processEvent} doesn't allocate a
  // fresh deps object plus a handful of arrow closures on every applied event.
  // The captured references (sequence, itemsById, etc.) are stable for the
  // lifetime of the engine; mutations happen through the references, not by
  // swapping them out, so a one-shot snapshot at construction is sound.
  private readonly insertDeps: InsertHandlerDeps = {
    sequence: this.sequence,
    itemsById: this.itemsById,
    eventItems: this.eventItems,
    originLeftIndex: this.originLeftIndex,
    recordSplitter: this.recordSplitter,
    pendingInsert: this.pendingInsert,
    applyPendingSplice: this.applyPendingSplice,
    flushPendingInsert: () => this.flushPendingInsert(),
    itemToEffectIndex: (target) => this.itemToEffectIndex(target),
    requireItem: (itemId) => this.requireItem(itemId),
    insertText: (index, text) => {
      this.resultingText = this.resultingText.insert(index, text);
    },
  };

  private readonly deleteDeps: DeleteHandlerDeps = {
    sequence: this.sequence,
    deleteTargets: this.deleteTargets,
    recordSplitter: this.recordSplitter,
    pendingInsert: this.pendingInsert,
    flushPendingInsert: () => this.flushPendingInsert(),
    itemToEffectIndex: (target) => this.itemToEffectIndex(target),
    deleteText: (index, length) => {
      this.resultingText = this.resultingText.delete(index, length);
    },
  };

  private flushPendingInsert(): void {
    this.pendingInsert.flush(this.applyPendingSplice);
  }

  private diffVersions(
    currentVersion: ReadonlySet<EventId>,
    targetVersion: ReadonlySet<EventId>,
  ): { retreat: EventId[]; advance: EventId[] } {
    this.ensureEventIndexes();
    const { onlyInLeft, onlyInRight } = this.graph.diffVersions(
      currentVersion,
      targetVersion,
    );

    return {
      retreat: this.sortByEventOrder(onlyInLeft, true),
      advance: this.sortByEventOrder(onlyInRight, false),
    };
  }

  // Pre-materialise the topological rank per id so the sort comparator
  // doesn't pay two `eventOrder.get()` calls per comparison. When two ids
  // share a rank (unknown ids both default to MAX_SAFE_INTEGER), fall back
  // to {@link compareEventIds} for a stable lex tiebreak.
  private sortByEventOrder(
    ids: Iterable<EventId>,
    descending: boolean,
  ): EventId[] {
    const ranked = Array.from(ids, (id) => ({
      id,
      order: this.eventOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
    }));
    ranked.sort((left, right) => {
      if (left.order !== right.order) {
        return descending ? right.order - left.order : left.order - right.order;
      }
      return descending
        ? compareEventIds(right.id, left.id)
        : compareEventIds(left.id, right.id);
    });
    return ranked.map(({ id }) => id);
  }

  private ensureEventIndexes(): void {
    if (this.eventIndexesComplete) {
      return;
    }
    this.eventsById.clear();
    this.eventOrder.clear();
    this.graph.getTopologicalOrder().forEach((event, index) => {
      this.eventsById.set(event.id, event);
      this.eventOrder.set(event.id, index);
    });
    this.eventIndexesComplete = true;
  }

  private requireItem(itemId: EventId): AugmentedCRDTItem {
    const item = this.itemsById.get(itemId);
    if (!item) {
      throw new Error(`CRDT item ${itemId} not found`);
    }
    return item;
  }
}

const inferNextPlaceholderCounter = (
  items: ReadonlyArray<AugmentedCRDTItem>,
): number => {
  let next = 0;
  for (const item of items) {
    if (!item.id.startsWith(PLACEHOLDER_ID_PREFIX)) {
      continue;
    }
    const suffix = Number(item.id.slice(PLACEHOLDER_ID_PREFIX.length));
    if (Number.isInteger(suffix) && suffix >= next) {
      next = suffix + 1;
    }
  }
  return next;
};
