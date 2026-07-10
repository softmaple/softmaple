/**
 * Event graph management for Section 3.1
 *
 * The event graph is the only persistent storage besides plain text.
 * No CRDT metadata is stored here.
 */

import type {
  GraphEvent,
  EventId,
  SerializedGraphInput,
  SerializedGraphOutput,
} from "../types";
import {
  EventAlreadyExistsError,
  MissingParentError,
} from "./event-graph-errors";
import { diffVersions as diffVersionSets } from "./internals/diff-versions";
import { deserializeEventGraph } from "./internals/event-graph-serialization";
import {
  getBranchPreservingTopologicalOrder as computeBranchPreservingTopologicalOrder,
  getTopologicalOrder as computeTopologicalOrder,
} from "./internals/topological-order";

export {
  EventAlreadyExistsError,
  MissingParentError,
} from "./event-graph-errors";

export interface EventGraphAppendTransaction {
  commit(): void;
  rollback(): void;
}

/**
 * Event graph for storing operation history
 * This is what gets persisted to disk
 */
export class EventGraph {
  private readonly events: Map<EventId, GraphEvent> = new Map();
  private readonly childrenMap: Map<EventId, Set<EventId>> = new Map();
  private readonly parentsMap: Map<EventId, Set<EventId>> = new Map();
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
  }

  /**
   * Remove all events and metadata from the graph.
   */
  clear(): void {
    this.events.clear();
    this.childrenMap.clear();
    this.parentsMap.clear();
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
      },
    };
  }

  /**
   * Add an event to the graph
   */
  addEvent(event: GraphEvent): void {
    if (this.events.has(event.id)) {
      throw new EventAlreadyExistsError(event.id);
    }

    for (const parentId of event.parentVersion) {
      if (!this.events.has(parentId)) {
        throw new MissingParentError(parentId);
      }
    }

    const stored = cloneGraphEvent(event);
    this.events.set(stored.id, stored);
    this.insertionRank.set(stored.id, this.insertionRank.size);
    this.frontier.add(stored.id);

    for (const parentId of stored.parentVersion) {
      const children = this.childrenMap.get(parentId) ?? new Set();
      children.add(stored.id);
      this.childrenMap.set(parentId, children);
      this.frontier.delete(parentId);

      const parents = this.parentsMap.get(stored.id) ?? new Set();
      parents.add(parentId);
      this.parentsMap.set(stored.id, parents);
    }

    this.invalidateDerivedCaches();
  }

  private rollbackAppendedEvents(startingEventCount: number): void {
    const appended = Array.from(this.events.keys()).slice(startingEventCount);
    for (let index = appended.length - 1; index >= 0; index--) {
      const eventId = appended[index]!;
      const parents = this.parentsMap.get(eventId) ?? new Set<EventId>();

      this.frontier.delete(eventId);
      this.childrenMap.delete(eventId);
      this.parentsMap.delete(eventId);
      this.insertionRank.delete(eventId);
      this.events.delete(eventId);

      for (const parentId of parents) {
        const siblings = this.childrenMap.get(parentId);
        siblings?.delete(eventId);
        if (siblings !== undefined && siblings.size === 0) {
          this.childrenMap.delete(parentId);
          if (this.events.has(parentId)) {
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
    return event === undefined ? undefined : cloneGraphEvent(event);
  }

  /**
   * Check if an event exists in the graph
   */
  hasEvent(id: EventId): boolean {
    return this.events.has(id);
  }

  /**
   * Get all events
   */
  getAllEvents(): ReadonlyArray<GraphEvent> {
    return Array.from(this.events.values(), cloneGraphEvent);
  }

  /**
   * Number of events currently stored in the graph.
   *
   * Prefer this over `getAllEvents().length` on hot paths because it avoids
   * materialising a new array.
   */
  getEventCount(): number {
    return this.events.size;
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

      const event = this.events.get(eventId);
      if (!event) {
        continue;
      }

      expanded.add(eventId);
      for (const parentId of event.parentVersion) {
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
    return diffVersionSets(left, right, {
      getParents: (id) => this.getParents(id),
      hasEvent: (id) => this.hasEvent(id),
      insertionRankOf: (id) => this.insertionRank.get(id),
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
      computeTopologicalOrder({
        events: this.events,
        childrenMap: this.childrenMap,
      }).map(cloneReadonlyGraphEvent),
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
   * The output is still a fully deterministic function of the graph:
   * roots and sibling branches are ordered by numeric-aware event id
   * via {@link compareEventIds}.
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
   * TODO: consider weighting sibling branches by estimated subtree
   * size (the paper's optional heuristic) instead of pure lex
   * tie-break to reduce churn further on skewed graphs.
   */
  getBranchPreservingTopologicalOrder(): ReadonlyArray<GraphEvent> {
    if (this.cachedBranchPreservingOrder !== null) {
      return this.cachedBranchPreservingOrder;
    }

    this.cachedBranchPreservingOrder = Object.freeze(
      computeBranchPreservingTopologicalOrder({
        events: this.events,
        childrenMap: this.childrenMap,
      }).map(cloneReadonlyGraphEvent),
    );
    return this.cachedBranchPreservingOrder;
  }

  /**
   * Get children of an event
   */
  getChildren(id: EventId): ReadonlySet<EventId> {
    return new Set(this.childrenMap.get(id) ?? []);
  }

  /**
   * Get parents of an event
   */
  getParents(id: EventId): ReadonlySet<EventId> {
    return new Set(this.parentsMap.get(id) ?? []);
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

      const parents = this.getParents(current);
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
}

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

const runtimeReadonlySet = <T>(values: Iterable<T>): ReadonlySet<T> => {
  const result = new Set(values);
  Object.defineProperties(result, {
    add: { value: rejectReadonlySetMutation },
    delete: { value: rejectReadonlySetMutation },
    clear: { value: rejectReadonlySetMutation },
  });
  return Object.freeze(result);
};

const rejectReadonlySetMutation = (): never => {
  throw new TypeError("Cannot mutate a read-only event graph view");
};
