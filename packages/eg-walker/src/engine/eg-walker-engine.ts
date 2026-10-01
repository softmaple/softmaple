import { OPERATION_TYPE } from "../constants/operation-types";
import { EventGraph } from "../graph/event-graph";
import { compareEventIds } from "../graph/event-id";
import type { PackedLocalVersionTransition } from "../graph/internals/packed-diff-versions";
import type { LocalVersionTransition } from "../graph/internals/ranked-diff-versions";
import { runSteps, type Steps } from "../graph/internals/steps";
import type { EventId, ExternalOperation, GraphEvent, Version } from "../types";
import {
  containsUtf16SurrogateCodeUnit,
  PersistentUtf16Rope,
} from "../text/persistent-utf16-rope";
import { IndexedSequence } from "./indexed-sequence";
import {
  DELETE_TARGET_KIND,
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
  CUSTOM_EVENT_AGENT,
  formatPlaceholderId,
  ItemTable,
  PLACEHOLDER_AGENT,
  PLACEHOLDER_EVENT_ID,
  placeholderSerialOf,
  type AugmentedCRDTItem,
  type EngineStats,
  type GeneratedDocument,
  type GenerateOptions,
  type IncrementalApplyResult,
  type ItemKey,
} from "./internals/engine-types";
import { EventItemIndex } from "./internals/event-item-index";
import { FugueOrderIndex } from "./internals/fugue-order-index";
import {
  applyTypedRunExtension,
  applyInsert,
  canExtendTypedRun,
  type InsertHandlerDeps,
  type InsertTailResult,
} from "./internals/insert-handler";
import { OriginLeftIndex } from "./internals/origin-left-index";
import { PendingInsertBuffer } from "./internals/pending-insert-buffer";
import {
  materializeRecordContent,
  recordContentHasSurrogateCodeUnits,
  RopeRecordContent,
} from "./internals/record-content";
import { RecordSplitter } from "./internals/record-splitter";
import { SegmentedPlaceholderState } from "./internals/segmented-placeholder";
import {
  ItemIdCodec,
  recordsFromCompactRecords,
  type CompactEngineSequenceRecords,
  type EngineSequenceRecord,
  type EventIdSource,
} from "./internals/sequence-records";
import type { PackedCriticalReplayPlan } from "./packed-critical-replay-plan";

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

export interface EngineRecoveryState {
  readonly currentVersion: Version;
  readonly textBuffer: PersistentUtf16Rope;
  readonly sequenceRecords: ReadonlyArray<EngineSequenceRecord>;
  readonly deleteTargets: ReadonlyArray<DeleteTargetRecord>;
  readonly eventOrder: ReadonlyArray<EventId>;
  readonly eventIndexesComplete: boolean;
  readonly stats: EngineStats;
}

// For a checkpoint-seeded replay, one or two eager persistent-rope splices
// retain more structure than rebuilding the result from sequence records.
// Once the divergent suffix is large enough, avoiding its per-event effect
// rank lookup and rope edit dominates the shallow final rope rebuild.
const DEFERRED_CHECKPOINT_TEXT_MIN_EVENTS = 64;

/** Where a chunked packed range replay resumes. */
interface PackedRangeCursor {
  orderIndex: number;
  /** Offset of the last replayed event, or `null` before the first one. */
  currentOffset: number | null;
}

/** Whether two versions given as local versions hold the same events. */
const localVersionsEqual = (
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>,
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  if (left.length === 1) {
    return left[0] === right[0];
  }
  for (const localVersion of left) {
    if (!right.includes(localVersion)) {
      return false;
    }
  }
  return true;
};

/**
 * Direct implementation of the Eg-walker replay algorithm from Appendix B.
 *
 * The event graph and plain document text remain persistent state. This class is
 * temporary replay state: it creates augmented CRDT records with prepare-state
 * and effect-state, walks causal history, and then can be discarded.
 */
export class EgWalkerEngine {
  /** Replay order of each event this engine replays, by local version. */
  private readonly eventOrder = new Map<number, number>();
  private readonly eventsByOrder: number[] = [];
  private eventIndexesComplete = false;
  private processedEventCount = 0;
  private graph = new EventGraph();
  private readonly eventIdentity = {
    agentAt: (localVersion: number): number => this.graph.agentAt(localVersion),
    sequenceAt: (localVersion: number): number =>
      this.graph.sequenceAt(localVersion),
  };
  private readonly eventIdSource: EventIdSource = {
    agentTable: () => this.graph.agentTable,
    localVersionOf: (id) => this.graph.localVersionOf(id),
    idAtLocalVersion: (localVersion) =>
      this.graph.idAtLocalVersion(localVersion),
  };
  private readonly codec = new ItemIdCodec(this.eventIdSource);
  private readonly eventItems = new EventItemIndex(this.eventIdentity);
  private readonly items = new ItemTable();
  private readonly originLeftIndex = new OriginLeftIndex();
  private readonly deleteTargets = new DeleteTargetIndex();
  private readonly segmentedPlaceholders = new Set<
    SegmentedPlaceholderState<AugmentedCRDTItem>
  >();
  private readonly sequence = new IndexedSequence<AugmentedCRDTItem>(
    (item) =>
      item.placeholder?.prepareLength ??
      (item.prepareState === 1 ? item.content.length : 0),
    (item) =>
      item.placeholder?.effectLength ??
      (item.everDeleted ? 0 : item.content.length),
    [],
    (item) =>
      item.placeholder === undefined ? (item.prepareState === 0 ? 0 : 1) : 1,
    true,
    (item, visibleOffset, kind) =>
      kind === "prepare" && item.placeholder !== undefined
        ? item.placeholder.state.contentOffsetAtPrepareRank(
            item.placeholder,
            visibleOffset,
          )
        : visibleOffset,
  );
  private readonly fugueOrder = new FugueOrderIndex(
    this.sequence,
    (itemId) => this.items.at(itemId),
    (item) => this.codec.eventIdOf(item),
  );
  private readonly recordSplitter = new RecordSplitter({
    sequence: this.sequence,
    items: this.items,
    events: this.eventIdentity,
    eventItems: this.eventItems,
    originLeftIndex: this.originLeftIndex,
    deleteTargets: this.deleteTargets,
    nextPlaceholderSerial: () => this.placeholderCounter++,
    onRecordSplit: (left, right) => {
      if (!this.useLinearIntegrationOracle) {
        this.fugueOrder.handleRecordSplit(left, right);
      }
    },
  });
  private readonly pendingInsert = new PendingInsertBuffer();
  /** The engine's current version, as local versions. */
  private currentVersion: number[] = [];
  private resultingText = PersistentUtf16Rope.from("");
  private retreatCount = 0;
  private advanceCount = 0;
  private nonConflictingRunCount = 0;
  private fullReplayCount = 0;
  private peakSequenceRecordCount = 0;
  private placeholderCounter = 0;
  private integrationProbeCount = 0;
  private useLinearIntegrationOracle = false;
  private prepareViewMayContainSurrogatePairs = false;
  private deferTextMaterialization = false;
  private packedReplayPlan: PackedCriticalReplayPlan | null = null;
  private objectInsertTail: AugmentedCRDTItem | null = null;
  private objectInsertNextPrepareIndex = -1;
  private readonly objectInsertTailResult: InsertTailResult = { item: null };
  private packedInsertTail: AugmentedCRDTItem | null = null;
  private packedInsertNextPrepareIndex = -1;
  private readonly packedInsertTailResult: InsertTailResult = { item: null };
  private readonly prepareDeltas = new Map<AugmentedCRDTItem, number>();

  generate(
    events: ReadonlyArray<GraphEvent>,
    initialText: string = "",
    options: GenerateOptions = {},
  ): GeneratedDocument {
    this.reset(events, initialText, options);
    const graph = this.graph;
    const localVersions = events.map((event) =>
      this.requireLocalVersion(event.id),
    );
    return this.runGeneration(
      localVersions,
      (index) => events[index]!.operation,
      options,
      graph,
    );
  }

  private runGeneration(
    localVersions: ReadonlyArray<number>,
    operationAt: (index: number) => ExternalOperation,
    options: GenerateOptions,
    graph: EventGraph,
  ): GeneratedDocument {
    const collectTransformedOperations =
      options.collectTransformedOperations !== false;
    // Empty-seed cold replay always benefits from a single final materialize.
    // Checkpoint replay uses the same path only for a sufficiently large
    // divergent suffix; tiny suffixes retain more branch structure through
    // eager splices than they save in effect-rank lookups.
    this.deferTextMaterialization =
      !collectTransformedOperations &&
      (this.resultingText.length === 0 ||
        localVersions.length >= DEFERRED_CHECKPOINT_TEXT_MIN_EVENTS);
    if (this.deferTextMaterialization) {
      this.enableSegmentedPlaceholder();
    }
    const transformedOperations: ExternalOperation[] | undefined =
      collectTransformedOperations ? [] : undefined;

    let eventIndex = 0;
    while (eventIndex < localVersions.length) {
      const localVersion = localVersions[eventIndex]!;
      const transformed = this.processEvent(
        localVersion,
        operationAt(eventIndex),
        collectTransformedOperations,
      );
      transformedOperations?.push(...transformed);
      eventIndex++;

      if (
        !collectTransformedOperations &&
        options.integrationMode !== "linear-oracle"
      ) {
        eventIndex = this.extendObjectInsertRun(
          localVersions,
          operationAt,
          eventIndex,
          localVersion,
          graph,
        );
      }
    }

    return this.finishGeneration(transformedOperations);
  }

