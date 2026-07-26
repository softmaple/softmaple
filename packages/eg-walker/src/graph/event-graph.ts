/**
 * Event graph management for Section 3.1
 *
 * The event graph is the only persistent storage besides plain text.
 * No CRDT metadata is stored here.
 */

import { OPERATION_TYPE } from "../constants/operation-types";
import { isOwnedCausalEvent } from "../core/causal-event-batch";
import type {
  EventId,
  ExternalOperation,
  GraphEvent,
  SerializedGraphInput,
  SerializedGraphOutput,
} from "../types";
import {
  EventAlreadyExistsError,
  MissingParentError,
} from "./event-graph-errors";
import { parseEventId } from "./event-id";
import { diffVersions as diffVersionSets } from "./internals/diff-versions";
import { deserializeEventGraph } from "./internals/event-graph-serialization";
import type {
  PackedLocalVersionTransition,
  PackedOffsetTransition,
} from "./internals/packed-diff-versions";
import {
  buildPackedLinearEventGraphBase,
  PackedEventGraphBase,
  type PackedBranchReplayLayout,
  type PackedCanonicalIdRun,
} from "./internals/packed-event-graph-base";
import {
  RankedDiffVersionsWorkspace,
  type RankedDiffVersionsView,
  type RankedVersionTransition,
} from "./internals/ranked-diff-versions";
import {
  getBranchPreservingTopologicalOrder as computeBranchPreservingTopologicalOrder,
  getTopologicalOrder as computeTopologicalOrder,
} from "./internals/topological-order";
import {
  RankedReplayOrderWorkspace,
  type RankedReplayOrderView,
} from "./internals/ranked-replay-order";

export {
  EventAlreadyExistsError,
  MissingParentError,
} from "./event-graph-errors";

const EMPTY_EVENT_IDS: ReadonlySet<EventId> = new Set();

type TailChildInsertionRanks = number | number[];

export interface EventGraphAppendTransaction {
  commit(): void;
  rollback(): void;
}

/** Allocation-free column access used only by exact-linear cold replay. */
export interface PackedLinearReplayView {
  readonly count: number;
  idAt(offset: number): EventId | undefined;
  canonicalIdRunAt?(offset: number): PackedCanonicalIdRun | undefined;
  operationAt(offset: number): ExternalOperation;
  isInsertAt(offset: number): boolean;
  operationIndexAt(offset: number): number;
  operationLengthAt(offset: number): number;
  insertStartAt(offset: number): number;
  sliceInsertedContent(start: number, end: number): string;
}

/**
 * Numeric access to an immutable packed DAG used by cold replay planning.
 *
 * Offsets are insertion/topological ranks. Keeping edges numeric lets the
 * planner use typed arrays instead of rebuilding one string-keyed Map, Set,
 * parent Set, and GraphEvent wrapper per persisted event.
 */
export interface PackedReplayPlanningView extends PackedLinearReplayView {
  offsetOf(id: EventId): number | undefined;
  getBranchPreservingOrderOffsets(): Uint32Array;
  buildBranchPreservingCriticalReplayLayout(): PackedBranchReplayLayout;
  eventAt(offset: number): GraphEvent | undefined;
  parentCountAt(offset: number): number;
  parentOffsetAt(offset: number, parentIndex: number): number | undefined;
  childCountAt(offset: number): number;
  childOffsetAt(offset: number, childIndex: number): number | undefined;
  diffVersionToParents(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
    rankByOffset?: Uint32Array,
  ): PackedOffsetTransition;
  diffVersionToParentRanges(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
    rankByOffset?: Uint32Array,
  ): PackedLocalVersionTransition;
  diffOffsetToParents(
    currentOffset: number,
    targetEventOffset: number,
    rankByOffset?: Uint32Array,
  ): PackedOffsetTransition;
  diffOffsetToParentRanges(
    currentOffset: number,
    targetEventOffset: number,
    rankByOffset?: Uint32Array,
  ): PackedLocalVersionTransition;
}

/**
 * Event graph for storing operation history
 * This is what gets persisted to disk
 */
