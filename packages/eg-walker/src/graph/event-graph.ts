/**
 * Event graph management for Section 3.1
 *
 * The event graph is the only persistent storage besides plain text.
 * No CRDT metadata is stored here.
 */

import type {
  EventId,
  ExternalOperation,
  GraphEvent,
  SerializedGraphInput,
  SerializedGraphOutput,
  Version,
} from "../types";
import {
  EventAlreadyExistsError,
  MissingParentError,
} from "./event-graph-errors";
import { canonicalSequenceAfter } from "./event-id";
import type { CausalBatchColumns } from "./internals/causal-batch-columns";
import { AgentTable } from "./internals/agent-table";
import { CUSTOM_AGENT } from "./internals/event-id-run-index";
import type { GraphRuns } from "./internals/graph-runs";
import { deserializeEventGraph } from "./internals/event-graph-serialization";
import type {
  PackedLocalVersionTransition,
  PackedOffsetTransition,
} from "./internals/packed-diff-versions";
import {
  PackedEventGraphBase,
  type PackedBranchReplayLayout,
  type PackedCanonicalIdRun,
  type PackedKeystrokeRun,
  type PackedTailEvents,
} from "./internals/packed-event-graph-base";
import {
  PackedLinearChain,
  type LinearEventBatch,
  type PackedLinearChainRange,
} from "./internals/packed-linear-chain";
import { buildPackedSuffixView } from "./internals/packed-suffix-view";
import {
  RankedDiffVersionsWorkspace,
  type LocalVersionTransition,
  type RankedRangeDiffView,
  type RankedVersionTransition,
} from "./internals/ranked-diff-versions";
import {
  RankedReplayOrderWorkspace,
  type RankedReplayOrderView,
} from "./internals/ranked-replay-order";
import type { Steps } from "./internals/steps";
import type { SealedOperationColumns } from "./internals/sealed-operation-columns";
import { NO_RANK, TailEventLog } from "./internals/tail-event-log";
import {
  encodeTopologicallyOrderedEventsBinary,
  encodeTopologicalColumnsBinary,
  type TopologicalColumnSource,
  type TopologicalEventGraphEncoding,
} from "./columnar-codec/topological-binary-encoder";

export {
  EventAlreadyExistsError,
  MissingParentError,
} from "./event-graph-errors";

type TailChildInsertionRanks = number | number[];

export interface EventGraphAppendTransaction {
  commit(): void;
  rollback(): void;
}

/**
 * One critical section of the events after a critical version.
 *
 * @internal Returned by {@link EventGraph.planInsertionSuffixSections}.
 */