  /** Replay one packed nonlinear range without materialising GraphEvents. */
  generatePackedSectionRange(
    plan: PackedCriticalReplayPlan,
    startSectionIndex: number,
    endSectionIndex: number,
    graph: EventGraph,
    initialVersion: ReadonlySet<EventId>,
    initialTextBuffer: PersistentUtf16Rope,
  ): GeneratedDocument {
    return runSteps(
      this.generatePackedSectionRangeSteps(
        plan,
        startSectionIndex,
        endSectionIndex,
        graph,
        initialVersion,
        initialTextBuffer,
        Number.POSITIVE_INFINITY,
      ),
    );
  }

  /**
   * {@link generatePackedSectionRange} in steps, for a caller that must pause
   * between them. The generator yields after each chunk of about
   * `chunkEvents` events and returns the generated document. A chunk ends
   * only between the events the unchunked loop visits, and a run of typed
   * events can carry it past `chunkEvents`, so the replayed state does not
   * depend on the chunk size. The engine must not be used for anything else
   * until the generator returns.
   */
  *generatePackedSectionRangeSteps(
    plan: PackedCriticalReplayPlan,
    startSectionIndex: number,
    endSectionIndex: number,
    graph: EventGraph,
    initialVersion: ReadonlySet<EventId>,
    initialTextBuffer: PersistentUtf16Rope,
    chunkEvents: number,
  ): Steps<GeneratedDocument> {
    if (!(chunkEvents >= 1)) {
      throw new RangeError(
        `Packed replay chunk size must be at least one event, got ${chunkEvents}`,
      );
    }
    const startOrderIndex = plan.sectionStartAt(startSectionIndex);
    const endOrderIndex = plan.sectionEndAt(endSectionIndex - 1);
    const eventCount = endOrderIndex - startOrderIndex;
    this.resetState("", {
      initialVersion,
      initialTextBuffer,
      eventGraph: graph,
      collectTransformedOperations: false,
    });
    this.packedReplayPlan = plan;
    this.deleteTargets.configurePackedOrderRange(
      startOrderIndex,
      endOrderIndex,
    );
    this.deferTextMaterialization =
      this.resultingText.length === 0 ||
      eventCount >= DEFERRED_CHECKPOINT_TEXT_MIN_EVENTS;
    if (this.deferTextMaterialization) {
      this.enableSegmentedPlaceholder();
    }

    const cursor: PackedRangeCursor = {
      orderIndex: startOrderIndex,
      currentOffset: null,
    };
    while (true) {
      this.replayPackedOrderRange(
        plan,
        cursor,
        startOrderIndex,
        endOrderIndex,
        Math.min(endOrderIndex, cursor.orderIndex + chunkEvents),
      );
      if (cursor.orderIndex >= endOrderIndex) {
        break;
      }
      yield;
    }

    if (cursor.currentOffset !== null) {
      this.currentVersion = [cursor.currentOffset];
    }
    return this.finishGeneration(undefined);
  }

  /**
   * Replay packed events from `cursor.orderIndex` until it reaches
   * `chunkEndOrderIndex`. A run extension stops only at `endOrderIndex`, the
   * end of the whole range, so splitting a range into chunks replays exactly
   * the events, in the order, that one call over the range would.
   */
  private replayPackedOrderRange(
    plan: PackedCriticalReplayPlan,
    cursor: PackedRangeCursor,
    startOrderIndex: number,
    endOrderIndex: number,
    chunkEndOrderIndex: number,
  ): void {
    let currentOffset = cursor.currentOffset;
    let orderIndex = cursor.orderIndex;
    while (orderIndex < chunkEndOrderIndex) {
      const eventOffset = plan.eventOffsetAt(orderIndex);
      currentOffset = this.processPackedEvent(
        plan,
        eventOffset,
        startOrderIndex,
        endOrderIndex,
        currentOffset,
      );
      orderIndex++;

      const extendedEnd = this.extendPackedInsertRun(
        plan,
        orderIndex,
        endOrderIndex,
        currentOffset,
      );
      if (extendedEnd !== orderIndex) {
        orderIndex = extendedEnd;
        currentOffset = plan.eventOffsetAt(orderIndex - 1);
        continue;
      }

      const deletedEnd = this.extendPackedScalarDeleteRun(
        plan,
        orderIndex,
        endOrderIndex,
        currentOffset,
      );
      if (deletedEnd !== orderIndex) {
        orderIndex = deletedEnd;
        currentOffset = plan.eventOffsetAt(orderIndex - 1);
      }
    }
    cursor.orderIndex = orderIndex;
    cursor.currentOffset = currentOffset;
  }

  /** Build only the bounded ID rank needed if this packed engine is retained. */
  preparePackedRetention(
    plan: PackedCriticalReplayPlan,
    startSectionIndex: number,
    endSectionIndex: number,
  ): void {
    const start = plan.sectionStartAt(startSectionIndex);
    const end = plan.sectionEndAt(endSectionIndex - 1);
    const materializeDeleteKeys = this.deleteTargets.hasPackedOrderRange();
    this.eventOrder.clear();
    this.eventsByOrder.length = 0;
    for (let orderIndex = start; orderIndex < end; orderIndex++) {
      // Packed offsets are the graph's local versions.
      const eventOffset = plan.eventOffsetAt(orderIndex);
      if (materializeDeleteKeys) {
        this.deleteTargets.materializePackedRecord(orderIndex, eventOffset);
      }
      this.eventOrder.set(eventOffset, orderIndex - start);
      this.eventsByOrder.push(eventOffset);
    }
    if (materializeDeleteKeys) {
      if (this.deleteTargets.hasPackedRecords()) {
        throw new Error(
          "Packed retention did not materialize every delete key",
        );
      }
      this.deleteTargets.releasePackedOrderRange();
    }
    this.packedReplayPlan = null;
    this.eventIndexesComplete = true;
  }

  private finishGeneration(
    transformedOperations: ExternalOperation[] | undefined,
  ): GeneratedDocument {
    if (!this.deferTextMaterialization) {
      // The typed-run coalescing path may have left an open buffer of
      // appended text. The returned document is observable, so materialise
      // it before handing back the snapshot. This is the load-bearing flush
      // for batch (non-incremental) callers of `generate`; the per-event
      // `applyEvent` return flush below is what `EgWalkerReplica` relies on.
      this.flushPendingInsert();
    } else {
      // Cold replay does not expose intermediate transformed operations.
      // Insert/delete handlers therefore maintain only the authoritative
      // effect weights and skip every historical effect-rank lookup and rope
      // edit. Build the observable document once from the final sequence.
      this.resultingText = this.materializeEffectVisibleText();
      this.deferTextMaterialization = false;
    }

    const textBuffer = this.resultingText;
    const fugueStats = this.fugueOrder.getStats();
    return {
      get text(): string {
        return textBuffer.toString();
      },
      textBuffer,
      transformedOperations: transformedOperations ?? [],
      stats: {
        retreatCount: this.retreatCount,
        advanceCount: this.advanceCount,
        eventsProcessed: this.processedEventCount,
        nonConflictingRunCount: this.nonConflictingRunCount,
        fullReplayCount: this.fullReplayCount,
        sequenceRecordCount: this.items.size,
        peakSequenceRecordCount: this.peakSequenceRecordCount,
        integrationProbeCount: this.integrationProbeCount,
        fugueComparisons: fugueStats.comparisons,
        fugueMarkerOperations: fugueStats.markerOperations,
        fugueRotations: fugueStats.rotations,
        fugueRebuilds: fugueStats.rebuilds,
        sequenceTreeOperations:
          this.sequence.getStructuralOperationCount() +
          fugueStats.markerTreeOperations +
          this.segmentedPlaceholderStructuralOperationCount(),
      },
    };
  }

  static fromSnapshotState(state: EngineSnapshotState): EgWalkerEngine {
    const engine = new EgWalkerEngine();
    engine.restoreSnapshotState(state);
    return engine;
  }

  static fromRecoveryState(
    state: EngineRecoveryState,
    graph: EventGraph,
  ): EgWalkerEngine {
    const engine = new EgWalkerEngine();
    engine.restoreSnapshotState({
      graph,
      currentVersion: state.currentVersion,
      text: "",
      textBuffer: state.textBuffer,
      sequenceRecords: state.sequenceRecords,
      deleteTargets: state.deleteTargets,
    });
    engine.eventOrder.clear();
    engine.eventsByOrder.length = 0;
    state.eventOrder.forEach((eventId, index) => {
      const localVersion = graph.localVersionOf(eventId);
      if (localVersion < 0) {
        throw new Error(`Recovery state references missing event ${eventId}`);
      }
      engine.eventOrder.set(localVersion, index);
      engine.eventsByOrder.push(localVersion);
    });
    engine.eventIndexesComplete = state.eventIndexesComplete;
    engine.restoreStats(state.stats);
    return engine;
  }