export class EventGraph {
  private packedBase: PackedEventGraphBase | null = null;
  /**
   * Relative tail index for events appended after the immutable packed prefix.
   *
   * The event payload already lives in `tailEventsByInsertionRank`; keeping a
   * second ID -> GraphEvent Map duplicated every tail entry and forced the
   * graph to maintain a separate ID -> insertion-rank Map.
   */
  private readonly tailIndexById: Map<EventId, number> = new Map();
  /** Mutable-tail events indexed by insertion rank relative to packed base. */
  private readonly tailEventsByInsertionRank: GraphEvent[] = [];
  /**
   * Parent-rank descriptor per mutable-tail event.
   *
   * `-1` is a root, non-negative values are sole-parent ranks, and values
   * below `-1` encode a start in `multiParentInsertionRanks`.
   */
  private readonly parentRankDescriptors: number[] = [];
  /** Flat `[maximumRank, ...parentRanks]` blocks for multi-parent events. */
  private readonly multiParentInsertionRanks: number[] = [];
  /** Reused by object-only numeric version diffs; nested calls lease a spare. */
  private readonly rankedDiffWorkspace = new RankedDiffVersionsWorkspace();
  private rankedDiffWorkspaceInUse = false;
  private readonly rankedReplayOrderWorkspace =
    new RankedReplayOrderWorkspace();
  private rankedReplayOrderWorkspaceInUse = false;
  /**
   * Numeric mutable-tail children, including tail children of packed parents.
   *
   * Nearly all paper-trace nodes have one child. Store that rank directly and
   * promote to an array only at a real branch, avoiding one Set allocation
   * (and one repeated child ID reference) per linear event.
   */
  private readonly tailChildrenByTailIndex: Array<
    TailChildInsertionRanks | undefined
  > = [];
  /** Tail children of immutable packed parents, keyed by packed offset. */
  private readonly tailChildrenByPackedParentRank: Map<
    number,
    TailChildInsertionRanks
  > = new Map();
  private readonly frontier: Set<EventId> = new Set();
  /**
   * Stable callback table shared by numeric object-tail traversals.
   *
   * Keeping this object for the graph lifetime avoids allocating a view and
   * four capturing closures for every conflicting event.
   */
  private readonly rankedTraversalView: RankedDiffVersionsView &
    RankedReplayOrderView = {
    eventCount: () => this.tailEventsByInsertionRank.length,
    insertionRankOf: (id) => this.tailIndexById.get(id),
    eventIdAt: (rank) => this.tailEventsByInsertionRank[rank]?.id,
    forEachParentRank: (rank, visit) =>
      this.forEachTailParentInsertionRank(rank, visit),
    forEachChildRank: (rank, visit) =>
      this.forEachTailChildInsertionRank(rank, visit),
  };
  private metadata: Record<string, unknown> = {};
  /**
   * Memoized output of {@link getTopologicalOrder}. Invalidated whenever the
   * graph is mutated (currently {@link addEvent} and {@link clear}). The
   * cached array is frozen so callers cannot accidentally corrupt the cache
   * by mutating the returned reference.
   *
   * Multiple replay paths request the topological order on every mutation:
   * `EgWalkerEngine.reset`, `PartialReplayManager.replayFromCheckpoint`,
   * `EgWalkerReplica.fullReplay`, the columnar codec encoder, and
   * `CriticalVersionAnalyzer.latestCriticalVersion`. Caching it turns those
   * O(N log N) recomputations into O(1) lookups while the graph is stable.
   */
  private cachedTopologicalOrder: ReadonlyArray<GraphEvent> | null = null;
  /** Memoized output of {@link getBranchPreservingTopologicalOrder}. */
  private cachedBranchPreservingOrder: ReadonlyArray<GraphEvent> | null = null;

  /**
   * Drop all derived caches. Must be called from every mutator so that
   * subsequent reads recompute against the new graph state.
   */
  private invalidateDerivedCaches(): void {
    this.cachedTopologicalOrder = null;
    this.cachedBranchPreservingOrder = null;
    this.packedBase?.releaseDiffWorkspace();
  }

  /**
   * Release materialized traversal orders without changing graph contents.
   *
   * A full replay consumes a branch-preserving order once and can then drop
   * it; retaining cloned event/parent objects for a large persisted history
   * would otherwise nearly duplicate the graph's resident memory. Future
   * callers rebuild and cache the order lazily.
   */
  releaseTraversalCaches(): void {
    this.invalidateDerivedCaches();
    this.rankedDiffWorkspace.release();
    this.rankedReplayOrderWorkspace.release();
  }

  /**
   * Remove all events and metadata from the graph.
   */
  clear(): void {
    this.packedBase = null;
    this.tailIndexById.clear();
    this.tailEventsByInsertionRank.length = 0;
    this.parentRankDescriptors.length = 0;
    this.multiParentInsertionRanks.length = 0;
    this.rankedDiffWorkspace.release();
    this.rankedReplayOrderWorkspace.release();
    this.tailChildrenByTailIndex.length = 0;
    this.tailChildrenByPackedParentRank.clear();
    this.frontier.clear();
    this.metadata = {};
    this.invalidateDerivedCaches();
  }

  /**
   * Open an append-only transaction. Rollback removes only events appended
   * after this call; the normal success path is constant-time.
   */
  beginAppendTransaction(): EventGraphAppendTransaction {
    const startingEventCount = this.tailEventsByInsertionRank.length;
    const startingFrontier = Array.from(this.frontier);
    let active = true;
    return {
      commit: (): void => {
        active = false;
      },
      rollback: (): void => {
        if (!active) {
          return;
        }
        active = false;
        this.rollbackAppendedEvents(startingEventCount);
        this.frontier.clear();
        for (const eventId of startingFrontier) {
          this.frontier.add(eventId);
        }
      },
    };
  }

  /**
   * Add an event to the graph
   */
  addEvent(event: GraphEvent): void {
    if (
      this.tailIndexById.has(event.id) ||
      (this.packedBase?.has(event.id) ?? false)
    ) {
      throw new EventAlreadyExistsError(event.id);
    }

    let multiParentStart = -1;
    let maximumParentInsertionRank = -1;
    let firstParentInsertionRank = -1;
    let parentCount = 0;
    // Strict causal batches construct final storage objects in an opaque
    // builder, so no caller can mutate them after transfer. All ordinary
    // events cross the defensive-copy boundary before sidecars are derived,
    // ensuring a custom/re-entrant parent iterable is consumed only once.
    const stored = isOwnedCausalEvent(event) ? event : cloneGraphEvent(event);
    try {
      for (const parentId of stored.parentVersion) {
        const parentRank = this.insertionRankOf(parentId);
        if (parentRank === undefined) {
          throw new MissingParentError(parentId);
        }
        maximumParentInsertionRank = Math.max(
          maximumParentInsertionRank,
          parentRank,
        );
        parentCount++;
        if (parentCount === 1) {
          firstParentInsertionRank = parentRank;
        } else if (parentCount === 2) {
          multiParentStart = this.multiParentInsertionRanks.length;
          this.multiParentInsertionRanks.push(
            -1,
            firstParentInsertionRank,
            parentRank,
          );
        } else if (parentCount > 2) {
          this.multiParentInsertionRanks.push(parentRank);
        }
      }
    } catch (error) {
      if (multiParentStart !== -1) {
        this.multiParentInsertionRanks.length = multiParentStart;
      }
      throw error;
    }

    let parentRankDescriptor = maximumParentInsertionRank;
    if (parentCount > 1) {
      this.multiParentInsertionRanks[multiParentStart] =
        maximumParentInsertionRank;
      parentRankDescriptor = encodeMultiParentStart(multiParentStart);
    }
    const tailIndex = this.tailEventsByInsertionRank.length;
    const insertionRank = (this.packedBase?.count ?? 0) + tailIndex;
    this.tailIndexById.set(stored.id, tailIndex);
    this.tailEventsByInsertionRank.push(stored);
    this.tailChildrenByTailIndex.push(undefined);
    this.parentRankDescriptors.push(parentRankDescriptor);
    this.frontier.add(stored.id);

    let parentIndex = 0;
    for (const parentId of stored.parentVersion) {
      const parentRank =
        parentCount === 1
          ? maximumParentInsertionRank
          : this.multiParentInsertionRanks[multiParentStart + 1 + parentIndex];
      if (parentRank === undefined) {
        throw new Error(`Event graph is missing parent rank for ${stored.id}`);
      }
      this.appendTailChildRank(parentRank, insertionRank);
      this.frontier.delete(parentId);
      parentIndex++;
    }
    this.invalidateDerivedCaches();
  }