export interface InsertionSuffixSection {
  /** Insertion rank of the section's first event. */
  readonly start: number;
  /** Insertion rank after its last event: the closure size of its end cut. */
  readonly end: number;
  /** Whether the section is one causal chain starting at `baseFrontier`. */
  readonly linear: boolean;
  /** The critical version the section starts from. */
  readonly baseFrontier: ReadonlySet<EventId>;
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
  /** The graph's edges as runs of consecutive local versions. */
  readonly runs: GraphRuns;
  offsetOf(id: EventId): number | undefined;
  /** Agent of the event at an offset, or `-1` for a non-canonical ID. */
  agentAt(offset: number): number;
  sequenceAt(offset: number): number;
  /**
   * Describe the run of one author's one-character inserts with consecutive
   * sequences that starts at `offset`, walked by `direction` towards
   * `limit`. See {@link PackedEventGraphBase.keystrokeRunAt}.
   */
  keystrokeRunAt(
    offset: number,
    limit: number,
    direction: 1 | -1,
    run: PackedKeystrokeRun,
  ): boolean;
  getBranchPreservingOrderOffsets(): Uint32Array;
  buildBranchPreservingCriticalReplayLayout(): PackedBranchReplayLayout;
  buildBranchPreservingCriticalReplayLayoutSteps(
    runsPerStep: number,
  ): Steps<PackedBranchReplayLayout>;
  eventAt(offset: number): GraphEvent | undefined;
  parentCountAt(offset: number): number;
  parentOffsetAt(offset: number, parentIndex: number): number | undefined;
  childCountAt(offset: number): number;
  childOffsetAt(offset: number, childIndex: number): number | undefined;
  diffVersionToParents(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedOffsetTransition;
  diffVersionToParentRanges(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedLocalVersionTransition;
  diffLocalVersionsToParentRanges(
    currentOffsets: ReadonlyArray<number>,
    targetEventOffset: number,
  ): PackedLocalVersionTransition;
  diffOffsetToParents(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedOffsetTransition;
  diffOffsetToParentRanges(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedLocalVersionTransition;
}

/**
 * Event graph for storing operation history
 * This is what gets persisted to disk
 */
export class EventGraph {
  private packedBase: PackedEventGraphBase | null = null;
  /**
   * Growable columns behind {@link packedBase} while the whole graph is one
   * exact causal chain appended through {@link appendLinearBatch}.
   */
  private linearChain: PackedLinearChain | null = null;
  /**
   * Transient repack of {@link packedBase}, if any, and the mutable tail,
   * built when a cold replay plans a graph that has a tail. Dropped on every
   * mutation.
   */
  private repackedBase: PackedEventGraphBase | null = null;
  /**
   * Replica numbering shared by the packed prefix, the tail and every replay
   * engine that works on this graph. It is the packed prefix's table when
   * the graph has one, so agent numbers agree across the two.
   */
  private agents = new AgentTable();
  /**
   * Events appended after the immutable packed prefix, as columns. Tail index
   * `i` is insertion rank `packedCount + i`, which is also the event's local
   * version: ranks are dense and never change once assigned.
   */
  private tail = new TailEventLog(this.agents);
  /** Reused by numeric version diffs; nested calls lease a spare. */
  private readonly rankedDiffWorkspace = new RankedDiffVersionsWorkspace();
  private rankedDiffWorkspaceInUse = false;
  private readonly rankedReplayOrderWorkspace =
    new RankedReplayOrderWorkspace();
  private rankedReplayOrderWorkspaceInUse = false;
  /** Tail children of immutable packed parents, keyed by packed offset. */
  private readonly tailChildrenByPackedParentRank: Map<
    number,
    TailChildInsertionRanks
  > = new Map();
  /**
   * Insertion ranks of the events with no known children, each mapped to
   * when it became a frontier event. Iteration follows that order.
   */
  private readonly frontier: Map<number, number> = new Map();
  private frontierEntryCount = 0;
  /**
   * The frontier's IDs in frontier order. Built on first use, then updated
   * in place with every frontier change and never replaced, so
   * {@link getFrontierView} can hand out the set itself.
   */
  private frontierIds: Set<EventId> | null = null;
  /**
   * Frontier changes made while an append transaction is open, as pairs:
   * `(rank, -1)` for a rank that joined the frontier, `(rank, entry)` for a
   * rank that left it. Rollback undoes them instead of restoring a copy of
   * the whole frontier taken when the transaction began.
   */
  private readonly frontierJournal: number[] = [];
  private openAppendTransactions = 0;
  /** Parent ranks of the event being appended. */
  private readonly parentRankScratch: number[] = [];
  /** The caller's ID of each parent in {@link parentRankScratch}. */
  private readonly parentIdScratch: EventId[] = [];
  /**
   * IDs and ranks of the last few events appended. An appended event's
   * parents are nearly always among them, so resolving a parent is usually a
   * string comparison against the ID object the caller passed before.
   */
  private readonly recentIds: Array<EventId | null> = [null, null, null, null];
  private readonly recentRanks = [0, 0, 0, 0];
  private recentCursor = 0;
  /**
   * Stable callback table shared by numeric traversals over insertion ranks.
   *
   * Packed events keep their packed offsets as ranks and tail events follow
   * them, so one view covers object-only, packed-only and packed-plus-tail
   * graphs without falling back to string-keyed traversal. Keeping this
   * object for the graph lifetime avoids allocating a view and four
   * capturing closures for every conflicting event.
   */
  private readonly rankedTraversalView: RankedRangeDiffView &
    RankedReplayOrderView = {
    eventCount: () => this.getEventCount(),
    insertionRankOf: (id) => this.insertionRankOf(id),
    eventIdAt: (rank) => this.eventIdAtInsertionRank(rank),
    forEachParentRank: (rank, visit) =>
      this.forEachParentInsertionRank(rank, visit),
    forEachChildRank: (rank, visit) =>
      this.forEachChildInsertionRank(rank, visit),
    chainStartOf: (rank) => this.chainStartOfInsertionRank(rank),
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
    this.repackedBase = null;
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

  /** Release dense operation columns after a large, committed receive. */
  compactEventColumns(sealed?: SealedOperationColumns): void {
    if (this.openAppendTransactions !== 0) return;
    this.tail.trimCapacity();
    if (this.packedBase === null) return;
    if (this.linearChain !== null) this.linearChain.compactOperations(sealed);
    else this.packedBase.compactOperations(sealed);
  }

  /**
   * Remove all events and metadata from the graph.
   */
  clear(): void {
    this.forgetAppended();
    this.packedBase = null;
    this.linearChain = null;
    this.agents = new AgentTable();
    this.tail = new TailEventLog(this.agents);
    this.rankedDiffWorkspace.release();
    this.rankedReplayOrderWorkspace.release();
    this.tailChildrenByPackedParentRank.clear();
    // The events are gone, so their IDs cannot be resolved for the journal;
    // an open transaction cannot be rolled back across a clear anyway.
    this.frontier.clear();
    this.frontierIds?.clear();
    this.frontierJournal.length = 0;
    this.metadata = {};
    this.invalidateDerivedCaches();
  }

  /**
   * Open an append-only transaction. Rollback removes only events appended
   * after this call; the normal success path is constant-time.
   */
  beginAppendTransaction(): EventGraphAppendTransaction {
    const startingEventCount = this.tail.count;
    const startingJournalLength = this.frontierJournal.length;
    const startingPackedBase = this.packedBase;
    const startingAgents = this.agents;
    const startingTail = this.tail;
    const startingLinearChain = this.linearChain;
    const startingLinearChainMark = startingLinearChain?.mark() ?? null;
    let active = true;
    this.openAppendTransactions++;
    return {
      commit: (): void => {
        if (!active) {
          return;
        }
        active = false;
        this.closeAppendTransaction();
      },
      rollback: (): void => {
        if (!active) {
          return;
        }
        active = false;
        // Undo the frontier while every appended event can still name its ID.
        this.undoFrontierChanges(startingJournalLength);
        this.closeAppendTransaction();
        // Tail ranks follow the packed prefix, so unwind the tail first.
        this.rollbackAppendedEvents(startingEventCount);
        if (this.packedBase !== startingPackedBase) {
          this.forgetAppended();
          if (startingLinearChainMark !== null) {
            startingLinearChain!.rollbackTo(startingLinearChainMark);
          }
          this.linearChain = startingLinearChain;
          this.packedBase = startingPackedBase;
          this.agents = startingAgents;
          this.tail = startingTail;
          this.invalidateDerivedCaches();
        }
      },
    };
  }

  private closeAppendTransaction(): void {
    this.openAppendTransactions--;
    if (this.openAppendTransactions === 0) {
      this.frontierJournal.length = 0;
    }
  }

  /**
   * Undo the frontier changes journaled after `journalLength`, newest first.
   * A rank that left the frontier comes back at its old place: the frontier
   * is put back in entry order, which only a failed append pays for.
   */
  private undoFrontierChanges(journalLength: number): void {
    const journal = this.frontierJournal;
    let restoredRank = false;
    for (let index = journal.length - 2; index >= journalLength; index -= 2) {
      const rank = journal[index]!;
      const entry = journal[index + 1]!;
      if (entry < 0) {
        this.frontier.delete(rank);
        this.frontierIds?.delete(this.requireEventIdAtInsertionRank(rank));
      } else {
        this.frontier.set(rank, entry);
        this.frontierIds?.add(this.requireEventIdAtInsertionRank(rank));
        restoredRank = true;
      }
    }
    journal.length = journalLength;
    if (restoredRank) {
      this.reorderFrontierByEntry();
    }
  }

  private reorderFrontierByEntry(): void {
    const entries = Array.from(this.frontier).sort(
      (left, right) => left[1] - right[1],
    );
    this.frontier.clear();
    for (const [rank, entry] of entries) {
      this.frontier.set(rank, entry);
    }
    const ids = this.frontierIds;
    if (ids !== null) {
      ids.clear();
      for (const [rank] of entries) {
        ids.add(this.requireEventIdAtInsertionRank(rank));
      }
    }
  }

  /**
   * Whether {@link appendLinearBatch} can store `batch` as packed columns.
   *
   * @internal The graph must be empty, or be one chain that earlier linear
   * batches built, with no event added through {@link addEvent} since. The
   * batch must extend the frontier and carry integer timestamps.
   */
  canAppendLinearBatch(batch: LinearEventBatch): boolean {
    return (
      batch.hasSafeIntegerTimestamps &&
      this.canAppendLinearEvents(batch.firstParents)
    );
  }

  /**
   * Whether {@link appendLinearEvents} can pack a chain whose first event
   * names `firstParents`.
   *
   * @internal The graph must be empty, or be one chain that earlier linear
   * appends built, with no event added through {@link addEvent} since. The
   * chain must extend the frontier.
   */
  canAppendLinearEvents(firstParents: ReadonlySet<EventId>): boolean {
    if (this.tail.count !== 0 || !this.isFrontier(firstParents)) {
      return false;
    }
    return this.packedBase === null
      ? this.frontier.size === 0
      : this.linearChain?.latest === this.packedBase;
  }

  /**
   * Append an exact chain that extends the frontier, writing its IDs and
   * operations into packed columns instead of one object per event.
   *
   * @internal Check {@link canAppendLinearBatch} first.
   * @throws EventAlreadyExistsError when an ID is already in the graph. The
   * graph is left unchanged.
   */
  appendLinearBatch(batch: LinearEventBatch): void {
    if (!this.canAppendLinearBatch(batch)) {
      throw new Error("Linear batch does not extend a packed linear graph");
    }
    if (batch.count === 0) {
      return;
    }
    const chain = this.linearChain ?? new PackedLinearChain(this.agents);
    const base = chain.append(batch);
    this.invalidateDerivedCaches();
    this.linearChain = chain;
    this.packedBase = base;
    this.clearFrontier();
    this.addFrontierRank(base.count - 1);
  }

  /**
   * Append the events of an exact chain that extends the frontier straight
   * into packed columns, reading each event once and keeping no event
   * object.
   *
   * @internal Check {@link canAppendLinearEvents} with the first event's
   * parents. Callers validate every field, as for a {@link LinearEventBatch}.
   * @returns the appended events read back from packed columns, valid until
   * the graph changes again, or `null` with the graph unchanged when a
   * timestamp is not a safe integer.
   * @throws EventAlreadyExistsError when an ID is already in the graph. The
   * graph is left unchanged.
   */
  appendLinearEvents(
    events: ReadonlyArray<GraphEvent>,
  ): PackedLinearChainRange | null {
    const first = events[0];
    if (first === undefined) {
      throw new Error("A linear append needs at least one event");
    }
    if (!this.canAppendLinearEvents(first.parentVersion)) {
      throw new Error("Linear events do not extend a packed linear graph");
    }
    const chain = this.linearChain ?? new PackedLinearChain(this.agents);
    const range = chain.appendEvents(events);
    if (range === null) {
      return null;
    }
    this.invalidateDerivedCaches();
    this.linearChain = chain;
    this.packedBase = chain.latest;
    this.clearFrontier();
    this.addFrontierRank(chain.count - 1);
    return range;
  }

  /**
   * Append owned, validated causal columns inside an append transaction.
   * An empty graph adopts the columns; an existing graph remaps batch-local
   * parents and agents without parsing each event and parent ID again.
   * @internal
   */
  appendCausalColumns(batch: CausalBatchColumns): void {
    batch.assertValid();
    const start = this.getEventCount();
    const externalRanks = batch.externalParents.map((id) => {
      const rank = this.insertionRankOf(id);
      if (rank === undefined) throw new MissingParentError(id);
      return rank;
    });
    if (start === 0) {
      const base = batch.packedBase();
      this.invalidateDerivedCaches();
      this.agents = base.agents;
      this.tail = new TailEventLog(this.agents);
      this.packedBase = base;
      this.linearChain = batch.exactChain
        ? PackedLinearChain.adopt(batch, base)
        : null;
      const runs = base.runs;
      for (let run = 0; run < runs.count; run++) {
        if (runs.childCountOf(run) === 0)
          this.addFrontierRank(runs.lastOf(run));
      }
      return;
    }

    if (
      batch.exactChain &&
      this.canAppendLinearEvents(batch.eventAt(0).parentVersion)
    ) {
      this.packedBase = this.linearChain!.appendCausalColumns(batch);
      this.invalidateDerivedCaches();
      this.clearFrontier();
      this.addFrontierRank(this.packedBase.count - 1);
      return;
    }

    const agents = Array.from({ length: batch.ids.agents.size }, (_, agent) =>
      this.agents.intern(batch.ids.agents.nameOf(agent)),
    );
    const parentRanks: number[] = [];
    let explicit = 0;
    for (let offset = 0; offset < batch.count; offset++) {
      const id = batch.idAt(offset)!;
      const sourceAgent = batch.ids.agentAt(offset);
      const agent = sourceAgent < 0 ? CUSTOM_AGENT : agents[sourceAgent]!;
      const sequence = batch.ids.sequenceAt(offset);
      if (this.hasParsedEvent(id, agent, sequence)) {
        throw new EventAlreadyExistsError(id);
      }
      parentRanks.length = 0;
      if (batch.explicit[explicit] === offset) {
        for (
          let edge = batch.parentStarts[explicit]!;
          edge < batch.parentStarts[explicit + 1]!;
          edge++
        ) {
          const parent = batch.parents[edge]!;
          parentRanks.push(
            parent < 0 ? externalRanks[-1 - parent]! : start + parent,
          );
        }
        explicit++;
      } else if (offset > 0) {
        parentRanks.push(start + offset - 1);
      }
      this.tail.append(
        id,
        agent,
        sequence,
        batch.operationAt(offset),
        batch.timestampAt(offset),
        parentRanks,
      );
      const rank = start + offset;
      for (const parent of parentRanks) {
        this.appendTailChildRank(parent, rank);
        this.deleteFrontierRank(parent);
      }
      this.addFrontierRank(rank, id);
    }
    this.forgetAppended();
    this.invalidateDerivedCaches();
  }

  /**
   * Add an event to the graph
   */
  addEvent(event: GraphEvent): void {
    // Every field is copied into the tail's columns, so the caller cannot
    // mutate stored state through its object, and a custom or re-entrant
    // parent iterable is consumed only once.
    this.appendEvent(event);
  }

  /**
   * Add an event this package built and no caller can reach or mutate, such
   * as an event of a strict causal batch.
   *
   * @internal The graph copies every event into columns, so this is the same
   * as {@link addEvent}; it remains for callers that own their events.
   */
  addOwnedEvent(event: GraphEvent): void {
    this.appendEvent(event);
  }

  private appendEvent(event: GraphEvent): void {
    const id = event.id;
    // Parse the ID once: the duplicate check and the append use its agent
    // and sequence instead of parsing the string again.
    const colonIndex = id.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(id, colonIndex);
    const agent =
      sequence < 0 ? CUSTOM_AGENT : this.agents.resolvePrefix(id, colonIndex);
    if (this.hasParsedEvent(id, agent, sequence)) {
      throw new EventAlreadyExistsError(id);
    }

    const parentVersion = event.parentVersion;
    // A plain Set iterates without running caller code, so its parents are
    // resolved in place. Other iterables are copied first: resolving a parent
    // must not be interleaved with caller code that could re-enter the graph.
    const parentIds: Iterable<EventId> =
      Object.getPrototypeOf(parentVersion) === Set.prototype
        ? parentVersion
        : Array.from(parentVersion);
    const inPlace = parentIds === parentVersion;
    const parentRanks = inPlace ? this.parentRankScratch : [];
    // Kept so a parent leaving the frontier need not have its ID formatted.
    const parentIdList = inPlace ? this.parentIdScratch : [];
    parentRanks.length = 0;
    parentIdList.length = 0;
    try {
      for (const parentId of parentIds) {
        const parentRank = this.parentRankOf(parentId);
        if (parentRank === undefined) {
          throw new MissingParentError(parentId);
        }
        if (!parentRanks.includes(parentRank)) {
          parentRanks.push(parentRank);
          parentIdList.push(parentId);
        }
      }
      const tailIndex = this.tail.append(
        id,
        sequence < 0 ? CUSTOM_AGENT : this.agents.internPrefix(id, colonIndex),
        sequence,
        event.operation,
        event.timestamp,
        parentRanks,
      );
      const insertionRank = (this.packedBase?.count ?? 0) + tailIndex;
      for (let index = 0; index < parentRanks.length; index++) {
        const parentRank = parentRanks[index]!;
        this.appendTailChildRank(parentRank, insertionRank);
        this.deleteFrontierRank(parentRank, parentIdList[index]);
      }
      this.addFrontierRank(insertionRank, id);
      this.rememberAppended(id, insertionRank);
    } finally {
      parentRanks.length = 0;
      parentIdList.length = 0;
    }
    this.invalidateDerivedCaches();
  }

  private hasParsedEvent(
    id: EventId,
    agent: number,
    sequence: number,
  ): boolean {
    if (this.packedBase?.hasParsed(id, agent, sequence) === true) {
      return true;
    }
    if (agent >= 0) {
      return this.tail.ids.localVersionOfCanonical(agent, sequence) >= 0;
    }
    // An unknown replica cannot be canonical in the tail, but its ID may
    // still be stored verbatim.
    return this.tail.indexOf(id) >= 0;
  }

  private parentRankOf(parentId: EventId): number | undefined {
    const recentIds = this.recentIds;
    for (let slot = 0; slot < recentIds.length; slot++) {
      if (recentIds[slot] === parentId) {
        return this.recentRanks[slot];
      }
    }
    return this.insertionRankOf(parentId);
  }

  private rememberAppended(id: EventId, rank: number): void {
    const slot = this.recentCursor;
    this.recentIds[slot] = id;
    this.recentRanks[slot] = rank;
    this.recentCursor = (slot + 1) % this.recentIds.length;
  }

  private forgetAppended(): void {
    this.recentIds.fill(null);
    this.recentCursor = 0;
  }

  private rollbackAppendedEvents(startingEventCount: number): void {
    this.forgetAppended();
    const packedCount = this.packedBase?.count ?? 0;
    while (this.tail.count > startingEventCount) {
      const tailIndex = this.tail.count - 1;
      const insertionRank = packedCount + tailIndex;

      if (this.tail.childCountAt(tailIndex) !== 0) {
        throw new Error(
          `Event graph rollback found retained child of ${this.tail.idAt(tailIndex)}`,
        );
      }
      const parentCount = this.tail.parentCountAt(tailIndex);
      for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
        this.removeLastTailChildRank(
          this.tail.parentRankAt(tailIndex, parentIndex),
          insertionRank,
        );
      }
      this.tail.truncate(tailIndex);
    }
    this.invalidateDerivedCaches();
  }

  /**
   * Get an event by ID
   */
  getEvent(id: EventId): GraphEvent | undefined {
    const rank = this.insertionRankOf(id);
    return rank === undefined ? undefined : this.eventAtInsertionRank(rank);
  }

  /**
   * Return an event's operation kind without cloning its operation or parents.
   *
   * `undefined` distinguishes a missing event from a stored DELETE event.
   */
  isInsertEvent(id: EventId): boolean | undefined {
    const rank = this.insertionRankOf(id);
    return rank === undefined ? undefined : this.isInsertAtLocalVersion(rank);
  }

  /**
   * Check if an event exists in the graph
   */
  hasEvent(id: EventId): boolean {
    return (this.packedBase?.has(id) ?? false) || this.tail.indexOf(id) >= 0;
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
    return (this.packedBase?.count ?? 0) + this.tail.count;
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
    const tailStats = this.tail.childStructureStats();
    let branchArrays = tailStats.branchArrays;
    let childEdges = tailStats.childEdges;
    let parentEntries = tailStats.parentEntries;
    for (const childRanks of this.tailChildrenByPackedParentRank.values()) {
      parentEntries++;
      if (typeof childRanks === "number") {
        childEdges++;
      } else {
        branchArrays++;
        childEdges += childRanks.length;
      }
    }
    return {
      tailEvents: this.tail.count,
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
    for (let tailIndex = tailStart; tailIndex < this.tail.count; tailIndex++) {
      if (this.tail.maximumParentRankAt(tailIndex) >= checkpointEventCount) {
        continue;
      }
      if (!this.tailEventHasEveryParent(tailIndex, frontierRanks)) {
        return false;
      }
    }
    return true;
  }

  private tailEventHasEveryParent(
    tailIndex: number,
    requiredParentRanks: ReadonlyArray<number>,
  ): boolean {
    const parentCount = this.tail.parentCountAt(tailIndex);
    if (parentCount < requiredParentRanks.length) {
      return false;
    }
    for (const requiredRank of requiredParentRanks) {
      let found = false;
      for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
        if (this.tail.parentRankAt(tailIndex, parentIndex) === requiredRank) {
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
    const packedMaximum = this.packedBase?.maximumSequenceForReplica(replicaId);
    const tailMaximum = this.tail.maximumSequenceForReplica(replicaId);
    if (packedMaximum === undefined) {
      return tailMaximum ?? null;
    }
    return tailMaximum === undefined
      ? packedMaximum
      : Math.max(packedMaximum, tailMaximum);
  }

  /** @internal Return raw packed columns when the whole graph is one chain. */
  getPackedLinearReplayView(): PackedLinearReplayView | null {
    const packed = this.packedReplayBase();
    return packed !== null && packed.isExactLinear() ? packed : null;
  }

  /**
   * @internal Return numeric packed-DAG columns for allocation-light replay,
   * or `null` for an empty graph.
   *
   * Events appended through {@link addEvent} are packed once for the
   * caller's replay, behind the packed prefix when there is one. A cold
   * replay therefore always plans over numeric insertion ranks: the object
   * planner materialized a frozen copy of every event, and kept string-keyed
   * maps, a slice and two sets per critical section.
   */
  getPackedReplayPlanningView(): PackedReplayPlanningView | null {
    return this.packedReplayBase();
  }

  /**
   * @internal A packed planning view of the events after the first
   * `prefixEventCount` in insertion order, which must end at a critical
   * cut, as a trusted checkpoint's does. View offset `k` is local version
   * `prefixEventCount - 1 + k`; offset 0 stands for the whole prefix. See
   * {@link buildPackedSuffixView}. A partial replay plans and replays the
   * events after its checkpoint over this view, so its cost follows those
   * events instead of the graph.
   *
   * Returns `null` when the graph cannot describe the suffix this way; the
   * caller then replays its events as objects.
   */
  getPackedSuffixReplayView(
    prefixEventCount: number,
  ): PackedReplayPlanningView | null {
    return buildPackedSuffixView(
      {
        agents: this.agents,
        eventCount: this.getEventCount(),
        packedPrefix: this.packedBase,
        tail: this.tail,
        localVersionOf: (id) => this.localVersionOf(id),
        idAtLocalVersion: (localVersion) => this.idAtLocalVersion(localVersion),
        agentAt: (localVersion) => this.agentAt(localVersion),
        sequenceAt: (localVersion) => this.sequenceAt(localVersion),
      },
      prefixEventCount,
    );
  }

  private packedReplayBase(): PackedEventGraphBase | null {
    const packedBase = this.packedBase;
    if (this.tail.count === 0) {
      return packedBase;
    }
    if (this.repackedBase === null) {
      const tail: PackedTailEvents = this.tail;
      this.repackedBase =
        packedBase === null
          ? PackedEventGraphBase.fromTail(tail)
          : packedBase.appendTail(tail);
    }
    return this.repackedBase;
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
    const packedCount = this.packedBase?.count ?? 0;
    let previousRank = packedCount - 1;
    for (let tailIndex = 0; tailIndex < this.tail.count; tailIndex++) {
      const parentCount = this.tail.parentCountAt(tailIndex);
      if (previousRank === NO_RANK) {
        if (parentCount !== 0) {
          return false;
        }
      } else if (
        parentCount !== 1 ||
        this.tail.parentRankAt(tailIndex, 0) !== previousRank
      ) {
        return false;
      }
      previousRank = packedCount + tailIndex;
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
    for (let tailIndex = 0; tailIndex < this.tail.count; tailIndex++) {
      yield this.tailEventAt(tailIndex);
    }
  }

  /** Stream event IDs without reconstructing operations or parent sets. */
  *iterateEventIdsInInsertionOrder(): IterableIterator<EventId> {
    if (this.packedBase !== null) yield* this.packedBase.iterateIds();
    yield* this.tail.iterateIds();
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
    for (let tailIndex = 0; tailIndex < this.tail.count; tailIndex++) {
      validate(this.tailEventAt(tailIndex));
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
    return new Set(this.frontierIdSet());
  }

  /**
   * The frontier version itself rather than a copy, in {@link getFrontier}
   * order.
   *
   * @internal The set is read-only and live: every later change to the graph
   * changes it in place. A caller that needs the frontier as of now after the
   * graph changes again must copy it. Reading it costs nothing per call, so
   * receive paths can track the frontier without copying it per event.
   */
  getFrontierView(): Version {
    return this.frontierIdSet();
  }

  /** Number of frontier events, without formatting their IDs. */
  getFrontierSize(): number {
    return this.frontier.size;
  }

  private frontierIdSet(): Set<EventId> {
    if (this.frontierIds === null) {
      this.frontierIds = new Set();
      for (const rank of this.frontier.keys()) {
        this.frontierIds.add(this.requireEventIdAtInsertionRank(rank));
      }
    }
    return this.frontierIds;
  }

  /** `id`, when given, is the event's ID, so it need not be formatted. */
  private addFrontierRank(rank: number, id?: EventId): void {
    this.frontier.set(rank, this.frontierEntryCount++);
    if (this.openAppendTransactions !== 0) {
      this.frontierJournal.push(rank, -1);
    }
    this.frontierIds?.add(id ?? this.requireEventIdAtInsertionRank(rank));
  }

  /**
   * `id`, when given, is an ID the caller resolved to `rank`. It is tried
   * first, so the stored ID is formatted only if the two differ.
   */
  private deleteFrontierRank(rank: number, id?: EventId): void {
    const entry = this.frontier.get(rank);
    if (entry === undefined) {
      return;
    }
    this.frontier.delete(rank);
    if (this.openAppendTransactions !== 0) {
      this.frontierJournal.push(rank, entry);
    }
    const ids = this.frontierIds;
    if (ids !== null && (id === undefined || !ids.delete(id))) {
      ids.delete(this.requireEventIdAtInsertionRank(rank));
    }
  }

  private clearFrontier(): void {
    if (this.openAppendTransactions !== 0) {
      for (const [rank, entry] of this.frontier) {
        this.frontierJournal.push(rank, entry);
      }
    }
    this.frontier.clear();
    this.frontierIds?.clear();
  }

  /**
   * Whether `version` is exactly the frontier, without formatting IDs.
   *
   * @internal Hot receive paths compare an event's parents with the frontier.
   */
  isFrontier(version: ReadonlySet<EventId>): boolean {
    if (version.size !== this.frontier.size) {
      return false;
    }
    for (const id of version) {
      const rank = this.insertionRankOf(id);
      if (rank === undefined || !this.frontier.has(rank)) {
        return false;
      }
    }
    return true;
  }

  /** @internal Local versions of the frontier events, in frontier order. */
  /**
   * Encode the graph as EGW4 in `getLinearReplayOrder() ??
   * getTopologicalOrder()` order, returning the frontier in `getFrontier()`
   * order.
   *
   * @internal Snapshot writers call this instead of materializing every
   * event; the bytes equal {@link encodeTopologicallyOrderedEventsBinary}
   * over those events. Graphs holding malformed events take that path so
   * they fail with the same errors.
   */
  encodeTopologicalBinary(): TopologicalEventGraphEncoding {
    const metadata = this.getMetadata();
    if (this.tail.hasIrregularEvents()) {
      return encodeTopologicallyOrderedEventsBinary(
        this.getLinearReplayOrder() ?? this.getTopologicalOrder(),
        metadata,
        Array.from(this.getFrontier()),
      );
    }
    const order = this.isExactLinearHistory()
      ? null
      : (this.packedReplayBase()?.getTopologicalOrderOffsets() ??
        new Uint32Array(0));
    return encodeTopologicalColumnsBinary(
      this.topologicalColumnSource(),
      order,
      metadata,
      this.getFrontierLocalVersions(),
    );
  }

  private topologicalColumnSource(): TopologicalColumnSource {
    const packed = this.packedBase;
    const packedCount = packed?.count ?? 0;
    const tail = this.tail;
    const packedStringIds = packed?.hasCustomIds() ?? false;
    return {
      count: this.getEventCount(),
      idAt: (rank) => this.idAtLocalVersion(rank),
      agentAt: (rank) => this.agentAt(rank),
      agentName: (agent) => this.agents.nameOf(agent),
      sequenceAt: (rank) => this.sequenceAt(rank),
      useStringIdAt: (rank) => rank < packedCount && packedStringIds,
      isInsertAt: (rank) =>
        rank < packedCount
          ? packed!.isInsertAt(rank)
          : tail.isInsertAt(rank - packedCount),
      operationIndexAt: (rank) =>
        rank < packedCount
          ? packed!.operationIndexAt(rank)
          : tail.operationIndexAt(rank - packedCount),
      operationLengthAt: (rank) =>
        rank < packedCount
          ? packed!.operationLengthAt(rank)
          : tail.operationLengthAt(rank - packedCount),
      insertedTextAt: (rank) => {
        if (rank < packedCount) {
          const start = packed!.insertStartAt(rank);
          return packed!.sliceInsertedContent(
            start,
            start + packed!.operationLengthAt(rank),
          );
        }
        const tailIndex = rank - packedCount;
        const start = tail.insertStartAt(tailIndex);
        return tail.sliceInsertedContent(
          start,
          start + tail.operationLengthAt(tailIndex),
        );
      },
      timestampAt: (rank) =>
        rank < packedCount
          ? (packed!.timestampAt(rank) ?? Number.NaN)
          : tail.timestampAt(rank - packedCount),
      parentCountAt: (rank) =>
        rank < packedCount
          ? packed!.parentCountAt(rank)
          : tail.parentCountAt(rank - packedCount),
      parentRankAt: (rank, parentIndex) => {
        if (rank >= packedCount) {
          return tail.parentRankAt(rank - packedCount, parentIndex);
        }
        const parent = packed!.parentOffsetAt(rank, parentIndex);
        if (parent === undefined) {
          throw new Error(
            `Packed event ${rank} is missing parent ${parentIndex}`,
          );
        }
        return parent;
      },
    };
  }

  getFrontierLocalVersions(): number[] {
    return Array.from(this.frontier.keys());
  }

  /**
   * Expand a frontier version to the set of all events it causally includes.
   */
  expandVersion(version: ReadonlySet<EventId>): Set<EventId> {
    const expanded = new Set<EventId>();
    const visited = new Set<number>();
    const stack: number[] = [];
    for (const eventId of version) {
      const rank = this.insertionRankOf(eventId);
      if (rank !== undefined) {
        stack.push(rank);
      }
    }
    const pushUnvisited = (parentRank: number): void => {
      if (!visited.has(parentRank)) {
        stack.push(parentRank);
      }
    };

    while (stack.length > 0) {
      const rank = stack.pop()!;
      if (visited.has(rank)) {
        continue;
      }
      visited.add(rank);
      expanded.add(this.requireEventIdAtInsertionRank(rank));
      this.forEachParentInsertionRank(rank, pushUnvisited);
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
    if (this.packedBase !== null && this.tail.count === 0) {
      return this.packedBase.diffVersions(left, right);
    }
    // A packed prefix with a mutable tail stays numeric: one tail event must
    // not send the diff through string-keyed colours and rank lookups.
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

  /**
   * Structural work performed by the most recent ranked version diff, used
   * for object-only and packed-plus-tail graphs.
   *
   * @internal Tests and benchmarks use this instead of wall-clock assertions
   * to ensure a short divergent suffix does not walk the shared history.
   */
  getLastObjectDiffTraversalCount(): number {
    return this.rankedDiffWorkspace.lastVisitedRankCount;
  }

  /**
   * Return a version transition in insertion-topological order.
   *
   * @internal Packed-only graphs keep their offset-based packed diff and
   * return `null`; object-only and packed-plus-tail graphs use insertion
   * ranks.
   */
  getRankedVersionTransition(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
  ): RankedVersionTransition | null {
    if (this.isPackedOnly()) {
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
   * Return the transition between two versions given as local versions.
   *
   * @internal Replay engines keep versions as local versions, so neither
   * side is parsed or formatted. Retreat lists children before parents and
   * advance parents before children, both in insertion-rank order.
   */
  getLocalVersionTransition(
    left: ReadonlyArray<number>,
    right: ReadonlyArray<number>,
  ): LocalVersionTransition {
    const workspace = this.rankedDiffWorkspaceInUse
      ? new RankedDiffVersionsWorkspace()
      : this.rankedDiffWorkspace;
    const ownsPrimaryWorkspace = workspace === this.rankedDiffWorkspace;
    if (ownsPrimaryWorkspace) {
      this.rankedDiffWorkspaceInUse = true;
    }
    try {
      return workspace.diffLocalVersions(left, right, this.rankedTraversalView);
    } finally {
      if (ownsPrimaryWorkspace) {
        this.rankedDiffWorkspaceInUse = false;
      }
    }
  }

  /**
   * {@link getLocalVersionTransition} as ranges of local versions, found by
   * walking causal chains rather than single events.
   *
   * @internal The result is a workspace view, valid until the graph's next
   * version diff. Retreat ranges expand from `end - 1` down to `start` and
   * advance ranges from `start` up to `end - 1`, both in order.
   */
  getLocalVersionRangeTransition(
    left: ReadonlyArray<number>,
    right: ReadonlyArray<number>,
  ): PackedLocalVersionTransition {
    const workspace = this.rankedDiffWorkspaceInUse
      ? new RankedDiffVersionsWorkspace()
      : this.rankedDiffWorkspace;
    const ownsPrimaryWorkspace = workspace === this.rankedDiffWorkspace;
    if (ownsPrimaryWorkspace) {
      this.rankedDiffWorkspaceInUse = true;
    }
    try {
      return workspace.diffLocalVersionRanges(
        left,
        right,
        this.rankedTraversalView,
      );
    } finally {
      if (ownsPrimaryWorkspace) {
        this.rankedDiffWorkspaceInUse = false;
      }
    }
  }

  /**
   * Return a numeric branch-preserving order for a replay suffix.
   *
   * @internal Every graph shape is ordered over insertion ranks, so a
   * partial replay never materializes the suffix's events to sort them.
   */
  getRankedReplayOrder(
    replayEventIds: ReadonlySet<EventId>,
  ): ReadonlyArray<EventId> {
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
   * Materialize the events at insertion ranks `[start, end)` in the
   * branch-preserving order of {@link getRankedReplayOrder}.
   *
   * @internal The range must be convex: every event causally between two of
   * its events is in it too. The events between two critical cuts, or after
   * one, always are.
   */
  getRankedReplayEventsInRange(
    start: number,
    end: number,
  ): ReadonlyArray<GraphEvent> {
    const eventCount = this.getEventCount();
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > eventCount
    ) {
      throw new RangeError(`Invalid insertion rank range ${start}..${end}`);
    }
    const workspace = this.rankedReplayOrderWorkspaceInUse
      ? new RankedReplayOrderWorkspace()
      : this.rankedReplayOrderWorkspace;
    const ownsPrimaryWorkspace = workspace === this.rankedReplayOrderWorkspace;
    if (ownsPrimaryWorkspace) {
      this.rankedReplayOrderWorkspaceInUse = true;
    }
    let ranks: ReadonlyArray<number>;
    try {
      ranks = workspace.orderRange(start, end, this.rankedTraversalView);
    } finally {
      if (ownsPrimaryWorkspace) {
        this.rankedReplayOrderWorkspaceInUse = false;
      }
    }
    return ranks.map((rank) => this.eventAtInsertionRank(rank));
  }

  /** @internal Operation of the event at an insertion rank, as a copy. */
  operationAtInsertionRank(rank: number): ExternalOperation {
    const packedCount = this.packedBase?.count ?? 0;
    if (rank >= 0 && rank < packedCount) {
      return this.packedBase!.operationAt(rank);
    }
    this.assertTailRank(rank);
    return this.tail.operationAt(rank - packedCount);
  }

  /**
   * Split the events after a critical version at the critical cuts among
   * them.
   *
   * @internal `prefixFrontier` must be a critical version whose closure is
   * exactly the first `prefixEventCount` events in insertion order, as for a
   * trusted checkpoint, so every later event descends from it. A critical
   * version's closure is a prefix of every topological order, so scanning
   * insertion ranks finds the same cuts as the branch-preserving planners.
   *
   * A cut is critical when every event that is ready there, meaning its
   * parents are all before the cut, has every frontier event of the prefix
   * as a parent: every later event descends from one of those. The scan keeps
   * the number of missing (frontier event, ready event) parent pairs as
   * {@link planCriticalReplaySections} does, over insertion ranks instead of
   * string-keyed maps. Consecutive sections that are single causal chains
   * are merged into one.
   */
  planInsertionSuffixSections(
    prefixEventCount: number,
    prefixFrontier: ReadonlySet<EventId>,
  ): ReadonlyArray<InsertionSuffixSection> {
    const eventCount = this.getEventCount();
    if (
      !Number.isSafeInteger(prefixEventCount) ||
      prefixEventCount < 0 ||
      prefixEventCount > eventCount
    ) {
      throw new RangeError(`Invalid critical prefix size ${prefixEventCount}`);
    }
    const frontier = new Set<number>();
    for (const eventId of prefixFrontier) {
      const rank = this.insertionRankOf(eventId);
      if (rank === undefined || rank >= prefixEventCount) {
        throw new Error(
          `Critical prefix frontier event ${eventId} is not among the first ${prefixEventCount} events`,
        );
      }
      frontier.add(rank);
    }

    const suffixLength = eventCount - prefixEventCount;
    // An event becomes ready once its latest parent has been passed.
    const latestParentRanks = new Int32Array(suffixLength);
    const suffixCoverage = new Int32Array(suffixLength);
    const prefixCoverage = new Map<number, number>();
    const coverageOf = (rank: number): number =>
      rank >= prefixEventCount
        ? suffixCoverage[rank - prefixEventCount]!
        : (prefixCoverage.get(rank) ?? 0);
    const addCoverage = (rank: number, delta: number): void => {
      if (rank >= prefixEventCount) {
        suffixCoverage[rank - prefixEventCount]! += delta;
        return;
      }
      const next = (prefixCoverage.get(rank) ?? 0) + delta;
      if (next === 0) {
        prefixCoverage.delete(rank);
      } else {
        prefixCoverage.set(rank, next);
      }
    };
    const parents: number[] = [];
    const pushParent = (parentRank: number): void => {
      parents.push(parentRank);
    };
    const parentsInFrontier = (): number => {
      let count = 0;
      for (const parentRank of parents) {
        if (frontier.has(parentRank)) {
          count++;
        }
      }
      return count;
    };

    let readyCount = 0;
    let missingPairs = 0;
    const markReady = (): void => {
      readyCount++;
      missingPairs += frontier.size - parentsInFrontier();
      for (const parentRank of parents) {
        addCoverage(parentRank, 1);
      }
    };
    for (let rank = prefixEventCount; rank < eventCount; rank++) {
      parents.length = 0;
      this.forEachParentInsertionRank(rank, pushParent);
      let latestParentRank = -1;
      for (const parentRank of parents) {
        latestParentRank = Math.max(latestParentRank, parentRank);
      }
      latestParentRanks[rank - prefixEventCount] = latestParentRank;
      if (latestParentRank < prefixEventCount) {
        markReady();
      }
    }

    let passedRank = -1;
    const visitChild = (childRank: number): void => {
      if (latestParentRanks[childRank - prefixEventCount] !== passedRank) {
        return;
      }
      parents.length = 0;
      this.forEachParentInsertionRank(childRank, pushParent);
      markReady();
    };

    // A cut's frontier is a single event on every chain, so bases are kept
    // as that event's rank and copied to an array only when wider.
    const sections: InsertionSuffixSection[] = [];
    let sectionStart = prefixEventCount;
    let sectionBase: number | ReadonlyArray<number> =
      frontier.size === 1 ? frontier.values().next().value! : [...frontier];
    let sectionLinear = true;
    let chainStart = -1;
    let chainBase = sectionBase;
    const versionOf = (base: number | ReadonlyArray<number>): Set<EventId> =>
      typeof base === "number"
        ? new Set([this.requireEventIdAtInsertionRank(base)])
        : new Set(base.map((rank) => this.requireEventIdAtInsertionRank(rank)));
    const flushChain = (end: number): void => {
      if (chainStart === -1) {
        return;
      }
      sections.push({
        start: chainStart,
        end,
        linear: true,
        baseFrontier: versionOf(chainBase),
      });
      chainStart = -1;
    };

    for (let rank = prefixEventCount; rank < eventCount; rank++) {
      parents.length = 0;
      this.forEachParentInsertionRank(rank, pushParent);
      const frontierSize = frontier.size;
      const inFrontier = parentsInFrontier();
      if (rank === sectionStart) {
        sectionLinear =
          parents.length === frontierSize && inFrontier === frontierSize;
      } else if (parents.length !== 1 || parents[0] !== rank - 1) {
        sectionLinear = false;
      }

      // The event leaves the ready set and replaces its parents in the
      // prefix frontier.
      readyCount--;
      missingPairs -= frontierSize - inFrontier;
      for (const parentRank of parents) {
        addCoverage(parentRank, -1);
      }
      for (const parentRank of parents) {
        if (frontier.delete(parentRank)) {
          missingPairs -= readyCount - coverageOf(parentRank);
        }
      }
      frontier.add(rank);
      missingPairs += readyCount - coverageOf(rank);

      passedRank = rank;
      this.forEachChildInsertionRank(rank, visitChild);

      if (readyCount !== 0 && missingPairs !== 0) {
        continue;
      }
      const end = rank + 1;
      if (sectionLinear) {
        if (chainStart === -1) {
          chainStart = sectionStart;
          chainBase = sectionBase;
        }
      } else {
        flushChain(sectionStart);
        sections.push({
          start: sectionStart,
          end,
          linear: false,
          baseFrontier: versionOf(sectionBase),
        });
      }
      sectionStart = end;
      sectionBase = frontier.size === 1 ? rank : [...frontier];
    }
    flushChain(eventCount);
    if (sectionStart !== eventCount) {
      throw new Error("Critical suffix plan did not cover every event");
    }
    return sections;
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

    // Order insertion ranks over the packed planning view's runs, as
    // cold replay does, instead of string-keyed maps and child generators.
    const ranks = this.packedReplayBase()?.getTopologicalOrderOffsets();
    this.cachedTopologicalOrder = Object.freeze(
      ranks === undefined
        ? []
        : Array.from(ranks, (rank) => this.readonlyEventAtInsertionRank(rank)),
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

    const ranks = this.packedReplayBase()?.getBranchPreservingOrderOffsets();
    this.cachedBranchPreservingOrder = Object.freeze(
      ranks === undefined
        ? []
        : Array.from(ranks, (rank) => this.readonlyEventAtInsertionRank(rank)),
    );
    return this.cachedBranchPreservingOrder;
  }

  /**
   * Get children of an event
   */
  getChildren(id: EventId): ReadonlySet<EventId> {
    return new Set(this.iterateChildren(id));
  }

  /**
   * Visit the children of an event without allocating an iterator.
   *
   * @internal Graph traversals call this once per visited event;
   * {@link iterateChildren} is the public convenience API.
   */
  forEachChild(id: EventId, visit: (childId: EventId) => void): void {
    const rank = this.insertionRankOf(id);
    if (rank === undefined) {
      return;
    }
    this.forEachChildInsertionRank(rank, (childRank) =>
      visit(this.requireEventIdAtInsertionRank(childRank)),
    );
  }

  /** Child traversal that does not expose the backing set. */
  *iterateChildren(id: EventId): IterableIterator<EventId> {
    const rank = this.insertionRankOf(id);
    if (rank === undefined) {
      return;
    }
    const childRanks: number[] = [];
    this.forEachChildInsertionRank(rank, (childRank) => {
      childRanks.push(childRank);
    });
    for (const childRank of childRanks) {
      yield this.requireEventIdAtInsertionRank(childRank);
    }
  }

  /**
   * Get parents of an event
   */
  getParents(id: EventId): ReadonlySet<EventId> {
    return new Set(this.iterateParents(id));
  }

  /** Parent traversal that does not expose the backing storage. */
  *iterateParents(id: EventId): IterableIterator<EventId> {
    const rank = this.insertionRankOf(id);
    if (rank === undefined) {
      return;
    }
    const parentRanks: number[] = [];
    this.forEachParentInsertionRank(rank, (parentRank) => {
      parentRanks.push(parentRank);
    });
    for (const parentRank of parentRanks) {
      yield this.requireEventIdAtInsertionRank(parentRank);
    }
  }

  /**
   * Check if one event is an ancestor of another
   */
  isAncestor(ancestor: EventId, descendant: EventId): boolean {
    if (ancestor === descendant) return false;
    const ancestorRank = this.insertionRankOf(ancestor);
    const descendantRank = this.insertionRankOf(descendant);
    if (ancestorRank === undefined || descendantRank === undefined) {
      return false;
    }

    // Parents always have lower insertion ranks than their children, so
    // nothing below the ancestor's rank can lead back up to it.
    const visited = new Set<number>();
    const stack = [descendantRank];
    let found = false;
    const visitParent = (parentRank: number): void => {
      if (parentRank === ancestorRank) {
        found = true;
      } else if (parentRank > ancestorRank && !visited.has(parentRank)) {
        stack.push(parentRank);
      }
    };
    while (stack.length > 0 && !found) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      this.forEachParentInsertionRank(current, visitParent);
    }

    return found;
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
    graph.agents = base.agents;
    graph.tail = new TailEventLog(base.agents);
    for (const id of frontier) {
      const offset = base.offsetOf(id);
      if (offset === undefined) {
        throw new Error(`Packed graph frontier contains unknown event ${id}`);
      }
      graph.addFrontierRank(offset);
    }
    graph.packedBase = base;
    graph.metadata = { ...metadata };
    return graph;
  }

  /**
   * Replica numbering of this graph's canonical event IDs.
   *
   * @internal Replay engines key typed runs by these agent numbers.
   */
  get agentTable(): AgentTable {
    return this.agents;
  }

  /**
   * Local version (insertion rank) of an event, or `-1` when the graph does
   * not contain it. Local versions are dense and never change.
   *
   * @internal
   */
  localVersionOf(id: EventId): number {
    return this.insertionRankOf(id) ?? -1;
  }

  /** @internal ID of the event at a local version. */
  idAtLocalVersion(localVersion: number): EventId {
    return this.requireEventIdAtInsertionRank(localVersion);
  }

  /**
   * @internal Agent of the event at a local version, or `-1` when its ID is
   * not a canonical `replicaId:sequence`.
   */
  agentAt(localVersion: number): number {
    const packedCount = this.packedBase?.count ?? 0;
    if (localVersion >= 0 && localVersion < packedCount) {
      return this.packedBase!.agentAt(localVersion);
    }
    this.assertTailRank(localVersion);
    return this.tail.agentAt(localVersion - packedCount);
  }

  /** @internal Sequence of the event at a local version. */
  sequenceAt(localVersion: number): number {
    const packedCount = this.packedBase?.count ?? 0;
    if (localVersion >= 0 && localVersion < packedCount) {
      return this.packedBase!.sequenceAt(localVersion);
    }
    this.assertTailRank(localVersion);
    return this.tail.sequenceAt(localVersion - packedCount);
  }

  /** @internal Whether the event at a local version inserts text. */
  isInsertAtLocalVersion(localVersion: number): boolean {
    const packedCount = this.packedBase?.count ?? 0;
    if (localVersion >= 0 && localVersion < packedCount) {
      return this.packedBase!.isInsertAt(localVersion);
    }
    this.assertTailRank(localVersion);
    return this.tail.isInsertAt(localVersion - packedCount);
  }

  /**
   * @internal Length of the event's operation at a local version: inserted
   * code units, or deleted ones.
   */
  operationLengthAtLocalVersion(localVersion: number): number {
    const packedCount = this.packedBase?.count ?? 0;
    if (localVersion >= 0 && localVersion < packedCount) {
      return this.packedBase!.operationLengthAt(localVersion);
    }
    this.assertTailRank(localVersion);
    return this.tail.operationLengthAt(localVersion - packedCount);
  }

  /** @internal Visit the parents of the event at a local version. */
  forEachParentLocalVersion(
    localVersion: number,
    visit: (parentLocalVersion: number) => void,
  ): void {
    this.forEachParentInsertionRank(localVersion, visit);
  }

  private isPackedOnly(): boolean {
    return this.packedBase !== null && this.tail.count === 0;
  }

  private eventIdAtInsertionRank(rank: number): EventId | undefined {
    const packedCount = this.packedBase?.count ?? 0;
    if (rank < packedCount) {
      return this.packedBase!.idAt(rank);
    }
    const tailIndex = rank - packedCount;
    return Number.isSafeInteger(tailIndex) && tailIndex < this.tail.count
      ? this.tail.idAt(tailIndex)
      : undefined;
  }

  private assertTailRank(rank: number): void {
    const tailIndex = rank - (this.packedBase?.count ?? 0);
    if (
      !Number.isSafeInteger(tailIndex) ||
      tailIndex < 0 ||
      tailIndex >= this.tail.count
    ) {
      throw new Error(`Event graph is missing insertion rank ${rank}`);
    }
  }

  /** A detached copy of a tail event, as the object API returns it. */
  private tailEventAt(tailIndex: number): GraphEvent {
    const parentVersion = new Set<EventId>();
    this.tail.forEachParentRank(tailIndex, (parentRank) => {
      parentVersion.add(this.requireEventIdAtInsertionRank(parentRank));
    });
    return {
      id: this.tail.idAt(tailIndex),
      operation: this.tail.operationAt(tailIndex),
      parentVersion,
      timestamp: this.tail.timestampAt(tailIndex),
    };
  }

  private requireEventIdAtInsertionRank(rank: number): EventId {
    const eventId = this.eventIdAtInsertionRank(rank);
    if (eventId === undefined) {
      throw new Error(`Event graph is missing insertion rank ${rank}`);
    }
    return eventId;
  }

  private eventAtInsertionRank(rank: number): GraphEvent {
    const packedCount = this.packedBase?.count ?? 0;
    const event =
      rank < packedCount
        ? this.packedBase?.eventAt(rank)
        : this.tailEventAtRank(rank);
    if (event === undefined) {
      throw new Error(`Event graph is missing insertion rank ${rank}`);
    }
    return event;
  }

  private tailEventAtRank(rank: number): GraphEvent | undefined {
    const tailIndex = rank - (this.packedBase?.count ?? 0);
    return Number.isSafeInteger(tailIndex) &&
      tailIndex >= 0 &&
      tailIndex < this.tail.count
      ? this.tailEventAt(tailIndex)
      : undefined;
  }

  private forEachParentInsertionRank(
    rank: number,
    visit: (parentRank: number) => void,
  ): void {
    const packedBase = this.packedBase;
    const packedCount = packedBase?.count ?? 0;
    if (rank >= packedCount) {
      this.assertTailRank(rank);
      this.tail.forEachParentRank(rank - packedCount, visit);
      return;
    }
    const parentCount = packedBase!.parentCountAt(rank);
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentRank = packedBase!.parentOffsetAt(rank, parentIndex);
      if (parentRank === undefined) {
        throw new Error(
          `Packed event ${rank} is missing parent ${parentIndex}`,
        );
      }
      visit(parentRank);
    }
  }

  /**
   * The lowest rank `start <= rank` such that every event in `(start, rank]`
   * has the previous rank as its only parent. A packed event's chain starts
   * no later than its run; a run may also end at a branch, which only makes
   * the chain shorter than it could be.
   */
  private chainStartOfInsertionRank(rank: number): number {
    const packedBase = this.packedBase;
    const packedCount = packedBase?.count ?? 0;
    let packedRank = rank;
    if (rank >= packedCount) {
      const start = this.tail.chainStartIndex(rank - packedCount, packedCount);
      if (start >= 0) {
        return packedCount + start;
      }
      packedRank = packedCount - 1;
    }
    const runs = packedBase!.runs;
    return runs.startOf(runs.runOf(packedRank));
  }

  private forEachChildInsertionRank(
    rank: number,
    visit: (childRank: number) => void,
  ): void {
    const packedBase = this.packedBase;
    const packedCount = packedBase?.count ?? 0;
    if (rank >= packedCount) {
      this.assertTailRank(rank);
      this.tail.forEachChildRank(rank - packedCount, visit);
      return;
    }
    const childCount = packedBase!.childCountAt(rank);
    for (let childIndex = 0; childIndex < childCount; childIndex++) {
      const childRank = packedBase!.childOffsetAt(rank, childIndex);
      if (childRank === undefined) {
        throw new Error(`Packed event ${rank} is missing child ${childIndex}`);
      }
      visit(childRank);
    }
    const tailChildren = this.tailChildrenByPackedParentRank.get(rank);
    if (typeof tailChildren === "number") {
      visit(tailChildren);
      return;
    }
    for (const childRank of tailChildren ?? []) {
      visit(childRank);
    }
  }

  private appendTailChildRank(parentRank: number, childRank: number): void {
    const packedCount = this.packedBase?.count ?? 0;
    if (parentRank >= packedCount) {
      this.tail.appendChild(parentRank - packedCount, childRank);
      return;
    }
    const existing = this.tailChildrenByPackedParentRank.get(parentRank);
    if (existing === undefined) {
      this.tailChildrenByPackedParentRank.set(parentRank, childRank);
    } else if (typeof existing === "number") {
      this.tailChildrenByPackedParentRank.set(parentRank, [
        existing,
        childRank,
      ]);
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
    if (parentRank >= packedCount) {
      return this.tail.removeLastChild(parentRank - packedCount, childRank);
    }
    const existing = this.tailChildrenByPackedParentRank.get(parentRank);
    if (existing === undefined) {
      throw new Error(`Event graph is missing child rank ${childRank}`);
    }
    if (typeof existing === "number") {
      if (existing !== childRank) {
        throw new Error(
          `Event graph child rollback order mismatch for rank ${parentRank}`,
        );
      }
      this.tailChildrenByPackedParentRank.delete(parentRank);
      return true;
    }

    if (existing[existing.length - 1] !== childRank) {
      throw new Error(
        `Event graph child rollback order mismatch for rank ${parentRank}`,
      );
    }
    existing.pop();
    if (existing.length === 0) {
      this.tailChildrenByPackedParentRank.delete(parentRank);
      return true;
    }
    if (existing.length === 1) {
      this.tailChildrenByPackedParentRank.set(parentRank, existing[0]!);
    }
    return false;
  }

  /** A frozen copy of the event at an insertion rank, for traversal orders. */
  private readonlyEventAtInsertionRank(rank: number): GraphEvent {
    const packedCount = this.packedBase?.count ?? 0;
    if (rank < packedCount) {
      return readonlyPackedGraphEvent(this.packedBase!, rank);
    }
    const event = this.tailEventAtRank(rank);
    if (event === undefined) {
      throw new Error(`Event graph is missing insertion rank ${rank}`);
    }
    return cloneReadonlyGraphEvent(event);
  }

  private insertionRankOf(id: EventId): number | undefined {
    // Receive paths look up the parents of events appended moments ago.
    const recentIds = this.recentIds;
    for (let slot = 0; slot < recentIds.length; slot++) {
      if (recentIds[slot] === id) {
        return this.recentRanks[slot];
      }
    }
    const baseRank = this.packedBase?.offsetOf(id);
    if (baseRank !== undefined) {
      return baseRank;
    }
    const tailIndex = this.tail.indexOf(id);
    return tailIndex < 0
      ? undefined
      : (this.packedBase?.count ?? 0) + tailIndex;
  }
}

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