  /**
   * Apply a single new event on top of the current engine state without
   * resetting. The caller must ensure {@link graph} is the up-to-date event
   * graph that already contains {@link event}.
   */
  applyEvent(event: GraphEvent, graph: EventGraph): IncrementalApplyResult {
    this.prepareIncrementalGraph(graph);
    const localVersion = this.requireLocalVersion(event.id);
    this.registerIncrementalEvent(localVersion);
    const transformed = this.processEvent(localVersion, event.operation, true);
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

  /** @internal Apply an owned receive transaction without per-event text flushes. */
  applyEventBatch(
    events: ReadonlyArray<GraphEvent>,
    graph: EventGraph,
  ): PersistentUtf16Rope {
    this.prepareIncrementalGraph(graph);
    for (const event of events) {
      const localVersion = this.requireLocalVersion(event.id);
      this.registerIncrementalEvent(localVersion);
      this.processEvent(localVersion, event.operation, false);
    }
    this.flushPendingInsert();
    return this.resultingText;
  }

  private prepareIncrementalGraph(graph: EventGraph): void {
    this.materializePackedDeleteTargets();
    this.graph = graph;
  }

  private registerIncrementalEvent(localVersion: number): void {
    if (this.eventIndexesComplete && !this.eventOrder.has(localVersion)) {
      const order = this.eventOrder.size;
      this.eventOrder.set(localVersion, order);
      this.eventsByOrder.push(localVersion);
    }
  }

  private requireLocalVersion(eventId: EventId): number {
    const localVersion = this.graph.localVersionOf(eventId);
    if (localVersion < 0) {
      throw new Error(`Event ${eventId} is not in the replay graph`);
    }
    return localVersion;
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
    return new Set(
      this.currentVersion.map((localVersion) =>
        this.graph.idAtLocalVersion(localVersion),
      ),
    );
  }

  /** Move the transient prepare view without applying a new event. */
  transitionPrepareView(version: Version, graph: EventGraph): void {
    this.materializePackedDeleteTargets();
    this.flushPendingInsert();
    this.graph = graph;
    const target = this.localVersionsOf(version);
    const { retreat, advance } = this.diffVersions(this.currentVersion, target);
    this.applyObjectPrepareTransition(retreat, advance);
    this.currentVersion = target;
  }

  /** Local versions of a version's events; events not in the graph drop. */
  private localVersionsOf(version: Iterable<EventId>): number[] {
    const localVersions: number[] = [];
    for (const eventId of version) {
      const localVersion = this.graph.localVersionOf(eventId);
      if (localVersion >= 0 && !localVersions.includes(localVersion)) {
        localVersions.push(localVersion);
      }
    }
    return localVersions;
  }

  getPrepareLength(): number {
    return this.sequence.prepareLength;
  }

  getPrepareCodeUnitAt(index: number): number | undefined {
    const landing = this.sequence.tryPrepareIndexToPositionAndOffset(
      index,
      false,
    );
    if (landing === undefined) {
      return undefined;
    }
    return this.sequence
      .at(landing.position)
      ?.content.charCodeAt(landing.offsetInRecord);
  }

  getPrepareSlice(start: number, end: number): string {
    const prepareLength = this.sequence.prepareLength;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > prepareLength
    ) {
      throw new Error(
        `Invalid prepare slice [${start}, ${end}) for length ${prepareLength}`,
      );
    }

    const parts: string[] = [];
    let index = start;
    while (index < end) {
      const landing = this.sequence.prepareIndexToPositionAndOffset(
        index,
        false,
      );
      const item = this.sequence.at(landing.position);
      if (item === undefined) {
        throw new Error(`Missing prepare record at index ${index}`);
      }
      const placeholder = item.placeholder;
      if (placeholder !== undefined) {
        const ranges = placeholder.state.collectPrepareVisibleRanges(
          placeholder.start + landing.offsetInRecord,
          placeholder.end,
          end - index,
        );
        let visibleLength = 0;
        for (const range of ranges) {
          const localStart = range.start - placeholder.start;
          const localEnd = range.end - placeholder.start;
          parts.push(
            materializeRecordContent(item.content, localStart, localEnd),
          );
          visibleLength += localEnd - localStart;
        }
        if (visibleLength === 0) {
          throw new Error(
            `Segmented prepare record ${item.id} exposed no text at index ${index}`,
          );
        }
        index += visibleLength;
        continue;
      }

      const length = Math.min(
        end - index,
        item.content.length - landing.offsetInRecord,
      );
      parts.push(
        materializeRecordContent(
          item.content,
          landing.offsetInRecord,
          landing.offsetInRecord + length,
        ),
      );
      index += length;
    }
    return parts.join("");
  }

  getStats(): EngineStats {
    const fugueStats = this.fugueOrder.getStats();
    return {
      retreatCount: this.retreatCount,
      advanceCount: this.advanceCount,
      eventsProcessed: this.processedEventCount,
      nonConflictingRunCount: this.nonConflictingRunCount,
      fullReplayCount: this.fullReplayCount,
      sequenceRecordCount: this.items.size,
      peakSequenceRecordCount: this.peakSequenceRecordCount,
      integrationProbeCount: this.integrationProbeCount,
      fugueComparisons: fugueStats.comparisons,
      fugueMarkerOperations: fugueStats.markerOperations,
      fugueRotations: fugueStats.rotations,
      fugueRebuilds: fugueStats.rebuilds,
      sequenceTreeOperations:
        this.sequence.getStructuralOperationCount() +
        fugueStats.markerTreeOperations +
        this.segmentedPlaceholderStructuralOperationCount(),
    };
  }

  /** Restore diagnostic counters after an exceptional replica rollback. */
  restoreStats(stats: EngineStats): void {
    this.retreatCount = stats.retreatCount;
    this.advanceCount = stats.advanceCount;
    this.processedEventCount = stats.eventsProcessed;
    this.nonConflictingRunCount = stats.nonConflictingRunCount;
    this.fullReplayCount = stats.fullReplayCount;
    this.peakSequenceRecordCount = stats.peakSequenceRecordCount;
    this.integrationProbeCount = stats.integrationProbeCount;
    this.fugueOrder.restoreStats({
      comparisons: stats.fugueComparisons,
      markerOperations: stats.fugueMarkerOperations,
      // EngineStats historically stores a single ranked-tree aggregate. Put
      // the restored aggregate on the document tree below and restart this
      // internal breakdown at zero so the externally visible total remains
      // monotonic without changing the snapshot/API shape.
      markerTreeOperations: 0,
      rotations: stats.fugueRotations,
      rebuilds: stats.fugueRebuilds,
    });
    this.sequence.restoreStructuralOperationCount(stats.sequenceTreeOperations);
  }

  getSequenceRecords(): EngineSequenceRecord[] {
    this.flushPendingInsert();
    this.materializeSnapshotDeleteTargets();
    const items = this.sequence.toArray();
    const itemAt = (itemId: ItemKey): AugmentedCRDTItem | undefined =>
      this.items.at(itemId);
    if (this.segmentedPlaceholders.size === 0) {
      return items.map((item) => this.codec.recordFromItem(item, itemAt));
    }

    const rightBoundaryAliases = new Map<EventId, EventId>();
    for (const item of items) {
      const placeholder = item.placeholder;
      if (placeholder === undefined) {
        continue;
      }
      const segments = placeholder.state.logicalSegmentsInRange(
        placeholder.start,
        placeholder.end,
      );
      const rightmost = segments.at(-1);
      if (rightmost !== undefined) {
        rightBoundaryAliases.set(this.codec.itemIdOf(item), rightmost.id);
      }
    }

    const records: EngineSequenceRecord[] = [];
    for (const item of items) {
      const placeholder = item.placeholder;
      if (placeholder === undefined) {
        const record = this.codec.recordFromItem(item, itemAt);
        const originLeft =
          record.originLeft === null
            ? null
            : (rightBoundaryAliases.get(record.originLeft) ??
              record.originLeft);
        records.push(
          originLeft === record.originLeft ? record : { ...record, originLeft },
        );
        continue;
      }

      for (const segment of placeholder.state.logicalSegmentsInRange(
        placeholder.start,
        placeholder.end,
      )) {
        records.push({
          id: segment.id,
          eventId: PLACEHOLDER_EVENT_ID,
          content: materializeRecordContent(
            item.content,
            segment.start - placeholder.start,
            segment.end - placeholder.start,
          ),
          originLeft: null,
          originRight: null,
          everDeleted: segment.everDeleted,
          prepareState: segment.prepareState,
          run: null,
        });
      }
    }
    return records;
  }

  getDeleteTargetRecords(): DeleteTargetRecord[] {
    this.flushPendingInsert();
    this.materializeSnapshotDeleteTargets();
    const entries = this.deleteTargets.entries(
      (itemId) => this.codec.itemIdOf(this.items.require(itemId)),
      (target) =>
        target.state
          .logicalSegmentsInRange(target.start, target.end)
          .map(({ id }) => id),
    );
    const records = entries.map((entry) => ({
      deleteEventId: this.graph.idAtLocalVersion(entry.deleteEvent),
      targetIds: entry.targetIds,
    }));
    if (!records.some((record) => record.targetIds.length > 1)) {
      return records;
    }

    const order = new Map<EventId, number>();
    let rank = 0;
    this.sequence.forEach((item) => {
      const placeholder = item.placeholder;
      if (placeholder === undefined) {
        order.set(this.codec.itemIdOf(item), rank++);
        return;
      }
      for (const segment of placeholder.state.logicalSegmentsInRange(
        placeholder.start,
        placeholder.end,
      )) {
        order.set(segment.id, rank++);
      }
    });
    return records.map((record) => ({
      deleteEventId: record.deleteEventId,
      targetIds: [...record.targetIds].sort((left, right) => {
        const leftRank = order.get(left) ?? Number.POSITIVE_INFINITY;
        const rightRank = order.get(right) ?? Number.POSITIVE_INFINITY;
        return leftRank === rightRank
          ? compareEventIds(left, right)
          : leftRank - rightRank;
      }),
    }));
  }

  private materializeRunDeleteTargets(): void {
    this.materializePackedDeleteTargets();
    if (!this.deleteTargets.hasRunEventTargets()) {
      return;
    }
    this.deleteTargets.materializeRunEventTargets(
      (agent, sequence) => this.resolveRunDeleteTargetItem(agent, sequence).id,
    );
    this.samplePeakSequenceRecordCount();
  }

  private materializePackedDeleteTargets(): void {
    if (!this.deleteTargets.hasPackedOrderRange()) {
      return;
    }
    const plan = this.packedReplayPlan;
    if (plan === null) {
      throw new Error("Packed delete targets have no replay plan");
    }
    // Packed offsets are the graph's local versions.
    this.deleteTargets.materializePackedRecords((orderIndex) =>
      plan.eventOffsetAt(orderIndex),
    );
    if (this.deleteTargets.hasPackedRecords()) {
      throw new Error("Packed delete target materialization is incomplete");
    }
    this.packedReplayPlan = null;
  }