  private rollbackAppendedEvents(startingEventCount: number): void {
    const packedCount = this.packedBase?.count ?? 0;
    while (this.tailEventsByInsertionRank.length > startingEventCount) {
      const tailIndex = this.tailEventsByInsertionRank.length - 1;
      const event = this.tailEventsByInsertionRank[tailIndex]!;
      const eventId = event.id;
      const insertionRank = packedCount + tailIndex;
      const parentRankDescriptor = this.parentRankDescriptors[tailIndex] ?? -1;

      this.frontier.delete(eventId);
      if (this.tailChildrenByTailIndex[tailIndex] !== undefined) {
        throw new Error(
          `Event graph rollback found retained child of ${eventId}`,
        );
      }
      this.tailChildrenByTailIndex.pop();
      this.tailIndexById.delete(eventId);
      this.tailEventsByInsertionRank.pop();

      let parentIndex = 0;
      for (const parentId of event.parentVersion) {
        const parentRank =
          event.parentVersion.size === 1
            ? parentRankDescriptor
            : this.multiParentInsertionRanks[
                decodeMultiParentStart(parentRankDescriptor) + 1 + parentIndex
              ];
        if (parentRank === undefined || parentRank < 0) {
          throw new Error(`Event graph is missing parent rank for ${eventId}`);
        }
        if (this.removeLastTailChildRank(parentRank, insertionRank)) {
          const baseChildCount = this.packedBaseChildCount(parentId);
          if (baseChildCount === 0 && this.hasEvent(parentId)) {
            this.frontier.add(parentId);
          }
        }
        parentIndex++;
      }

      this.parentRankDescriptors.pop();
      if (parentRankDescriptor < -1) {
        this.multiParentInsertionRanks.length =
          decodeMultiParentStart(parentRankDescriptor);
      }
    }
    this.invalidateDerivedCaches();
  }

  /**
   * Get an event by ID
   */
  getEvent(id: EventId): GraphEvent | undefined {
    const event = this.tailEventById(id);
    if (event !== undefined) {
      return cloneGraphEvent(event);
    }
    const offset = this.packedBase?.offsetOf(id);
    return offset === undefined ? undefined : this.packedBase?.eventAt(offset);
  }

  /**
   * Return an event's operation kind without cloning its operation or parents.
   *
   * `undefined` distinguishes a missing event from a stored DELETE event.
   */
  isInsertEvent(id: EventId): boolean | undefined {
    const event = this.tailEventById(id);
    if (event !== undefined) {
      return event.operation.type === OPERATION_TYPE.INSERT;
    }
    const offset = this.packedBase?.offsetOf(id);
    return offset === undefined
      ? undefined
      : this.packedBase!.isInsertAt(offset);
  }

  /**
   * Check if an event exists in the graph
   */
  hasEvent(id: EventId): boolean {
    return this.tailIndexById.has(id) || (this.packedBase?.has(id) ?? false);
  }

  /**
   * Get all events
   */
  getAllEvents(): ReadonlyArray<GraphEvent> {
    return Array.from(this.iterateEventsInInsertionOrder());
  }

  /**
   * Number of events currently stored in the graph.
   *
   * Prefer this over `getAllEvents().length` on hot paths because it avoids
   * materialising a new array.
   */
  getEventCount(): number {
    return (
      (this.packedBase?.count ?? 0) + this.tailEventsByInsertionRank.length
    );
  }

  /**
   * Report the object-tail adjacency shape without exposing its storage.
   *
   * @internal Structural tests use this to ensure linear histories do not
   * regress to allocating one child container per event.
   */
  getObjectTailStructureStats(): {
    readonly tailEvents: number;
    readonly parentEntries: number;
    readonly branchArrays: number;
    readonly childEdges: number;
  } {
    let branchArrays = 0;
    let childEdges = 0;
    let parentEntries = 0;
    const countChildren = (
      childRanks: TailChildInsertionRanks | undefined,
    ): void => {
      if (childRanks === undefined) {
        return;
      }
      parentEntries++;
      if (typeof childRanks === "number") {
        childEdges++;
      } else {
        branchArrays++;
        childEdges += childRanks.length;
      }
    };
    for (const childRanks of this.tailChildrenByTailIndex) {
      countChildren(childRanks);
    }
    for (const childRanks of this.tailChildrenByPackedParentRank.values()) {
      countChildren(childRanks);
    }
    return {
      tailEvents: this.tailEventsByInsertionRank.length,
      parentEntries,
      branchArrays,
      childEdges,
    };
  }

