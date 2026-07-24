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
  getBranchPreservingTopologicalOrder as computeBranchPreservingTopologicalOrder,
  getTopologicalOrder as computeTopologicalOrder,
} from "./internals/topological-order";

export {
  EventAlreadyExistsError,
  MissingParentError,
} from "./event-graph-errors";

const EMPTY_EVENT_IDS: ReadonlySet<EventId> = new Set();

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
  /** Events appended after the immutable packed prefix. */
  private readonly events: Map<EventId, GraphEvent> = new Map();
  /** Mutable-tail events indexed by insertion rank relative to packed base. */
  private readonly tailEventsByInsertionRank: GraphEvent[] = [];
  /** Maximum parent insertion rank for each mutable-tail event. */
  private readonly maximumParentInsertionRanks: number[] = [];
  /** Mutable-tail children, including tail children of packed parents. */
  private readonly childrenMap: Map<EventId, Set<EventId>> = new Map();
  private readonly frontier: Set<EventId> = new Set();
  /**
   * Monotonically increasing rank assigned to each event in the order it was
   * inserted into the graph. Because `addEvent` rejects events whose parents
   * are not already present, `insertionRank(parent) < insertionRank(child)`
   * for every edge, so the rank is a valid (cheap) topological index that
   * does not require a full Kahn pass to compute.
   */
  private readonly insertionRank: Map<EventId, number> = new Map();
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
  }

  /**
   * Remove all events and metadata from the graph.
   */
  clear(): void {
    this.packedBase = null;
    this.events.clear();
    this.tailEventsByInsertionRank.length = 0;
    this.maximumParentInsertionRanks.length = 0;
    this.childrenMap.clear();
    this.insertionRank.clear();
    this.frontier.clear();
    this.metadata = {};
    this.invalidateDerivedCaches();
  }

  /**
   * Open an append-only transaction. Rollback removes only events appended
   * after this call; the normal success path is constant-time.
   */
  beginAppendTransaction(): EventGraphAppendTransaction {
    const startingEventCount = this.events.size;
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
    if (this.hasEvent(event.id)) {
      throw new EventAlreadyExistsError(event.id);
    }

    let maximumParentInsertionRank = -1;
    for (const parentId of event.parentVersion) {
      const parentRank = this.insertionRankOf(parentId);
      if (parentRank === undefined) {
        throw new MissingParentError(parentId);
      }
      maximumParentInsertionRank = Math.max(
        maximumParentInsertionRank,
        parentRank,
      );
    }

    // Strict causal batches construct final storage objects in an opaque
    // builder, so no caller can mutate them after transfer. All ordinary
    // events retain the public defensive-copy boundary.
    const stored = isOwnedCausalEvent(event) ? event : cloneGraphEvent(event);
    this.events.set(stored.id, stored);
    this.insertionRank.set(
      stored.id,
      (this.packedBase?.count ?? 0) + this.insertionRank.size,
    );
    this.tailEventsByInsertionRank.push(stored);
    this.maximumParentInsertionRanks.push(maximumParentInsertionRank);
    this.frontier.add(stored.id);

    for (const parentId of stored.parentVersion) {
      const children = this.childrenMap.get(parentId) ?? new Set();
      children.add(stored.id);
      this.childrenMap.set(parentId, children);
      this.frontier.delete(parentId);
    }

    this.invalidateDerivedCaches();
  }

  private rollbackAppendedEvents(startingEventCount: number): void {
    const appended = Array.from(this.events.keys()).slice(startingEventCount);
    for (let index = appended.length - 1; index >= 0; index--) {
      const eventId = appended[index]!;
      const parents =
        this.events.get(eventId)?.parentVersion ?? EMPTY_EVENT_IDS;

      this.frontier.delete(eventId);
      this.childrenMap.delete(eventId);
      this.insertionRank.delete(eventId);
      this.events.delete(eventId);
      this.tailEventsByInsertionRank.pop();
      this.maximumParentInsertionRanks.pop();

      for (const parentId of parents) {
        const siblings = this.childrenMap.get(parentId);
        siblings?.delete(eventId);
        if (siblings !== undefined && siblings.size === 0) {
          this.childrenMap.delete(parentId);
          const baseChildCount = this.packedBaseChildCount(parentId);
          if (baseChildCount === 0 && this.hasEvent(parentId)) {
            this.frontier.add(parentId);
          }
        }
      }
    }
    this.invalidateDerivedCaches();
  }

  /**
   * Get an event by ID
   */
  getEvent(id: EventId): GraphEvent | undefined {
    const event = this.events.get(id);
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
    const event = this.events.get(id);
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
    return this.events.has(id) || (this.packedBase?.has(id) ?? false);
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
    return (this.packedBase?.count ?? 0) + this.events.size;
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
      tailIndex < this.maximumParentInsertionRanks.length;
      tailIndex++
    ) {
      if (
        this.maximumParentInsertionRanks[tailIndex]! >= checkpointEventCount
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
    for (const id of this.events.keys()) {
      const parsed = parseEventId(id);
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
      this.events.size !== 0 ||
      !this.packedBase.isExactLinear()
    ) {
      return null;
    }
    return this.packedBase;
  }

  /** @internal Return numeric packed-DAG columns for allocation-light replay. */
  getPackedReplayPlanningView(): PackedReplayPlanningView | null {
    if (this.packedBase === null || this.events.size !== 0) {
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
    for (const event of this.events.values()) {
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
    for (const event of this.events.values()) {
      yield cloneGraphEvent(event);
    }
  }

  /** Stream event IDs without reconstructing operations or parent sets. */
  *iterateEventIdsInInsertionOrder(): IterableIterator<EventId> {
    if (this.packedBase !== null) yield* this.packedBase.iterateIds();
    yield* this.events.keys();
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
    for (const event of this.events.values()) {
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
    if (this.packedBase !== null && this.events.size === 0) {
      return this.packedBase.diffVersions(left, right);
    }
    return diffVersionSets(left, right, {
      getParents: (id) => this.iterateParents(id),
      hasEvent: (id) => this.hasEvent(id),
      insertionRankOf: (id) => this.insertionRankOf(id),
    });
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

    if (this.packedBase !== null && this.events.size === 0) {
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
    if (this.packedBase?.has(id)) {
      yield* this.packedBase.iterateChildren(id);
    }
    yield* this.childrenMap.get(id) ?? EMPTY_EVENT_IDS;
  }

  /**
   * Get parents of an event
   */
  getParents(id: EventId): ReadonlySet<EventId> {
    return new Set(this.iterateParents(id));
  }

  /** Allocation-free parent traversal that does not expose the backing set. */
  iterateParents(id: EventId): IterableIterator<EventId> {
    const event = this.events.get(id);
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

  private requireStoredEvent(id: EventId): GraphEvent {
    const tail = this.events.get(id);
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
    const tail = this.events.get(id);
    if (tail !== undefined) return tail.parentVersion.size;
    const offset = this.packedBase?.offsetOf(id);
    return offset === undefined ? 0 : this.packedBase!.parentCountAt(offset);
  }

  private insertionRankOf(id: EventId): number | undefined {
    const baseRank = this.packedBase?.offsetOf(id);
    return baseRank ?? this.insertionRank.get(id);
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