  private materializeSnapshotDeleteTargets(): void {
    this.materializeRunDeleteTargets();
    this.deleteTargets.materializePlaceholderTargetBoundaries();
  }

  captureRecoveryState(): EngineRecoveryState {
    this.flushPendingInsert();
    return {
      currentVersion: this.getCurrentVersion(),
      textBuffer: this.resultingText,
      sequenceRecords: this.getSequenceRecords(),
      deleteTargets: this.getDeleteTargetRecords(),
      eventOrder: this.eventsByOrder.map((localVersion) =>
        this.graph.idAtLocalVersion(localVersion),
      ),
      eventIndexesComplete: this.eventIndexesComplete,
      stats: this.getStats(),
    };
  }

  private restoreSnapshotState(state: EngineSnapshotState): void {
    this.eventOrder.clear();
    this.eventsByOrder.length = 0;
    this.eventIndexesComplete = false;
    this.graph = state.graph;
    this.eventItems.clear();
    this.deleteTargets.clear();
    this.segmentedPlaceholders.clear();
    this.items.clear();
    this.originLeftIndex.clear();
    this.fugueOrder.clear();
    const records = state.compactSequenceRecords
      ? recordsFromCompactRecords(state.compactSequenceRecords)
      : (state.sequenceRecords ?? []);
    const items = this.codec.itemsFromRecords(records, this.items);
    this.sequence.resetFromRecords(items);
    this.currentVersion = this.localVersionsOf(state.currentVersion);
    this.resultingText =
      state.textBuffer ?? PersistentUtf16Rope.from(state.text);
    this.prepareViewMayContainSurrogatePairs =
      this.resultingText.hasSurrogateCodeUnits ||
      items.some((item) => recordContentHasSurrogateCodeUnits(item.content));
    this.packedReplayPlan = null;
    this.objectInsertTail = null;
    this.objectInsertNextPrepareIndex = -1;
    this.objectInsertTailResult.item = null;
    this.pendingInsert.reset();
    this.retreatCount = 0;
    this.advanceCount = 0;
    this.nonConflictingRunCount = 0;
    this.fullReplayCount = 0;
    const graphFrontier = state.graph.getFrontier();
    this.processedEventCount = versionSetsEqual(
      state.currentVersion,
      graphFrontier,
    )
      ? state.graph.getEventCount()
      : state.graph.expandVersion(state.currentVersion).size;
    this.peakSequenceRecordCount = items.length;
    this.integrationProbeCount = 0;
    this.useLinearIntegrationOracle = false;
    this.placeholderCounter = inferNextPlaceholderCounter(items);

    items.forEach((item, index) => {
      this.items.add(item);
      this.originLeftIndex.track(item.id, item.originLeft);
      this.trackEventItems(item, records[index]!.eventId);
    });
    this.fugueOrder.rebuild(items);

    const deleteTargets = state.compactDeleteTargets
      ? iterateCompactDeleteTargets(state.compactDeleteTargets)
      : (state.deleteTargets ?? []);
    const keyByItemId = new Map<EventId, ItemKey>();
    records.forEach((record, index) => {
      keyByItemId.set(record.id, items[index]!.id);
    });
    for (const target of deleteTargets) {
      const deleteEvent = this.graph.localVersionOf(target.deleteEventId);
      if (deleteEvent < 0) {
        throw new Error(
          `Delete target record references missing event ${target.deleteEventId}`,
        );
      }
      this.deleteTargets.record(
        deleteEvent,
        target.targetIds.map((itemId) => {
          const key = keyByItemId.get(itemId);
          if (key === undefined) {
            throw new Error(
              `Delete target ${target.deleteEventId} references unknown item ${itemId}`,
            );
          }
          return key;
        }),
      );
    }
  }

  private processEvent(
    localVersion: number,
    operation: ExternalOperation,
    collectTransformedOperations: boolean,
  ): ReadonlyArray<ExternalOperation> {
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
    const parents = this.parentScratch;
    parents.length = 0;
    this.graph.forEachParentLocalVersion(localVersion, this.pushParent);
    if (localVersionsEqual(parents, this.currentVersion)) {
      const transformed = this.apply(
        localVersion,
        operation,
        collectTransformedOperations,
      );
      this.currentVersion = [localVersion];
      this.nonConflictingRunCount++;
      this.processedEventCount++;
      this.samplePeakSequenceRecordCount();
      return transformed;
    }

    const { retreat, advance } = this.diffVersions(
      this.currentVersion,
      parents.slice(),
    );

    this.applyObjectPrepareTransition(retreat, advance);

    const transformed = this.apply(
      localVersion,
      operation,
      collectTransformedOperations,
    );
    this.currentVersion = [localVersion];
    this.fullReplayCount++;
    this.processedEventCount++;
    this.samplePeakSequenceRecordCount();
    return transformed;
  }

  private readonly parentScratch: number[] = [];
  private readonly pushParent = (parent: number): void => {
    this.parentScratch.push(parent);
  };

  private processPackedEvent(
    plan: PackedCriticalReplayPlan,
    eventOffset: number,
    rangeStart: number,
    rangeEnd: number,
    currentOffset: number | null,
  ): number {
    const nonConflicting =
      currentOffset === null
        ? plan.parentsEqualLocalVersionsAtKnownOffset(
            eventOffset,
            this.currentVersion,
          )
        : plan.hasSingleParentAtKnownOffset(eventOffset, currentOffset);

    if (!nonConflicting) {
      const transition =
        currentOffset === null
          ? plan.transitionRangesFromLocalVersionsToKnownOffset(
              this.currentVersion,
              eventOffset,
            )
          : plan.transitionRangesBetweenKnownOffsets(
              currentOffset,
              eventOffset,
            );
      this.applyPackedPrepareTransition(plan, transition, rangeStart, rangeEnd);
      this.fullReplayCount++;
    } else {
      this.nonConflictingRunCount++;
    }

    this.applyPackedOperation(plan, eventOffset, nonConflicting);
    this.processedEventCount++;
    this.samplePeakSequenceRecordCount();
    return eventOffset;
  }

  /**
   * Absorb a canonical sole-parent scalar insert chain into one typed-run
   * mutation during object-backed replay.
   *
   * The ordinary per-event path already coalesces these events into one CRDT
   * record, but still updates the ranked sequence and allocates replay
   * bookkeeping once per scalar. Cold and checkpoint replay do not return
   * transformed operations, so validate the whole suffix first and extend
   * the shared record once. EventItemIndex resolves every skipped canonical
   * ID through the run interval and RecordSplitter materializes interior
   * anchors only if a later branch or delete needs them.
   *
   * The batch path must mirror {@link applyInsert}'s empty-conflict-region
   * gate: a concurrent retreated sibling can sit after the tail without
   * becoming `tail.originRight`, and scalar coalescing refuses to extend in
   * that case. Requiring {@link IndexedSequence.isLast} keeps deferred
   * typed-run spans identical to eager per-event records.
   */
  private extendObjectInsertRun(
    localVersions: ReadonlyArray<number>,
    operationAt: (index: number) => ExternalOperation,
    startEventIndex: number,
    currentLocalVersion: number,
    graph: EventGraph,
  ): number {
    const tail = this.objectInsertTail;
    if (
      tail === null ||
      typeof tail.content !== "string" ||
      !tail.run ||
      tail.originRight !== null ||
      !this.sequence.isLast(tail)
    ) {
      return startEventIndex;
    }

    const firstSequence = tail.sequence + tail.content.length;
    let expectedSequence = firstSequence;
    let expectedPrepareIndex = this.objectInsertNextPrepareIndex;
    let previousLocalVersion = currentLocalVersion;
    let eventIndex = startEventIndex;
    const appendedTextParts: string[] = [];
    const parents = this.parentScratch;

    while (eventIndex < localVersions.length) {
      const localVersion = localVersions[eventIndex]!;
      parents.length = 0;
      graph.forEachParentLocalVersion(localVersion, this.pushParent);
      if (parents.length !== 1 || parents[0] !== previousLocalVersion) {
        break;
      }
      const operation = operationAt(eventIndex);
      if (
        operation.type !== OPERATION_TYPE.INSERT ||
        operation.text.length !== 1 ||
        operation.index !== expectedPrepareIndex
      ) {
        break;
      }

      const codeUnit = operation.text.charCodeAt(0);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
        break;
      }
      if (
        graph.agentAt(localVersion) !== tail.agent ||
        graph.sequenceAt(localVersion) !== expectedSequence ||
        !this.eventItems.canExtendRunItem(tail, appendedTextParts.length + 1)
      ) {
        break;
      }

      appendedTextParts.push(operation.text);
      expectedPrepareIndex++;
      expectedSequence++;
      previousLocalVersion = localVersion;
      eventIndex++;
    }

    const appendedEvents = eventIndex - startEventIndex;
    if (appendedEvents === 0) {
      return startEventIndex;
    }
    const appendedText = appendedTextParts.join("");
    if (
      appendedText.length !== appendedEvents ||
      this.sequence.prepareIndexAfter(tail) !==
        this.objectInsertNextPrepareIndex ||
      !canExtendTypedRun(
        tail,
        tail.agent,
        firstSequence,
        appendedEvents,
        this.insertDeps,
      )
    ) {
      return startEventIndex;
    }