  /**
   * Check that every event in an insertion-rank suffix descends from every
   * frontier event of a trusted critical checkpoint.
   *
   * @internal The critical version's closure is exactly the prefix before the
   * cut. While validation remains successful, one parent after the cut proves
   * the next event descends from the whole frontier. If all parents are inside
   * the cut, every frontier event must be a direct parent because frontier
   * events are maximal within their own closure.
   */
  isInsertionSuffixDominatedBy(
    version: ReadonlySet<EventId>,
    checkpointEventCount: number,
    validatedEventCount: number,
  ): boolean {
    const eventCount = this.getEventCount();
    if (
      !Number.isSafeInteger(checkpointEventCount) ||
      !Number.isSafeInteger(validatedEventCount) ||
      checkpointEventCount <= 0 ||
      validatedEventCount < checkpointEventCount ||
      validatedEventCount > eventCount ||
      version.size === 0
    ) {
      return false;
    }

    const frontierRanks: number[] = [];
    let latestFrontierRank = -1;
    for (const frontierId of version) {
      const frontierRank = this.insertionRankOf(frontierId);
      if (frontierRank === undefined || frontierRank >= checkpointEventCount) {
        return false;
      }
      frontierRanks.push(frontierRank);
      latestFrontierRank = Math.max(latestFrontierRank, frontierRank);
    }
    if (latestFrontierRank !== checkpointEventCount - 1) {
      return false;
    }

    const packedCount = this.packedBase?.count ?? 0;
    const packedStart = Math.max(validatedEventCount, checkpointEventCount);
    if (this.packedBase !== null && packedStart < packedCount) {
      for (let offset = packedStart; offset < packedCount; offset++) {
        const parentCount = this.packedBase.parentCountAt(offset);
        let maximumParentRank = -1;
        for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
          maximumParentRank = Math.max(
            maximumParentRank,
            this.packedBase.parentOffsetAt(offset, parentIndex) ?? -1,
          );
        }
        if (
          maximumParentRank < checkpointEventCount &&
          !this.packedEventHasEveryParent(offset, frontierRanks)
        ) {
          return false;
        }
      }
    }