    // The tail may end in a high surrogate immediately before an existing
    // low surrogate. Inserting the first skipped code unit at that boundary
    // must fail exactly as the scalar path would; subsequent boundaries are
    // behind known non-surrogate inserts and therefore cannot split a pair.
    this.assertOperationInPrepareView(
      localVersions[startEventIndex]!,
      this.objectInsertNextPrepareIndex,
      1,
      false,
    );
    applyTypedRunExtension(
      tail,
      appendedText,
      this.insertDeps,
      this.deferTextMaterialization,
    );
    this.objectInsertNextPrepareIndex = expectedPrepareIndex;
    this.currentVersion = [previousLocalVersion];
    this.nonConflictingRunCount += appendedEvents;
    this.processedEventCount += appendedEvents;
    this.samplePeakSequenceRecordCount();
    return eventIndex;
  }

  /**
   * Apply one object-backed prepare-view transition as typed-run spans.
   *
   * Scalar retreat/advance used to split a coalesced run once per event and
   * update the ranked sequence after every split. Resolve participating
   * delete targets first, isolate only run-span boundaries, accumulate all
   * prepare deltas, and refresh ranked weights once.
   */
  private applyObjectPrepareTransition(
    retreat: ReadonlyArray<number>,
    advance: ReadonlyArray<number>,
  ): void {
    const deltas = this.prepareDeltas;
    deltas.clear();

    const materializeDeleteTargets = this.deleteTargets.hasRunEventTargets();
    const resolveItemId = (agent: number, sequence: number): ItemKey =>
      this.resolveRunDeleteTargetItem(agent, sequence).id;
    const graph = this.graph;
    const materializeAndCount = (
      localVersions: ReadonlyArray<number>,
    ): number => {
      let knownEventCount = 0;
      for (const localVersion of localVersions) {
        if (!this.eventOrder.has(localVersion)) {
          continue;
        }
        knownEventCount++;
        if (
          materializeDeleteTargets &&
          !graph.isInsertAtLocalVersion(localVersion)
        ) {
          this.deleteTargets.materializeRunEventTargetsOf(
            localVersion,
            resolveItemId,
          );
        }
      }
      return knownEventCount;
    };

    const retreated = materializeAndCount(retreat);
    const advanced = materializeAndCount(advance);
    this.collectObjectInsertPrepareSpans(retreat, -1, deltas);
    this.collectObjectInsertPrepareSpans(advance, 1, deltas);
    this.collectObjectDeletePrepareDeltas(retreat, -1, deltas);
    this.collectObjectDeletePrepareDeltas(advance, 1, deltas);
    this.applyCollectedPrepareDeltas(deltas);
    this.retreatCount += retreated;
    this.advanceCount += advanced;
  }

  private collectObjectInsertPrepareSpans(
    localVersions: ReadonlyArray<number>,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    const graph = this.graph;
    const isKnownInsert = (localVersion: number): boolean =>
      this.eventOrder.has(localVersion) &&
      graph.isInsertAtLocalVersion(localVersion);
    let groupStart = 0;
    while (groupStart < localVersions.length) {
      const first = localVersions[groupStart]!;
      if (!isKnownInsert(first)) {
        groupStart++;
        continue;
      }

      const agent = graph.agentAt(first);
      let groupEnd = groupStart + 1;
      if (agent >= 0) {
        let expectedSequence = graph.sequenceAt(first) + delta;
        while (groupEnd < localVersions.length) {
          const next = localVersions[groupEnd]!;
          if (
            !isKnownInsert(next) ||
            graph.agentAt(next) !== agent ||
            graph.sequenceAt(next) !== expectedSequence
          ) {
            break;
          }
          expectedSequence += delta;
          groupEnd++;
        }
      }

      const groupLength = groupEnd - groupStart;
      let consumed = 0;
      while (consumed < groupLength) {
        const eventIndex =
          delta === 1 ? groupStart + consumed : groupEnd - consumed - 1;
        const localVersion = localVersions[eventIndex]!;
        const item = this.recordSplitter.isolateRunSpanForEvents(
          localVersion,
          groupLength - consumed,
        );
        if (item === null) {
          this.collectInsertPrepareDelta(localVersion, delta, deltas);
          consumed++;
          continue;
        }

        const isolatedEventCount = item.content.length;
        if (
          isolatedEventCount <= 0 ||
          isolatedEventCount > groupLength - consumed
        ) {
          throw new Error(
            `Invalid typed-run transition span at event ${localVersion}`,
          );
        }
        this.collectPrepareDeltaForItem(item, delta, deltas);
        consumed += isolatedEventCount;
      }
      groupStart = groupEnd;
    }
  }

  private collectObjectDeletePrepareDeltas(
    localVersions: ReadonlyArray<number>,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    for (const localVersion of localVersions) {
      if (
        this.eventOrder.has(localVersion) &&
        !this.graph.isInsertAtLocalVersion(localVersion)
      ) {
        this.collectDeletePrepareDelta(localVersion, delta, deltas);
      }
    }
  }

  private applyPackedPrepareTransition(
    plan: PackedCriticalReplayPlan,
    transition: PackedLocalVersionTransition,
    rangeStart: number,
    rangeEnd: number,
  ): void {
    const deltas = this.prepareDeltas;
    deltas.clear();

    // Lazy scalar delete targets may still share one typed-run record. Split
    // targets participating in this transition before insert spans add
    // pending deltas: splitting afterwards would leave new right halves out
    // of the delta map and toggle only part of an insert range.
    this.materializePackedTransitionRunDeleteTargets(
      plan,
      transition,
      rangeStart,
      rangeEnd,
    );

    // Split every affected insert slice before resolving delete targets. A
    // split extends existing delete membership to both halves; resolving
    // deletes afterwards therefore observes the final record boundaries and
    // lets all prepare-state changes commute inside this transition.
    for (let range = 0; range < transition.retreatRangeCount; range++) {
      this.collectPackedInsertPrepareRange(
        plan,
        transition.retreatStarts[range]!,
        transition.retreatEnds[range]!,
        -1,
        rangeStart,
        rangeEnd,
        deltas,
      );
    }
    for (let range = 0; range < transition.advanceRangeCount; range++) {
      this.collectPackedInsertPrepareRange(
        plan,
        transition.advanceStarts[range]!,
        transition.advanceEnds[range]!,
        1,
        rangeStart,
        rangeEnd,
        deltas,
      );
    }

    for (let range = 0; range < transition.retreatRangeCount; range++) {
      const start = transition.retreatStarts[range]!;
      for (
        let offset = transition.retreatEnds[range]! - 1;
        offset >= start;
        offset--
      ) {
        const rank = plan.orderIndexOfKnownOffset(offset);
        if (
          rank >= rangeStart &&
          rank < rangeEnd &&
          !plan.isInsertAtKnownOffset(offset)
        ) {
          this.collectPackedDeletePrepareDelta(offset, rank, -1, deltas);
        }
      }
    }
    for (let range = 0; range < transition.advanceRangeCount; range++) {
      const end = transition.advanceEnds[range]!;
      for (
        let offset = transition.advanceStarts[range]!;
        offset < end;
        offset++
      ) {
        const rank = plan.orderIndexOfKnownOffset(offset);
        if (
          rank >= rangeStart &&
          rank < rangeEnd &&
          !plan.isInsertAtKnownOffset(offset)
        ) {
          this.collectPackedDeletePrepareDelta(offset, rank, 1, deltas);
        }
      }
    }

    this.applyCollectedPrepareDeltas(deltas);
  }

  private applyCollectedPrepareDeltas(
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    if (deltas.size === 0) {
      return;
    }
    if (deltas.size === 1) {
      for (const [item, delta] of deltas) {
        item.prepareState += delta;
        this.sequence.updateItem(item);
      }
      deltas.clear();
      return;
    }

    for (const [item, delta] of deltas) {
      item.prepareState += delta;
    }
    this.sequence.updateItems(deltas.keys());
    deltas.clear();
  }

  private materializePackedTransitionRunDeleteTargets(
    plan: PackedCriticalReplayPlan,
    transition: PackedLocalVersionTransition,
    rangeStart: number,
    rangeEnd: number,
  ): void {
    if (!this.deleteTargets.hasRunEventTargets()) {
      return;
    }
    const resolveItemId = (agent: number, sequence: number): ItemKey =>
      this.resolveRunDeleteTargetItem(agent, sequence).id;
    for (let range = 0; range < transition.retreatRangeCount; range++) {
      const start = transition.retreatStarts[range]!;
      for (
        let offset = transition.retreatEnds[range]! - 1;
        offset >= start;
        offset--
      ) {
        const rank = plan.orderIndexOfKnownOffset(offset);
        if (
          rank >= rangeStart &&
          rank < rangeEnd &&
          !plan.isInsertAtKnownOffset(offset)
        ) {
          if (this.deleteTargets.firstTargetOfPackedOrder(rank) !== 0) {
            this.deleteTargets.materializeRunEventTargetsOfPackedOrder(
              rank,
              resolveItemId,
            );
          } else {
            this.deleteTargets.materializeRunEventTargetsOf(
              offset,
              resolveItemId,
            );
          }
        }
      }
    }
    for (let range = 0; range < transition.advanceRangeCount; range++) {
      const end = transition.advanceEnds[range]!;
      for (
        let offset = transition.advanceStarts[range]!;
        offset < end;
        offset++
      ) {
        const rank = plan.orderIndexOfKnownOffset(offset);
        if (
          rank >= rangeStart &&
          rank < rangeEnd &&
          !plan.isInsertAtKnownOffset(offset)
        ) {
          if (this.deleteTargets.firstTargetOfPackedOrder(rank) !== 0) {
            this.deleteTargets.materializeRunEventTargetsOfPackedOrder(
              rank,
              resolveItemId,
            );
          } else {
            this.deleteTargets.materializeRunEventTargetsOf(
              offset,
              resolveItemId,
            );
          }
        }
      }
    }
    this.samplePeakSequenceRecordCount();
  }

  /**
   * Collect one packed transition range while preserving its scalar event
   * counters. Adjacent canonical scalar inserts are first grouped by author
   * sequence, then consumed one existing typed-run fragment at a time. This
   * keeps record splitting proportional to actual run boundaries rather than
   * the number of events in the version diff.
   */
  private collectPackedInsertPrepareRange(
    plan: PackedCriticalReplayPlan,
    startOffset: number,
    endOffset: number,
    direction: 1 | -1,
    rangeStart: number,
    rangeEnd: number,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    let offset = direction === 1 ? startOffset : endOffset - 1;
    while (direction === 1 ? offset < endOffset : offset >= startOffset) {
      const rank = plan.orderIndexOfKnownOffset(offset);
      if (rank < rangeStart || rank >= rangeEnd) {
        offset += direction;
        continue;
      }

      if (!plan.isInsertAtKnownOffset(offset)) {
        if (direction === 1) {
          this.advanceCount++;
        } else {
          this.retreatCount++;
        }
        offset += direction;
        continue;
      }

      const agent =
        plan.operationLengthAtKnownOffset(offset) === 1
          ? plan.agentAtKnownOffset(offset)
          : CUSTOM_EVENT_AGENT;
      let groupLength = 1;
      let groupTailOffset = offset;
      let scanOffset = offset + direction;
      if (agent >= 0) {
        let expectedSequence = plan.sequenceAtKnownOffset(offset) + direction;
        while (
          direction === 1 ? scanOffset < endOffset : scanOffset >= startOffset
        ) {
          const scanRank = plan.orderIndexOfKnownOffset(scanOffset);
          if (
            scanRank < rangeStart ||
            scanRank >= rangeEnd ||
            !plan.isInsertAtKnownOffset(scanOffset) ||
            plan.operationLengthAtKnownOffset(scanOffset) !== 1 ||
            plan.agentAtKnownOffset(scanOffset) !== agent ||
            plan.sequenceAtKnownOffset(scanOffset) !== expectedSequence
          ) {
            break;
          }
          groupLength++;
          groupTailOffset = scanOffset;
          expectedSequence += direction;
          scanOffset += direction;
        }
      }

      const firstOffset = direction === 1 ? offset : groupTailOffset;
      if (agent >= 0) {
        this.collectPackedInsertPrepareSpan(
          firstOffset,
          groupLength,
          direction,
          deltas,
          agent,
          plan.sequenceAtKnownOffset(firstOffset),
        );
      } else {
        this.collectInsertPrepareDelta(offset, direction, deltas);
      }
      if (direction === 1) {
        this.advanceCount += groupLength;
      } else {
        this.retreatCount += groupLength;
      }
      offset = scanOffset;
    }
  }

  /** Consume one ascending canonical event span by current run fragments. */
  private collectPackedInsertPrepareSpan(
    firstOffset: number,
    eventCount: number,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
    agent: number,
    firstSequence: number,
  ): void {
    let consumed = 0;
    while (consumed < eventCount) {
      const item = this.recordSplitter.isolateRunSpanForCanonicalEvents(
        agent,
        firstSequence + consumed,
        eventCount - consumed,
      );
      if (item === null) {
        this.collectInsertPrepareDelta(firstOffset + consumed, delta, deltas);
        consumed++;
        continue;
      }

      const isolatedEventCount = item.content.length;
      if (
        isolatedEventCount <= 0 ||
        isolatedEventCount > eventCount - consumed
      ) {
        throw new Error(
          `Invalid typed-run transition span at ${this.eventLabel(firstOffset + consumed)}`,
        );
      }
      this.collectPrepareDeltaForItem(item, delta, deltas);
      consumed += isolatedEventCount;
    }
  }

  private applyPackedOperation(
    plan: PackedCriticalReplayPlan,
    eventOffset: number,
    mayContinuePreviousInsert: boolean,
  ): void {
    const operationIndex = plan.operationIndexAtKnownOffset(eventOffset);
    const operationLength = plan.operationLengthAtKnownOffset(eventOffset);
    if (plan.isInsertAtKnownOffset(eventOffset)) {
      const start = plan.insertStartAtKnownOffset(eventOffset);
      const insertedText = plan.sliceInsertedContent(
        start,
        start + operationLength,
      );
      this.assertOperationInPrepareView(
        eventOffset,
        operationIndex,
        operationLength,
        false,
      );
      const knownTail =
        mayContinuePreviousInsert &&
        this.packedInsertTail !== null &&
        operationIndex === this.packedInsertNextPrepareIndex
          ? this.packedInsertTail
          : null;
      applyInsert(
        eventOffset,
        plan.agentAtKnownOffset(eventOffset),
        plan.sequenceAtKnownOffset(eventOffset),
        operationIndex,
        insertedText,
        this.insertDeps,
        false,
        this.deferTextMaterialization,
        knownTail,
        this.packedInsertTailResult,
      );
      this.packedInsertTail = this.packedInsertTailResult.item;
      this.packedInsertNextPrepareIndex = operationIndex + operationLength;
      this.prepareViewMayContainSurrogatePairs ||=
        containsUtf16SurrogateCodeUnit(insertedText);
      return;
    }

    this.packedInsertTail = null;
    this.packedInsertNextPrepareIndex = -1;
    this.assertOperationInPrepareView(
      eventOffset,
      operationIndex,
      operationLength,
      true,
    );
    applyDelete(
      null,
      operationIndex,
      operationLength,
      this.deleteDeps,
      false,
      this.deferTextMaterialization,
      plan.orderIndexOfKnownOffset(eventOffset),
    );
  }

  /**
   * Absorb a sole-parent chain of scalar typed inserts into the current tail.
   *
   * Every causal/index/ID column is checked before mutation, then the shared
   * scalar run gate validates the whole author interval. The final-span check
   * is load-bearing: a prepare-position proof alone cannot rule out a
   * previously registered successor run after nonlinear replay and splits.
   */
  private extendPackedInsertRun(
    plan: PackedCriticalReplayPlan,
    startOrderIndex: number,
    endOrderIndex: number,
    currentOffset: number,
  ): number {
    const tail = this.packedInsertTail;
    if (
      tail === null ||
      typeof tail.content !== "string" ||
      !tail.run ||
      tail.originRight !== null ||
      !this.sequence.isLast(tail)
    ) {
      return startOrderIndex;
    }

    const agent = tail.agent;
    const firstSequence = tail.sequence + tail.content.length;
    let expectedSequence = firstSequence;
    let expectedPrepareIndex = this.packedInsertNextPrepareIndex;
    let previousOffset = currentOffset;
    let orderIndex = startOrderIndex;
    let contentStart = -1;
    let contentEnd = -1;

    while (orderIndex < endOrderIndex) {
      const eventOffset = plan.eventOffsetAt(orderIndex);
      if (
        !plan.hasSingleParentAtKnownOffset(eventOffset, previousOffset) ||
        !plan.isInsertAtKnownOffset(eventOffset) ||
        plan.operationLengthAtKnownOffset(eventOffset) !== 1 ||
        plan.operationIndexAtKnownOffset(eventOffset) !== expectedPrepareIndex
      ) {
        break;
      }

      if (
        plan.agentAtKnownOffset(eventOffset) !== agent ||
        plan.sequenceAtKnownOffset(eventOffset) !== expectedSequence
      ) {
        break;
      }

      const insertStart = plan.insertStartAtKnownOffset(eventOffset);
      if (contentStart < 0) {
        contentStart = insertStart;
      } else if (insertStart !== contentEnd) {
        break;
      }
      contentEnd = insertStart + 1;
      expectedPrepareIndex++;
      expectedSequence++;
      previousOffset = eventOffset;
      orderIndex++;
    }

    const appendedEvents = orderIndex - startOrderIndex;
    if (
      appendedEvents === 0 ||
      contentStart < 0 ||
      contentEnd <= contentStart
    ) {
      return startOrderIndex;
    }
    const appendedText = plan.sliceInsertedContent(contentStart, contentEnd);
    if (
      appendedText.length !== appendedEvents ||
      containsUtf16SurrogateCodeUnit(appendedText) ||
      this.sequence.prepareIndexAfter(tail) !==
        this.packedInsertNextPrepareIndex ||
      !canExtendTypedRun(
        tail,
        agent,
        firstSequence,
        appendedEvents,
        this.insertDeps,
      )
    ) {
      return startOrderIndex;
    }

    applyTypedRunExtension(
      tail,
      appendedText,
      this.insertDeps,
      this.deferTextMaterialization,
    );
    this.packedInsertNextPrepareIndex = expectedPrepareIndex;
    this.nonConflictingRunCount += appendedEvents;
    this.processedEventCount += appendedEvents;
    this.samplePeakSequenceRecordCount();
    return orderIndex;
  }

  /**
   * Absorb a sole-parent chain of scalar deletes at one cursor into a single
   * segmented-placeholder range mutation. Each event still receives its own
   * exact logical target, so later retreat/advance transitions remain scalar
   * while cover/effect and ranked-sequence updates stay range-batched.
   */
  private extendPackedScalarDeleteRun(
    plan: PackedCriticalReplayPlan,
    startOrderIndex: number,
    endOrderIndex: number,
    currentOffset: number,
  ): number {
    if (
      !this.deferTextMaterialization ||
      this.prepareViewMayContainSurrogatePairs ||
      plan.isInsertAtKnownOffset(currentOffset) ||
      plan.operationLengthAtKnownOffset(currentOffset) !== 1
    ) {
      return startOrderIndex;
    }

    const operationIndex = plan.operationIndexAtKnownOffset(currentOffset);
    if (operationIndex >= this.sequence.prepareLength) {
      return startOrderIndex;
    }
    const landing = this.sequence.prepareIndexToPositionAndOffset(
      operationIndex,
      false,
    );
    const candidate = this.sequence.at(landing.position);
    if (candidate === undefined) {
      return startOrderIndex;
    }

    const placeholder = candidate.placeholder;
    const availableEvents =
      placeholder !== undefined
        ? placeholder.state.prepareLengthInRange(
            placeholder.start + landing.offsetInRecord,
            placeholder.end,
          )
        : candidate.run &&
            typeof candidate.content === "string" &&
            candidate.prepareState === 1
          ? candidate.content.length - landing.offsetInRecord
          : 0;
    if (availableEvents < 2) {
      return startOrderIndex;
    }

    let previousOffset = currentOffset;
    let orderIndex = startOrderIndex;
    const scanEndOrderIndex = Math.min(
      endOrderIndex,
      startOrderIndex + availableEvents,
    );
    while (orderIndex < scanEndOrderIndex) {
      const eventOffset = plan.eventOffsetAt(orderIndex);
      if (
        !plan.hasSingleParentAtKnownOffset(eventOffset, previousOffset) ||
        plan.isInsertAtKnownOffset(eventOffset) ||
        plan.operationLengthAtKnownOffset(eventOffset) !== 1 ||
        plan.operationIndexAtKnownOffset(eventOffset) !== operationIndex
      ) {
        break;
      }
      previousOffset = eventOffset;
      orderIndex++;
    }

    const appendedEvents = orderIndex - startOrderIndex;
    if (appendedEvents < 2) {
      return startOrderIndex;
    }
    this.deleteTargets.assertPackedOrderRangeAvailable(
      startOrderIndex,
      orderIndex,
    );

    if (placeholder !== undefined) {
      const state = placeholder.state;
      const result = state.deletePrepareVisibleUnitsInSlice(
        placeholder,
        landing.offsetInRecord,
        appendedEvents,
      );
      let batchedEvents = 0;
      for (const range of result.ranges) {
        batchedEvents += range.end - range.start;
      }
      if (batchedEvents !== appendedEvents) {
        throw new Error(
          `Packed placeholder delete run applied ${batchedEvents} of ${appendedEvents} events`,
        );
      }

      let consumed = 0;
      for (const range of result.ranges) {
        for (
          let absoluteOffset = range.start;
          absoluteOffset < range.end;
          absoluteOffset++
        ) {
          this.deleteTargets.recordPackedPlaceholderRange(
            startOrderIndex + consumed,
            state,
            absoluteOffset,
            absoluteOffset + 1,
          );
          consumed++;
        }
      }
      if (consumed !== appendedEvents) {
        throw new Error(
          `Packed placeholder delete run recorded ${consumed} of ${appendedEvents} events`,
        );
      }
      this.sequence.updateItem(candidate);
    } else {
      const middle = this.recordSplitter.splitRecordForDelete(
        candidate,
        landing.offsetInRecord,
        appendedEvents,
      );
      if (
        !middle.run ||
        typeof middle.content !== "string" ||
        middle.content.length !== appendedEvents ||
        middle.prepareState !== 1
      ) {
        throw new Error(
          `Packed typed-run delete span is invalid at ${operationIndex}`,
        );
      }
      for (let consumed = 0; consumed < appendedEvents; consumed++) {
        this.deleteTargets.recordPackedRunEvent(
          startOrderIndex + consumed,
          middle.agent,
          middle.sequence + consumed,
        );
      }
      middle.everDeleted = true;
      middle.prepareState += 1;
      this.sequence.updateItem(middle);
    }

    this.nonConflictingRunCount += appendedEvents;
    this.processedEventCount += appendedEvents;
    this.samplePeakSequenceRecordCount();
    return orderIndex;
  }

  /**
   * Update the high-water mark for {@link sequenceRecordCount}. Sampling
   * after each `apply` (and after the initial-text placeholder seed in
   * `reset`) is sufficient: every record creation goes through `apply` or
   * the placeholder seed path, and the post-apply sample captures any
   * mid-apply growth that splits/inserts produced.
   */
  private samplePeakSequenceRecordCount(): void {
    const live = this.items.size;
    if (live > this.peakSequenceRecordCount) {
      this.peakSequenceRecordCount = live;
    }
  }

  private segmentedPlaceholderStructuralOperationCount(): number {
    let count = 0;
    for (const state of this.segmentedPlaceholders) {
      count += state.getStructuralOperationCount();
    }
    return count;
  }

  private reset(
    events: ReadonlyArray<GraphEvent>,
    initialText: string,
    options: GenerateOptions,
  ): void {
    this.resetState(initialText, options);
    const graphEvents =
      options.eventOrder ?? options.eventGraph?.getTopologicalOrder() ?? events;
    if (!options.eventGraph) {
      for (const event of graphEvents) {
        this.graph.addEvent(event);
      }
    }
    graphEvents.forEach((event, index) => {
      const localVersion = this.requireLocalVersion(event.id);
      this.eventOrder.set(localVersion, index);
      this.eventsByOrder.push(localVersion);
    });
    this.eventIndexesComplete = true;
  }

  private resetState(initialText: string, options: GenerateOptions): void {
    this.eventOrder.clear();
    this.eventsByOrder.length = 0;
    this.eventIndexesComplete = false;
    this.graph = options.eventGraph ?? new EventGraph();
    this.eventItems.clear();
    this.deleteTargets.clear();
    this.items.clear();
    this.originLeftIndex.clear();
    this.fugueOrder.clear();
    this.sequence.clear();
    this.currentVersion = this.localVersionsOf(options.initialVersion ?? []);
    this.resultingText =
      options.initialTextBuffer ?? PersistentUtf16Rope.from(initialText);
    this.prepareViewMayContainSurrogatePairs =
      this.resultingText.hasSurrogateCodeUnits;
    this.packedReplayPlan = null;
    this.pendingInsert.reset();
    this.retreatCount = 0;
    this.advanceCount = 0;
    this.nonConflictingRunCount = 0;
    this.fullReplayCount = 0;
    this.processedEventCount = 0;
    this.peakSequenceRecordCount = 0;
    this.integrationProbeCount = 0;
    this.useLinearIntegrationOracle =
      options.integrationMode === "linear-oracle";
    this.objectInsertTail = null;
    this.objectInsertNextPrepareIndex = -1;
    this.objectInsertTailResult.item = null;
    this.packedInsertTail = null;
    this.packedInsertNextPrepareIndex = -1;
    this.packedInsertTailResult.item = null;
    this.prepareDeltas.clear();
    this.placeholderCounter = 0;

    if (this.resultingText.length === 0) {
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
      id: this.items.nextKey(),
      agent: PLACEHOLDER_AGENT,
      sequence: this.placeholderCounter++,
      offset: 0,
      content:
        options.initialTextBuffer === undefined
          ? initialText
          : RopeRecordContent.from(options.initialTextBuffer),
      originLeft: null,
      originRight: null,
      everDeleted: false,
      prepareState: 1,
      run: false,
    };
    if (!this.fugueOrder.integrateAtKnownPosition(placeholder)) {
      throw new Error("Fugue order index unavailable for initial text");
    }
    this.sequence.insert(0, placeholder);
    this.items.add(placeholder);
    this.samplePeakSequenceRecordCount();
  }

  private enableSegmentedPlaceholder(): void {
    if (this.sequence.length !== 1) {
      return;
    }
    const placeholder = this.sequence.at(0);
    if (
      placeholder === undefined ||
      placeholder.agent !== PLACEHOLDER_AGENT ||
      placeholder.external !== undefined ||
      placeholder.placeholder !== undefined ||
      placeholder.content.length === 0
    ) {
      return;
    }

    const state = new SegmentedPlaceholderState<AugmentedCRDTItem>(
      placeholder.content.length,
      formatPlaceholderId(placeholder.sequence),
      () => formatPlaceholderId(this.placeholderCounter++),
    );
    const slice = state.createInitialPhysicalSlice();
    slice.attachOwner(placeholder);
    placeholder.placeholder = slice;
    this.segmentedPlaceholders.add(state);
    this.sequence.updateItem(placeholder);
  }

  /** Register a restored item under the event it names in its record. */
  private trackEventItems(item: AugmentedCRDTItem, eventId: EventId): void {
    if (item.run) {
      this.eventItems.registerRunItem(item);
      return;
    }

    if (eventId !== PLACEHOLDER_EVENT_ID) {
      // An item of an event outside the graph cannot be reached by a replay
      // transition, which only names graph events.
      const localVersion = this.graph.localVersionOf(eventId);
      if (localVersion < 0) {
        return;
      }
      if (item.content.length > 1) {
        this.eventItems.addInsertRun(localVersion, item.id);
      } else {
        this.eventItems.add(localVersion, item.id);
      }
    }
  }

  private apply(
    localVersion: number,
    operation: ExternalOperation,
    collectTransformedOperations: boolean,
  ): ReadonlyArray<ExternalOperation> {
    if (operation.type === OPERATION_TYPE.INSERT) {
      this.assertOperationInPrepareView(
        localVersion,
        operation.index,
        operation.text.length,
        false,
      );
      const transformed = applyInsert(
        localVersion,
        this.graph.agentAt(localVersion),
        this.graph.sequenceAt(localVersion),
        operation.index,
        operation.text,
        this.insertDeps,
        collectTransformedOperations,
        this.deferTextMaterialization,
        null,
        collectTransformedOperations ? undefined : this.objectInsertTailResult,
      );
      if (!collectTransformedOperations) {
        this.objectInsertTail = this.objectInsertTailResult.item;
        this.objectInsertNextPrepareIndex =
          operation.index + operation.text.length;
      }
      // Monotonic for the lifetime of this replay engine: deleted/retreated
      // records can become prepare-visible again, so seeing one surrogate code
      // unit once means future parent views may contain a scalar pair.
      this.prepareViewMayContainSurrogatePairs ||=
        containsUtf16SurrogateCodeUnit(operation.text);
      return transformed;
    }

    this.assertOperationInPrepareView(
      localVersion,
      operation.index,
      operation.length,
      true,
    );
    if (!collectTransformedOperations) {
      this.objectInsertTail = null;
      this.objectInsertNextPrepareIndex = -1;
      this.objectInsertTailResult.item = null;
    }
    return applyDelete(
      localVersion,
      operation.index,
      operation.length,
      this.deleteDeps,
      collectTransformedOperations,
      this.deferTextMaterialization,
    );
  }

  /**
   * Validate ranges against the document at the event's parent version after
   * retreat/advance, before any sequence, text, or delete-target mutation.
   */
  private assertOperationInPrepareView(
    localVersion: number,
    operationIndex: number,
    operationLength: number,
    isDelete: boolean,
  ): void {
    const prepareLength = this.sequence.prepareLength;
    const end = isDelete ? operationIndex + operationLength : operationIndex;
    if (
      operationIndex > prepareLength ||
      end > prepareLength ||
      !Number.isSafeInteger(end)
    ) {
      throw new Error(
        `Event ${this.eventLabel(localVersion)} operation range ${operationIndex}..${end} exceeds parent document length ${prepareLength}`,
      );
    }

    this.assertPrepareScalarBoundary(operationIndex, localVersion);
    if (isDelete) {
      this.assertPrepareScalarBoundary(end, localVersion);
    }
  }

  /** An event's ID for an error message. */
  private eventLabel(localVersion: number): string {
    try {
      return this.graph.idAtLocalVersion(localVersion);
    } catch {
      return `#${localVersion}`;
    }
  }

  private assertPrepareScalarBoundary(
    index: number,
    localVersion: number,
  ): void {
    if (!this.prepareViewMayContainSurrogatePairs) {
      return;
    }
    if (index <= 0 || index >= this.sequence.prepareLength) {
      return;
    }
    const beforeLanding = this.sequence.prepareIndexToPositionAndOffset(
      index - 1,
      false,
    );
    const afterLanding = this.sequence.prepareIndexToPositionAndOffset(
      index,
      false,
    );
    const before = this.sequence
      .at(beforeLanding.position)
      ?.content.charCodeAt(beforeLanding.offsetInRecord);
    const after = this.sequence
      .at(afterLanding.position)
      ?.content.charCodeAt(afterLanding.offsetInRecord);
    if (
      before !== undefined &&
      after !== undefined &&
      before >= 0xd800 &&
      before <= 0xdbff &&
      after >= 0xdc00 &&
      after <= 0xdfff
    ) {
      throw new Error(
        `Event ${this.eventLabel(localVersion)} index ${index} splits a Unicode scalar in its parent document`,
      );
    }
  }

  private collectInsertPrepareDelta(
    localVersion: number,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    const eventItems =
      this.recordSplitter.isolateRunSliceForEvent(localVersion);
    if (typeof eventItems === "number") {
      this.collectItemPrepareDelta(eventItems, delta, deltas);
      return;
    }
    for (const itemId of eventItems ?? []) {
      this.collectItemPrepareDelta(itemId, delta, deltas);
    }
  }

  private collectDeletePrepareDelta(
    localVersion: number,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    this.collectDeletePrepareTargets(
      this.deleteTargets.firstTargetOf(localVersion),
      delta,
      deltas,
    );
  }

  private collectPackedDeletePrepareDelta(
    eventOffset: number,
    orderIndex: number,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    const packedTarget =
      this.deleteTargets.firstTargetOfPackedOrder(orderIndex);
    if (packedTarget !== 0) {
      this.collectDeletePrepareTargets(packedTarget, delta, deltas);
      return;
    }
    this.collectDeletePrepareDelta(eventOffset, delta, deltas);
  }

  private collectDeletePrepareTargets(
    firstTarget: number,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    let target = firstTarget;
    while (target !== 0) {
      const kind = this.deleteTargets.kindOf(target);
      if (kind === DELETE_TARGET_KIND.ITEM) {
        this.collectItemPrepareDelta(
          this.deleteTargets.itemIdOf(target),
          delta,
          deltas,
        );
      } else if (kind === DELETE_TARGET_KIND.RUN_EVENT) {
        throw new Error(
          `Packed transition did not materialize typed-run target ${this.deleteTargets.runEventAgentOf(target)}:${this.deleteTargets.runEventSequenceOf(target)}`,
        );
      } else {
        for (const slice of this.deleteTargets
          .placeholderStateOf(target)
          .adjustPrepareRange(
            this.deleteTargets.placeholderStartOf(target),
            this.deleteTargets.placeholderEndOf(target),
            delta,
          )) {
          const item = slice.owner;
          if (item !== null && !deltas.has(item)) {
            // The segmented state already absorbed the delta. A zero entry
            // keeps the physical slice in the one batched ranked-weight
            // refresh without applying the same prepare delta to its scalar
            // compatibility fields.
            deltas.set(item, 0);
          }
        }
      }
      target = this.deleteTargets.nextTarget(target);
    }
  }

  private resolveRunDeleteTargetItem(
    agent: number,
    sequence: number,
  ): AugmentedCRDTItem {
    const item = this.recordSplitter.isolateRunSliceForCanonical(
      agent,
      sequence,
    );
    if (
      item === null ||
      !item.run ||
      item.content.length !== 1 ||
      item.agent !== agent ||
      item.sequence !== sequence
    ) {
      throw new Error(
        `Typed-run delete target ${this.graph.agentTable.nameOf(agent)}:${sequence} is not isolated`,
      );
    }
    this.samplePeakSequenceRecordCount();
    return item;
  }

  private collectItemPrepareDelta(
    itemId: ItemKey,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    this.collectPrepareDeltaForItem(this.requireItem(itemId), delta, deltas);
  }

  private collectPrepareDeltaForItem(
    item: AugmentedCRDTItem,
    delta: 1 | -1,
    deltas: Map<AugmentedCRDTItem, number>,
  ): void {
    const next = (deltas.get(item) ?? 0) + delta;
    if (next === 0) {
      deltas.delete(item);
    } else {
      deltas.set(item, next);
    }
  }

  private itemToEffectIndex(target: AugmentedCRDTItem): number {
    const effectIndex = this.sequence.effectIndexOf(target);
    if (effectIndex === -1) {
      throw new Error(`Item ${target.id} not found`);
    }
    return effectIndex;
  }

  private materializeEffectVisibleText(): PersistentUtf16Rope {
    return PersistentUtf16Rope.assemble((assembler) => {
      this.sequence.forEach((item) => {
        const placeholder = item.placeholder;
        if (placeholder !== undefined) {
          for (const range of placeholder.state.collectEffectVisibleRanges(
            placeholder.start,
            placeholder.end,
          )) {
            const start = range.start - placeholder.start;
            const end = range.end - placeholder.start;
            if (typeof item.content === "string") {
              assembler.appendText(item.content.slice(start, end));
            } else {
              item.content.appendRangeTo(assembler, start, end);
            }
          }
          return;
        }
        if (item.everDeleted || item.content.length === 0) {
          return;
        }
        if (typeof item.content === "string") {
          assembler.appendText(item.content);
        } else {
          item.content.appendTo(assembler);
        }
      });
    });
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
    items: this.items,
    eventIdOf: (item) => this.codec.eventIdOf(item),
    eventItems: this.eventItems,
    originLeftIndex: this.originLeftIndex,
    recordSplitter: this.recordSplitter,
    fugueOrder: this.fugueOrder,
    pendingInsert: this.pendingInsert,
    applyPendingSplice: this.applyPendingSplice,
    flushPendingInsert: () => this.flushPendingInsert(),
    itemToEffectIndex: (target) => this.itemToEffectIndex(target),
    insertText: (index, text) => {
      this.resultingText = this.resultingText.insert(index, text);
    },
    recordIntegrationProbe: () => {
      this.integrationProbeCount++;
    },
    useLinearIntegrationOracle: () => this.useLinearIntegrationOracle,
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
    currentVersion: ReadonlyArray<number>,
    targetVersion: ReadonlyArray<number>,
  ): LocalVersionTransition {
    this.ensureEventIndexes();
    const transition = this.graph.getLocalVersionTransition(
      currentVersion,
      targetVersion,
    );
    if (this.eventOrder.size === this.graph.getEventCount()) {
      return transition;
    }
    return {
      retreat: transition.retreat.filter((lv) => this.eventOrder.has(lv)),
      advance: transition.advance.filter((lv) => this.eventOrder.has(lv)),
    };
  }

  private ensureEventIndexes(): void {
    if (this.eventIndexesComplete) {
      return;
    }
    this.eventOrder.clear();
    this.eventsByOrder.length = 0;
    this.graph.getTopologicalOrder().forEach((event, index) => {
      const localVersion = this.requireLocalVersion(event.id);
      this.eventOrder.set(localVersion, index);
      this.eventsByOrder.push(localVersion);
    });
    this.eventIndexesComplete = true;
  }

  private requireItem(itemId: ItemKey): AugmentedCRDTItem {
    return this.items.require(itemId);
  }
}

const inferNextPlaceholderCounter = (
  items: ReadonlyArray<AugmentedCRDTItem>,
): number => {
  let next = 0;
  for (const item of items) {
    const serial =
      item.external !== undefined
        ? placeholderSerialOf(item.external.id)
        : item.agent === PLACEHOLDER_AGENT
          ? item.sequence
          : -1;
    if (serial >= next) {
      next = serial + 1;
    }
  }
  return next;
};

/** Whether two versions hold the same event IDs. */
const versionSetsEqual = (
  left: ReadonlySet<EventId>,
  right: ReadonlySet<EventId>,
): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }
  return true;
};