    const tailStart = Math.max(validatedEventCount, packedCount) - packedCount;
    for (
      let tailIndex = tailStart;
      tailIndex < this.parentRankDescriptors.length;
      tailIndex++
    ) {
      if (
        this.maximumParentInsertionRankAt(tailIndex) >= checkpointEventCount
      ) {
        continue;
      }
      const parents = this.tailEventsByInsertionRank[tailIndex]?.parentVersion;
      if (
        parents === undefined ||
        parents.size < version.size ||
        !setContainsEvery(parents, version)
      ) {
        return false;
      }
    }
    return true;
  }

  private packedEventHasEveryParent(
    eventOffset: number,
    requiredParentOffsets: ReadonlyArray<number>,
  ): boolean {
    const base = this.packedBase;
    if (base === null) {
      return false;
    }
    const parentCount = base.parentCountAt(eventOffset);
    if (parentCount < requiredParentOffsets.length) {
      return false;
    }
    for (const requiredOffset of requiredParentOffsets) {
      let found = false;
      for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
        if (base.parentOffsetAt(eventOffset, parentIndex) === requiredOffset) {
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  }

  /** @internal Return the greatest canonical sequence for one replica. */
  getMaximumSequenceForReplica(replicaId: string): number | null {
    let maximum = this.packedBase?.maximumSequenceForReplica(replicaId);
    for (const event of this.tailEventsByInsertionRank) {
      const parsed = parseEventId(event.id);
      if (
        parsed?.replicaId === replicaId &&
        (maximum === undefined || parsed.sequence > maximum)
      ) {
        maximum = parsed.sequence;
      }
    }
    return maximum ?? null;
  }

  /** @internal Return raw packed columns when the whole graph is one chain. */
  getPackedLinearReplayView(): PackedLinearReplayView | null {
    if (
      this.packedBase === null ||
      this.tailEventsByInsertionRank.length !== 0 ||
      !this.packedBase.isExactLinear()
    ) {
      return null;
    }
    return this.packedBase;
  }

  /** @internal Return numeric packed-DAG columns for allocation-light replay. */
  getPackedReplayPlanningView(): PackedReplayPlanningView | null {
    if (
      this.packedBase === null ||
      this.tailEventsByInsertionRank.length !== 0
    ) {
      return null;
    }
    return this.packedBase;
  }

  /**
   * Return insertion order when the complete graph is one exact causal chain.
   *
   * `addEvent` guarantees insertion order is topological. Detecting the
   * single-parent chain directly avoids building Kahn/DFS traversal state for
   * the common persisted single-author case. Returned events are detached
   * copies, preserving the graph's external immutability contract.
   */
  getLinearReplayOrder(): ReadonlyArray<GraphEvent> | null {
    if (!this.isExactLinearHistory()) {
      return null;
    }
    return Object.freeze(Array.from(this.iterateEventsInInsertionOrder()));
  }

  /**
   * Test whether insertion order is the graph's one exact causal chain
   * without materialising any `GraphEvent` or parent `Set` objects.
   */
  isExactLinearHistory(): boolean {
    if (this.packedBase !== null && !this.packedBase.isExactLinear()) {
      return false;
    }
    let previousId: EventId | null = null;
    if (this.packedBase !== null && this.packedBase.count > 0) {
      previousId = this.packedBase.idAt(this.packedBase.count - 1) ?? null;
    }
    for (const event of this.tailEventsByInsertionRank) {
      if (previousId === null) {
        if (event.parentVersion.size !== 0) {
          return false;
        }
      } else if (
        event.parentVersion.size !== 1 ||
        !event.parentVersion.has(previousId)
      ) {
        return false;
      }
      previousId = event.id;
    }

    return true;
  }

  /**
   * Stream detached events in insertion order. Unlike `getAllEvents`, this
   * lets exact-linear replay consume a packed graph one event at a time and
   * avoids retaining an O(N) array of materialised event objects.
   */
  *iterateEventsInInsertionOrder(): IterableIterator<GraphEvent> {
    if (this.packedBase !== null) {
      yield* this.packedBase.iterateEvents();
    }
    for (const event of this.tailEventsByInsertionRank) {
      yield cloneGraphEvent(event);
    }
  }

  /** Stream event IDs without reconstructing operations or parent sets. */
  *iterateEventIdsInInsertionOrder(): IterableIterator<EventId> {
    if (this.packedBase !== null) yield* this.packedBase.iterateIds();
    for (const event of this.tailEventsByInsertionRank) {
      yield event.id;
    }
  }

  /**
   * Validate events not already proven well-formed by the strict packed
   * decoder. The mutable tail is always visited; ordinary object-backed
   * graphs visit their complete history.
   */
  validateStoredEvents(validate: (event: GraphEvent) => void): void {
    // PackedEventGraphBase construction checks every persisted field,
    // including numeric bounds, UTF-16 slices, IDs and causal parent edges.
    // Reconstructing those events here would repeat the same work on every
    // lazy snapshot access.
    for (const event of this.tailEventsByInsertionRank) {
      validate(cloneGraphEvent(event));
    }
  }

  /**
   * Store non-CRDT persistence metadata alongside the graph.
   */
  setMetadata(metadata: Record<string, unknown>): void {
    this.metadata = { ...metadata };
  }

  /**
   * Read persistence metadata without exposing mutable internal state.
   */
  getMetadata(): Record<string, unknown> {
    return { ...this.metadata };
  }

  /**
   * Get the frontier version: events with no known children.
   */
  getFrontier(): Set<EventId> {
    return new Set(this.frontier);
  }

  /**
   * Expand a frontier version to the set of all events it causally includes.
   */
  expandVersion(version: ReadonlySet<EventId>): Set<EventId> {
    const expanded = new Set<EventId>();
    const stack: EventId[] = Array.from(version);

    while (stack.length > 0) {
      const eventId = stack.pop()!;
      if (expanded.has(eventId)) {
        continue;
      }

      if (!this.hasEvent(eventId)) {
        continue;
      }

      expanded.add(eventId);
      for (const parentId of this.iterateParents(eventId)) {
        if (!expanded.has(parentId)) {
          stack.push(parentId);
        }
      }
    }

    return expanded;
  }

  /**
   * Compute Appendix B's transitive version diff.
   *
   * Uses a local, merge-base style traversal instead of expanding both
   * versions to their full causal sets. Events from both frontiers are
   * coloured (`LEFT`, `RIGHT`, or `COMMON`) and walked toward their
   * ancestors in descending topological order via a max-heap keyed by
   * insertion rank. Each event has its colour merged with the colours of
   * its visited descendants, so once an event is popped its final colour
   * is known and it can be classified into `onlyInLeft`, `onlyInRight`, or
   * discarded as common.
   *
   * Traversal terminates as soon as every event still in the heap has been
   * resolved to `COMMON`, which means the divergent region has been fully
   * enumerated and any remaining ancestors are guaranteed to be shared.
   * For a deep linear history with a small divergent branch this avoids
   * touching unrelated history, replacing the previous O(|history|)
   * full-expansion behaviour with cost proportional to the diff region.
   */
  diffVersions(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
  ): { readonly onlyInLeft: Set<EventId>; readonly onlyInRight: Set<EventId> } {
    if (
      this.packedBase !== null &&
      this.tailEventsByInsertionRank.length === 0
    ) {
      return this.packedBase.diffVersions(left, right);
    }
    if (this.packedBase === null) {
      const workspace = this.rankedDiffWorkspaceInUse
        ? new RankedDiffVersionsWorkspace()
        : this.rankedDiffWorkspace;
      const ownsPrimaryWorkspace = workspace === this.rankedDiffWorkspace;
      if (ownsPrimaryWorkspace) {
        this.rankedDiffWorkspaceInUse = true;
      }
      try {
        return workspace.diff(left, right, this.rankedTraversalView);
      } finally {
        if (ownsPrimaryWorkspace) {
          this.rankedDiffWorkspaceInUse = false;
        }
      }
    }
    return diffVersionSets(left, right, {
      getParents: (id) => this.iterateParents(id),
      hasEvent: (id) => this.hasEvent(id),
      insertionRankOf: (id) => this.insertionRankOf(id),
    });
  }

  /**
   * Structural work performed by the most recent object-only version diff.
   *
   * @internal Tests and benchmarks use this instead of wall-clock assertions
   * to ensure a short divergent suffix does not walk the shared history.
   */
  getLastObjectDiffTraversalCount(): number {
    return this.rankedDiffWorkspace.lastVisitedRankCount;
  }

  /**
   * Return an object-only version transition in insertion-topological order.
   *
   * @internal Packed and mixed graphs retain their storage-specific diff
   * paths and return `null`.
   */
  getRankedVersionTransition(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
  ): RankedVersionTransition | null {
    if (this.packedBase !== null) {
      return null;
    }
    const workspace = this.rankedDiffWorkspaceInUse
      ? new RankedDiffVersionsWorkspace()
      : this.rankedDiffWorkspace;
    const ownsPrimaryWorkspace = workspace === this.rankedDiffWorkspace;
    if (ownsPrimaryWorkspace) {
      this.rankedDiffWorkspaceInUse = true;
    }
    try {
      return workspace.diffOrdered(left, right, this.rankedTraversalView);
    } finally {
      if (ownsPrimaryWorkspace) {
        this.rankedDiffWorkspaceInUse = false;
      }
    }
  }

  /**
   * Return a numeric branch-preserving order for an object-only suffix.
   *
   * @internal Packed and packed-plus-tail graphs return `null` so callers can
   * retain their existing storage-specific fallback.
   */
  getRankedReplayOrder(
    replayEventIds: ReadonlySet<EventId>,
  ): ReadonlyArray<EventId> | null {
    if (this.packedBase !== null) {
      return null;
    }
    const workspace = this.rankedReplayOrderWorkspaceInUse
      ? new RankedReplayOrderWorkspace()
      : this.rankedReplayOrderWorkspace;
    const ownsPrimaryWorkspace = workspace === this.rankedReplayOrderWorkspace;
    if (ownsPrimaryWorkspace) {
      this.rankedReplayOrderWorkspaceInUse = true;
    }
    try {
      return workspace.order(replayEventIds, this.rankedTraversalView);
    } finally {
      if (ownsPrimaryWorkspace) {
        this.rankedReplayOrderWorkspaceInUse = false;
      }
    }
  }

  /**
   * Get events in topological order (Kahn's algorithm; iterative).
   *
   * Sorts ties by numeric-aware event id via {@link compareEventIds}
   * for deterministic output. This is the default order consumed by
   * `EgWalkerEngine`, `ReplayWalker`, `PartialReplayManager`,
   * `EgWalkerReplica.fullReplay`, and the columnar codec; its
   * byte-for-byte output is part of the package's public contract.
   *
   * The engine is now traversal-order independent
   * ({@link getBranchPreservingTopologicalOrder} yields the same
   * document text), but this Kahn ordering is kept as the default
   * so existing on-disk columnar bytes do not change. For a layout
   * that minimises retreat/advance churn, see
   * {@link getBranchPreservingTopologicalOrder}.
   */
  getTopologicalOrder(): ReadonlyArray<GraphEvent> {
    if (this.cachedTopologicalOrder !== null) {
      return this.cachedTopologicalOrder;
    }

    this.cachedTopologicalOrder = Object.freeze(
      computeTopologicalOrder(this.topologicalOrderView()).map((id) =>
        cloneReadonlyGraphEvent(this.requireStoredEvent(id)),
      ),
    );
    return this.cachedTopologicalOrder;
  }

  /**
   * Branch-preserving topological order (Section 5.2 of the
   * Eg-walker paper).
   *
   * Kahn's algorithm with a sorted ready queue interleaves concurrent
   * branches whenever a child event lex-sorts after a deferred sibling
   * root, which forces the replay engine to retreat and re-advance on
   * every transition. This DFS variant walks one branch as far as
   * possible before starting another, so two consecutive events in
   * the output usually share a parent relationship
   * (`next.parentVersion === {prev.id}`) and
   * `diffVersions(currentVersion, next.parentVersion)` collapses to
   * an empty retreat/advance pair.
   *
   * The output is still a fully deterministic function of the graph. Short
   * concurrent branches use exclusive span while long asynchronous branches
   * use longest causal path, so the most expensive branch remains applied at
   * a merge point; numeric-aware event IDs break equal-score ties.
   *
   * `EgWalkerEngine.generate` is traversal-order independent for
   * concurrent inserts (YATA-style integration scan anchored against
   * the parent-version view), so either this order or
   * {@link getTopologicalOrder} produces the same document text.
   * The runtime replay paths
   * ({@link EgWalkerReplica.fullReplay},
   * {@link PartialReplayManager.replayFromCheckpoint}) use this
   * branch-preserving order to minimise retreat/advance churn, while
   * the columnar codec keeps using {@link getTopologicalOrder} (Kahn)
   * so on-disk bytes stay stable across runs.
   *
   */
  getBranchPreservingTopologicalOrder(): ReadonlyArray<GraphEvent> {
    if (this.cachedBranchPreservingOrder !== null) {
      return this.cachedBranchPreservingOrder;
    }

    if (
      this.packedBase !== null &&
      this.tailEventsByInsertionRank.length === 0
    ) {
      const offsets = this.packedBase.getBranchPreservingOrderOffsets();
      this.cachedBranchPreservingOrder = Object.freeze(
        Array.from(offsets, (offset) =>
          readonlyPackedGraphEvent(this.packedBase!, offset),
        ),
      );
      return this.cachedBranchPreservingOrder;
    }

    this.cachedBranchPreservingOrder = Object.freeze(
      computeBranchPreservingTopologicalOrder(this.topologicalOrderView()).map(
        (id) => cloneReadonlyGraphEvent(this.requireStoredEvent(id)),
      ),
    );
    return this.cachedBranchPreservingOrder;
  }

  /**
   * Get children of an event
   */
  getChildren(id: EventId): ReadonlySet<EventId> {
    return new Set(this.iterateChildren(id));
  }

  /** Allocation-free child traversal that does not expose the backing set. */
  *iterateChildren(id: EventId): IterableIterator<EventId> {
    const packedBase = this.packedBase;
    const packedOffset = packedBase?.offsetOf(id);
    let childRanks: TailChildInsertionRanks | undefined;
    if (packedBase !== null && packedOffset !== undefined) {
      yield* packedBase.iterateChildren(id);
      childRanks = this.tailChildrenByPackedParentRank.get(packedOffset);
    } else {
      const tailIndex = this.tailIndexById.get(id);
      childRanks =
        tailIndex === undefined
          ? undefined
          : this.tailChildrenByTailIndex[tailIndex];
    }
    if (childRanks === undefined) {
      return;
    }
    if (typeof childRanks === "number") {
      yield this.requireTailEventIdAtInsertionRank(childRanks);
      return;
    }
    for (const childRank of childRanks) {
      yield this.requireTailEventIdAtInsertionRank(childRank);
    }
  }

  /**
   * Get parents of an event
   */
  getParents(id: EventId): ReadonlySet<EventId> {
    return new Set(this.iterateParents(id));
  }

  /** Allocation-free parent traversal that does not expose the backing set. */
  iterateParents(id: EventId): IterableIterator<EventId> {
    const event = this.tailEventById(id);
    if (event !== undefined) {
      return event.parentVersion.values();
    }
    return this.packedBase?.iterateParents(id) ?? EMPTY_EVENT_IDS.values();
  }

  /**
   * Check if one event is an ancestor of another
   */
  isAncestor(ancestor: EventId, descendant: EventId): boolean {
    if (ancestor === descendant) return false;

    const visited = new Set<EventId>();
    const stack = [descendant];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const parents = this.iterateParents(current);
      for (const parent of parents) {
        if (parent === ancestor) return true;
        stack.push(parent);
      }
    }

    return false;
  }

  /**
   * Find concurrent events (not causally related)
   */
  areConcurrent(id1: EventId, id2: EventId): boolean {
    return (
      !this.isAncestor(id1, id2) && !this.isAncestor(id2, id1) && id1 !== id2
    );
  }

  /**
   * Serialize event graph for persistence
   * Returns only the data that should be saved to disk
   */
  serialize(): SerializedGraphOutput {
    const events = this.getAllEvents();
    return {
      version: Array.from(this.getFrontier()),
      events: events.map((e) => ({
        ...e,
        parentVersion: Array.from(e.parentVersion),
      })),
      metadata: { ...this.metadata },
    };
  }

  /**
   * Build an EventGraph from an unordered array of in-memory events.
   * Topologically sorts via Kahn's algorithm so callers do not need to
   * pre-sort. Throws if the input contains unresolvable parent references.
   */
  static fromEvents(events: ReadonlyArray<GraphEvent>): EventGraph {
    const version = new Set(events.map(({ id }) => id));
    for (const event of events) {
      for (const parent of event.parentVersion) version.delete(parent);
    }
    return EventGraph.deserialize({ version, events });
  }

  /**
   * Deserialize event graph from persistence (Kahn's algorithm; O(n)).
   */
  static deserialize(data: SerializedGraphInput): EventGraph {
    return deserializeEventGraph(data, () => new EventGraph());
  }

  /** @internal Build a graph around an immutable, already validated prefix. */
  static fromPackedBase(
    base: PackedEventGraphBase,
    frontier: ReadonlySet<EventId>,
    metadata: Record<string, unknown> = {},
  ): EventGraph {
    const graph = new EventGraph();
    for (const id of frontier) {
      if (!base.has(id)) {
        throw new Error(`Packed graph frontier contains unknown event ${id}`);
      }
      graph.frontier.add(id);
    }
    graph.packedBase = base;
    graph.metadata = { ...metadata };
    return graph;
  }

  /** @internal Adopt builder-owned events as one immutable packed chain. */
  static fromOwnedLinearEvents(
    events: ReadonlyArray<GraphEvent>,
    metadata: Record<string, unknown> = {},
  ): EventGraph {
    const packed = buildPackedLinearEventGraphBase(events);
    return EventGraph.fromPackedBase(packed.base, packed.frontier, metadata);
  }

  private tailEventById(id: EventId): GraphEvent | undefined {
    const tailIndex = this.tailIndexById.get(id);
    return tailIndex === undefined
      ? undefined
      : this.tailEventsByInsertionRank[tailIndex];
  }

  private requireTailEventIdAtInsertionRank(rank: number): EventId {
    const tailIndex = rank - (this.packedBase?.count ?? 0);
    const eventId = this.tailEventsByInsertionRank[tailIndex]?.id;
    if (eventId === undefined) {
      throw new Error(`Event graph is missing tail insertion rank ${rank}`);
    }
    return eventId;
  }

  private appendTailChildRank(parentRank: number, childRank: number): void {
    const packedCount = this.packedBase?.count ?? 0;
    const tailIndex = parentRank - packedCount;
    const existing =
      tailIndex >= 0
        ? this.tailChildrenByTailIndex[tailIndex]
        : this.tailChildrenByPackedParentRank.get(parentRank);
    if (existing === undefined) {
      if (tailIndex >= 0) {
        this.tailChildrenByTailIndex[tailIndex] = childRank;
      } else {
        this.tailChildrenByPackedParentRank.set(parentRank, childRank);
      }
    } else if (typeof existing === "number") {
      const promoted = [existing, childRank];
      if (tailIndex >= 0) {
        this.tailChildrenByTailIndex[tailIndex] = promoted;
      } else {
        this.tailChildrenByPackedParentRank.set(parentRank, promoted);
      }
    } else {
      existing.push(childRank);
    }
  }

  /**
   * Remove the newest tail child and return whether no tail children remain.
   *
   * Append transactions rollback the global tail in reverse insertion order,
   * so each parent adjacency is also unwound in strict LIFO order.
   */
  private removeLastTailChildRank(
    parentRank: number,
    childRank: number,
  ): boolean {
    const packedCount = this.packedBase?.count ?? 0;
    const tailIndex = parentRank - packedCount;
    const existing =
      tailIndex >= 0
        ? this.tailChildrenByTailIndex[tailIndex]
        : this.tailChildrenByPackedParentRank.get(parentRank);
    if (existing === undefined) {
      throw new Error(`Event graph is missing child rank ${childRank}`);
    }
    if (typeof existing === "number") {
      if (existing !== childRank) {
        throw new Error(
          `Event graph child rollback order mismatch for rank ${parentRank}`,
        );
      }
      if (tailIndex >= 0) {
        this.tailChildrenByTailIndex[tailIndex] = undefined;
      } else {
        this.tailChildrenByPackedParentRank.delete(parentRank);
      }
      return true;
    }

    if (existing[existing.length - 1] !== childRank) {
      throw new Error(
        `Event graph child rollback order mismatch for rank ${parentRank}`,
      );
    }
    existing.pop();
    if (existing.length === 0) {
      if (tailIndex >= 0) {
        this.tailChildrenByTailIndex[tailIndex] = undefined;
      } else {
        this.tailChildrenByPackedParentRank.delete(parentRank);
      }
      return true;
    }
    if (existing.length === 1) {
      if (tailIndex >= 0) {
        this.tailChildrenByTailIndex[tailIndex] = existing[0]!;
      } else {
        this.tailChildrenByPackedParentRank.set(parentRank, existing[0]!);
      }
    }
    return false;
  }

  private requireStoredEvent(id: EventId): GraphEvent {
    const tail = this.tailEventById(id);
    if (tail !== undefined) return tail;
    const offset = this.packedBase?.offsetOf(id);
    const event =
      offset === undefined ? undefined : this.packedBase?.eventAt(offset);
    if (event === undefined) {
      throw new Error(`Event graph is missing event ${id}`);
    }
    return event;
  }

  private parentCountOf(id: EventId): number {
    const tail = this.tailEventById(id);
    if (tail !== undefined) return tail.parentVersion.size;
    const offset = this.packedBase?.offsetOf(id);
    return offset === undefined ? 0 : this.packedBase!.parentCountAt(offset);
  }

  private insertionRankOf(id: EventId): number | undefined {
    const baseRank = this.packedBase?.offsetOf(id);
    if (baseRank !== undefined) {
      return baseRank;
    }
    const tailIndex = this.tailIndexById.get(id);
    return tailIndex === undefined
      ? undefined
      : (this.packedBase?.count ?? 0) + tailIndex;
  }

  private maximumParentInsertionRankAt(tailIndex: number): number {
    const descriptor = this.parentRankDescriptors[tailIndex] ?? -1;
    return descriptor >= -1
      ? descriptor
      : (this.multiParentInsertionRanks[decodeMultiParentStart(descriptor)] ??
          -1);
  }

  private forEachTailParentInsertionRank(
    tailIndex: number,
    visit: (parentRank: number) => void,
  ): void {
    const descriptor = this.parentRankDescriptors[tailIndex] ?? -1;
    if (descriptor === -1) {
      return;
    }
    if (descriptor >= 0) {
      visit(descriptor);
      return;
    }

    const event = this.tailEventsByInsertionRank[tailIndex];
    if (event === undefined) {
      throw new Error(
        `Event graph is missing tail insertion rank ${tailIndex}`,
      );
    }
    const start = decodeMultiParentStart(descriptor);
    const end = start + 1 + event.parentVersion.size;
    for (let index = start + 1; index < end; index++) {
      const parentRank = this.multiParentInsertionRanks[index];
      if (parentRank === undefined) {
        throw new Error(
          `Event graph is missing parent rank for tail insertion rank ${tailIndex}`,
        );
      }
      visit(parentRank);
    }
  }

  private forEachTailChildInsertionRank(
    tailIndex: number,
    visit: (childRank: number) => void,
  ): void {
    if (this.tailEventsByInsertionRank[tailIndex] === undefined) {
      throw new Error(
        `Event graph is missing tail insertion rank ${tailIndex}`,
      );
    }
    const childRanks = this.tailChildrenByTailIndex[tailIndex];
    if (typeof childRanks === "number") {
      visit(childRanks);
      return;
    }
    for (const childRank of childRanks ?? []) {
      visit(childRank);
    }
  }

  private packedBaseChildCount(id: EventId): number {
    const offset = this.packedBase?.offsetOf(id);
    return offset === undefined ? 0 : this.packedBase!.childCountAt(offset);
  }

  private topologicalOrderView(): Parameters<
    typeof computeTopologicalOrder
  >[0] {
    return {
      eventCount: this.getEventCount(),
      eventIds: this.iterateEventIdsInInsertionOrder(),
      parentCountOf: (id) => this.parentCountOf(id),
      childrenOf: (id) => this.iterateChildren(id),
    };
  }
}

const encodeMultiParentStart = (start: number): number => -start - 2;

const decodeMultiParentStart = (descriptor: number): number => -descriptor - 2;

const setContainsEvery = <T>(
  values: ReadonlySet<T>,
  required: ReadonlySet<T>,
): boolean => {
  for (const value of required) {
    if (!values.has(value)) {
      return false;
    }
  }
  return true;
};

const cloneGraphEvent = (event: GraphEvent): GraphEvent => ({
  id: event.id,
  operation: { ...event.operation },
  parentVersion: new Set(event.parentVersion),
  timestamp: event.timestamp,
});

const cloneReadonlyGraphEvent = (event: GraphEvent): GraphEvent =>
  Object.freeze({
    id: event.id,
    operation: Object.freeze({ ...event.operation }),
    parentVersion: runtimeReadonlySet(event.parentVersion),
    timestamp: event.timestamp,
  });

const readonlyPackedGraphEvent = (
  base: PackedEventGraphBase,
  offset: number,
): GraphEvent => {
  const id = base.idAt(offset);
  const timestamp = base.timestampAt(offset);
  if (id === undefined || timestamp === undefined) {
    throw new Error(`Packed event graph is missing event at offset ${offset}`);
  }
  return Object.freeze({
    id,
    operation: Object.freeze(base.operationAt(offset)),
    parentVersion: runtimeReadonlySet(base.iterateParentsAt(offset)),
    timestamp,
  });
};

/**
 * A Set-compatible immutable view whose rejecting mutators live once on the
 * prototype. Defining three own properties on every materialised traversal
 * event was a measurable part of cold replay for large packed histories.
 */
class RuntimeReadonlySet<T> extends Set<T> {
  constructor(values: Iterable<T>) {
    super();
    for (const value of values) {
      Set.prototype.add.call(this, value);
    }
    Object.freeze(this);
  }

  override add(): this {
    return rejectReadonlySetMutation();
  }

  override delete(): boolean {
    return rejectReadonlySetMutation();
  }

  override clear(): void {
    rejectReadonlySetMutation();
  }
}

const runtimeReadonlySet = <T>(values: Iterable<T>): ReadonlySet<T> =>
  new RuntimeReadonlySet(values);

const rejectReadonlySetMutation = (): never => {
  throw new TypeError("Cannot mutate a read-only event graph view");
};
