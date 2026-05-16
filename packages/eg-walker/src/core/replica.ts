/**
 * Public replica for Section 3.1 - Index-based operations only
 *
 * This module provides the public interface that:
 * - Only accepts index-based operations
 * - Never exposes CRDT IDs or internal metadata
 * - Returns only plain text state
 */

import { OPERATION_TYPE } from "../constants/operation-types";
import type {
  ExternalOperation,
  DocumentState,
  GraphEvent,
  EventId,
  Version,
  SerializedGraphInput,
  SerializedGraphOutput,
} from "../types";
import {
  assertRemoteEventWellFormed,
  assertWellFormedUtf16,
  createDocumentState,
} from "./invariants";
import {
  EventGraph,
  EventAlreadyExistsError,
  MissingParentError,
} from "../graph/event-graph";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import { PartialReplayManager } from "../engine/partial-replay";

interface CriticalCheckpoint {
  readonly version: Version;
  readonly text: string;
}

/**
 * Upper bound on retained critical checkpoints.
 *
 * Section 3.5/3.6 of the Eg-walker paper requires *some* critical-version
 * snapshot in scope to skip the full-replay path when a concurrent branch
 * arrives; the latest dominating checkpoint is always the cheapest one to
 * replay from, and any older checkpoint is only useful when a concurrent
 * branch is rooted earlier than every retained checkpoint. Capping the
 * retained list at this many newest entries keeps replica memory O(1) in
 * history length without sacrificing the common-case partial-replay path
 * (the worst case — a concurrent branch rooted before the oldest retained
 * checkpoint — falls back to {@link fullReplay}, which is already the
 * pre-checkpoint behaviour).
 *
 * The value is empirical: 32 is comfortably above the number of distinct
 * critical versions any single editing session is expected to materialise
 * between concurrent merges, while bounding each checkpoint's per-replica
 * cost (a frontier `Set` plus a snapshot text string) at a few KB worst
 * case for ordinary documents.
 */
const MAX_RETAINED_CHECKPOINTS = 32;

/**
 * Persistence schema the replica writes into (and reads from) the event
 * graph's free-form metadata bag. The graph itself is codec-agnostic and
 * stores arbitrary `Record<string, unknown>`; centralising the known fields
 * here keeps the schema in one place and turns the previous inline
 * `typeof` guards into a single typed surface.
 */
interface ReplicaPersistenceMetadata {
  readonly initialText?: string;
  readonly nextSequenceNumber?: number;
}

const readReplicaMetadata = (graph: EventGraph): ReplicaPersistenceMetadata => {
  const raw = graph.getMetadata();
  const rawInitialText = raw.initialText;
  const rawNextSequenceNumber = raw.nextSequenceNumber;
  return {
    initialText:
      typeof rawInitialText === "string" ? rawInitialText : undefined,
    nextSequenceNumber:
      typeof rawNextSequenceNumber === "number"
        ? rawNextSequenceNumber
        : undefined,
  };
};

const writeReplicaMetadata = (
  graph: EventGraph,
  metadata: ReplicaPersistenceMetadata,
): void => {
  graph.setMetadata({
    ...graph.getMetadata(),
    ...metadata,
  });
};

/**
 * Public replica for Eg-walker.
 * Strictly index-based, no CRDT exposure.
 */
export class EgWalkerReplica {
  private document: string = "";
  private readonly initialText: string;
  private readonly eventGraph: EventGraph;
  private currentVersion: Version = new Set();
  private nextSequenceNumber = 0;
  private engine: EgWalkerEngine | null = null;
  private readonly pendingByMissingParent = new Map<EventId, GraphEvent[]>();
  private readonly bufferedEventIds = new Set<EventId>();
  private fullReplayCount = 0;
  private partialReplayCount = 0;
  private incrementalApplyCount = 0;
  private readonly criticalAnalyzer = new CriticalVersionAnalyzer();
  private readonly partialReplayer = new PartialReplayManager();
  private criticalCheckpoints: ReadonlyArray<CriticalCheckpoint> = [];

  constructor(
    private readonly replicaId: string,
    initialText: string = "",
    eventGraph?: EventGraph,
  ) {
    assertWellFormedUtf16(initialText, "initial document text");
    this.document = initialText;
    this.initialText = initialText;
    this.eventGraph = eventGraph ?? new EventGraph();
    this.currentVersion = this.eventGraph.getFrontier();
    this.nextSequenceNumber = this.inferNextSequenceNumber();
    if (this.eventGraph.getAllEvents().length > 0) {
      // A prebuilt graph bypasses {@link applyRemoteEvent}, so its event
      // payloads have never been screened by
      // {@link assertRemoteEventWellFormed}. Validate them here before
      // {@link fullReplay} so a tampered persisted payload (lone
      // surrogate, negative delete length) cannot produce malformed
      // {@link getText} output.
      for (const event of this.eventGraph.getAllEvents()) {
        assertRemoteEventWellFormed(event);
      }
      this.fullReplay();
    }
    this.maybeAdvanceCheckpoint();
  }

  /**
   * Insert text at index - public API
   *
   * Validation lives in {@link applyLocalOperation} so direct callers and
   * `insert`/`delete` get the same guarantees without duplicating checks.
   */
  insert(index: number, text: string): void {
    this.applyLocalOperation({
      type: OPERATION_TYPE.INSERT,
      index,
      text,
    });
  }

  /**
   * Delete text at index - public API
   */
  delete(index: number, length: number): void {
    this.applyLocalOperation({
      type: OPERATION_TYPE.DELETE,
      index,
      length,
    });
  }

  /**
   * Get current document state - public API
   * Returns only plain text, no CRDT metadata
   */
  getDocument(): DocumentState {
    return createDocumentState(this.document);
  }

  getText(): string {
    return this.document;
  }

  /**
   * Serialize the document state (text + event graph)
   */
  serialize(): { text: string; eventGraph: SerializedGraphOutput } {
    writeReplicaMetadata(this.eventGraph, {
      initialText: this.initialText,
      nextSequenceNumber: this.nextSequenceNumber,
    });

    return {
      text: this.document,
      eventGraph: this.eventGraph.serialize(),
    };
  }

  static deserialize(
    serialized: {
      text: string;
      eventGraph: SerializedGraphInput | null;
    },
    replicaId: string = "deserialized-replica",
  ): EgWalkerReplica {
    if (!serialized.eventGraph) {
      return new EgWalkerReplica(replicaId, serialized.text);
    }

    const graph = EventGraph.deserialize(serialized.eventGraph);
    const metadata = readReplicaMetadata(graph);
    const initialText =
      metadata.initialText ??
      (graph.getAllEvents().length === 0 ? serialized.text : "");
    const replica = new EgWalkerReplica(replicaId, initialText, graph);

    if (metadata.nextSequenceNumber !== undefined) {
      replica.nextSequenceNumber = metadata.nextSequenceNumber;
    }

    return replica;
  }

  /**
   * Apply a local operation and add to event graph.
   *
   * Local operations are always causally rooted at {@link currentVersion}, so
   * the engine can advance incrementally rather than replay from scratch.
   */
  applyLocalOperation(operation: ExternalOperation): void {
    const validatedOperation = this.validateLocalOperation(operation);
    if (!validatedOperation) {
      return;
    }

    const event: GraphEvent = {
      id: this.generateEventId(),
      operation: validatedOperation,
      parentVersion: this.currentVersion,
      timestamp: Date.now(),
    };

    try {
      this.eventGraph.addEvent(event);
    } catch (error) {
      if (error instanceof EventAlreadyExistsError) {
        return;
      }
      throw error;
    }

    this.advanceWithEvent(event);
  }

  /**
   * Apply a remote event. Buffers events with unknown parents until they can
   * be applied in causal order, so callers do not need to deliver in order.
   */
  applyRemoteEvent(event: GraphEvent): void {
    assertRemoteEventWellFormed(event);
    this.tryAcceptRemoteEvent(event);
  }

  /**
   * Number of remote events currently buffered awaiting causal parents.
   * Exposed primarily for tests and diagnostics.
   */
  getPendingRemoteCount(): number {
    return this.bufferedEventIds.size;
  }

  /**
   * Replay scope counters. Exposed for tests and diagnostics to verify the
   * incremental retreat/advance path is taken instead of full replay.
   *
   * - `fullReplays` increments each time the entire event graph is replayed
   *   from scratch (engine cold-start or recovery path).
   * - `incrementalApplies` increments each time a single event is applied on
   *   top of existing engine state via retreat/advance.
   * - `engineRetreats` / `engineAdvances` are the cumulative engine counters,
   *   useful for proving replay work stays bounded to the divergent suffix.
   */
  getReplayStats(): {
    readonly fullReplays: number;
    readonly partialReplays: number;
    readonly incrementalApplies: number;
    readonly engineRetreats: number;
    readonly engineAdvances: number;
    readonly checkpointCount: number;
    readonly sequenceRecordCount: number;
  } {
    const engineStats = this.engine?.getStats();
    return {
      fullReplays: this.fullReplayCount,
      partialReplays: this.partialReplayCount,
      incrementalApplies: this.incrementalApplyCount,
      engineRetreats: engineStats?.retreatCount ?? 0,
      engineAdvances: engineStats?.advanceCount ?? 0,
      checkpointCount: this.criticalCheckpoints.length,
      sequenceRecordCount: engineStats?.sequenceRecordCount ?? 0,
    };
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): EventId {
    return `${this.replicaId}:${this.nextSequenceNumber++}`;
  }

  private validateIndex(index: number, allowEnd: boolean): void {
    const max = allowEnd ? this.document.length : this.document.length - 1;
    if (index < 0 || index > max) {
      throw new Error(
        `Index ${index} out of bounds [0, ${max}] for document of length ${this.document.length}`,
      );
    }
  }

  /**
   * Reject indexes that fall between a high and low surrogate code unit.
   *
   * The engine stores one CRDT item per UTF-16 code unit, so concurrent
   * operations between two halves of a surrogate pair could otherwise produce
   * lone surrogates in the merged text. Rejecting at the public boundary keeps
   * the CRDT layer free of mid-surrogate operations.
   */
  private assertNotMidSurrogate(index: number): void {
    if (index <= 0 || index >= this.document.length) {
      return;
    }
    const high = this.document.charCodeAt(index - 1);
    if (high < 0xd800 || high > 0xdbff) {
      return;
    }
    const low = this.document.charCodeAt(index);
    if (low >= 0xdc00 && low <= 0xdfff) {
      throw new Error(
        `Index ${index} falls between surrogate halves of a single code point`,
      );
    }
  }

  private validateLocalOperation(
    operation: ExternalOperation,
  ): ExternalOperation | null {
    if (operation.type === OPERATION_TYPE.INSERT) {
      // Empty inserts are no-ops; skip index validation.
      if (operation.text.length === 0) {
        return null;
      }
      assertWellFormedUtf16(operation.text, "insert text");
      this.validateIndex(operation.index, true);
      this.assertNotMidSurrogate(operation.index);
      return operation;
    }

    // Zero/negative-length deletes are no-ops; skip index validation.
    if (operation.length <= 0) {
      return null;
    }
    this.validateIndex(operation.index, false);
    this.assertNotMidSurrogate(operation.index);

    if (operation.index + operation.length > this.document.length) {
      throw new Error(
        `Delete range [${operation.index}, ${operation.index + operation.length}) exceeds document length ${this.document.length}`,
      );
    }
    this.assertNotMidSurrogate(operation.index + operation.length);

    return operation;
  }

  /**
   * Export event graph for persistence
   * This is what gets saved to disk - no CRDT metadata
   */
  exportEventGraph(): ReadonlyArray<GraphEvent> {
    return this.eventGraph.getAllEvents();
  }

  /**
   * Import event graph from persistence
   */
  static fromEventGraph(
    replicaId: string,
    events: ReadonlyArray<GraphEvent>,
    initialText: string = "",
  ): EgWalkerReplica {
    const replica = new EgWalkerReplica(replicaId, initialText);

    for (const event of events) {
      replica.applyRemoteEvent(event);
    }

    return replica;
  }

  private fullReplay(): void {
    // Section 3.4 of the paper: walk the event graph in branch-preserving
    // order so each parent transition matches the engine's current version
    // and triggers the non-conflicting-run fast path instead of forcing a
    // retreat/advance round-trip across an interleaved Kahn order. The
    // columnar codec keeps using {@link EventGraph.getTopologicalOrder}
    // (Kahn) so persisted on-disk bytes stay stable.
    const sortedEvents = this.eventGraph.getBranchPreservingTopologicalOrder();
    const engine = new EgWalkerEngine();
    const generated = engine.generate(sortedEvents, this.initialText, {
      eventGraph: this.eventGraph,
    });
    this.document = generated.text;
    this.currentVersion = this.eventGraph.getFrontier();
    this.engine = engine;
    this.fullReplayCount++;
  }

  /**
   * Apply a single event on top of existing engine state.
   *
   * Three paths, cheapest first:
   *   1. Incremental — when the engine's current version is causally ≤ the
   *      new event's parent version, the engine only needs to advance, no
   *      retreat. Covers local edits and remote events that extend the
   *      current frontier (the common case for sequential collaboration).
   *   2. Partial replay from a critical-version checkpoint — when retreat
   *      is needed but the divergent suffix is dominated by a previously
   *      observed critical version (Section 3.5 / 3.6 of the paper).
   *      Replays only events in `expand(frontier) \ expand(checkpoint)`.
   *   3. Full replay — only when no checkpoint dominates the divergent
   *      region (e.g. concurrent root inserts with no critical ancestor).
   */
  private advanceWithEvent(event: GraphEvent): void {
    if (!this.engine) {
      this.fullReplay();
      this.maybeAdvanceCheckpoint();
      return;
    }

    if (this.canIncrementallyAdvance(event)) {
      this.engine.applyEvent(event, this.eventGraph);
      this.document = this.engine.getText();
      this.currentVersion = this.eventGraph.getFrontier();
      this.incrementalApplyCount++;
      this.maybeAdvanceCheckpoint();
      return;
    }

    const checkpoint = this.pickCheckpoint();
    if (checkpoint) {
      this.partialReplayFromCheckpoint(checkpoint);
    } else {
      this.fullReplay();
    }
    this.maybeAdvanceCheckpoint();
  }

  /**
   * Incremental apply is safe iff the engine's current version is causally
   * ≤ the new event's parent version — i.e. the engine only needs to advance
   * (no retreat). When retreat would be needed, the new event is concurrent
   * with state already applied; the engine's bucket-based integration is
   * order-sensitive for concurrent items (#668), so we re-process the
   * divergent suffix in topological order via partial replay instead.
   */
  private canIncrementallyAdvance(event: GraphEvent): boolean {
    const engineVersion = this.engine?.getCurrentVersion();
    if (!engineVersion || engineVersion.size === 0) {
      return true;
    }
    const parentExpansion = this.eventGraph.expandVersion(event.parentVersion);
    for (const id of engineVersion) {
      if (!parentExpansion.has(id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Snapshot the current (version, text) pair when the graph's frontier is a
   * single-element critical version. These checkpoints let later concurrent
   * branches partial-replay only the post-checkpoint suffix instead of the
   * whole graph.
   *
   * The retained list is capped at {@link MAX_RETAINED_CHECKPOINTS} entries —
   * a long linear history evicts the oldest checkpoints, keeping replica
   * memory O(1) in history length. A concurrent branch rooted before every
   * retained checkpoint falls back to {@link fullReplay}, the same path the
   * replica took before checkpoints existed at all.
   */
  private maybeAdvanceCheckpoint(): void {
    const frontier = this.eventGraph.getFrontier();
    if (frontier.size !== 1) {
      return;
    }
    if (!this.criticalAnalyzer.isCritical(this.eventGraph, frontier)) {
      return;
    }
    const last = this.criticalCheckpoints[this.criticalCheckpoints.length - 1];
    if (last && this.versionsEqual(last.version, frontier)) {
      return;
    }
    this.appendCheckpoint({
      version: new Set(frontier),
      text: this.document,
    });
  }

  /**
   * Single seam for growing {@link criticalCheckpoints}. Routing every write
   * through here makes the {@link MAX_RETAINED_CHECKPOINTS} cap a structural
   * invariant of the array rather than a per-call-site convention, so a
   * future mutation site cannot drift past the bound by forgetting an
   * eviction loop.
   */
  private appendCheckpoint(checkpoint: CriticalCheckpoint): void {
    const next = [...this.criticalCheckpoints, checkpoint];
    this.criticalCheckpoints =
      next.length <= MAX_RETAINED_CHECKPOINTS
        ? next
        : next.slice(next.length - MAX_RETAINED_CHECKPOINTS);
  }

  /**
   * Latest checkpoint that is still a critical version of the current graph.
   * Critical versions are causally ordered, so scanning newest-first returns
   * the deepest dominating checkpoint.
   */
  private pickCheckpoint(): CriticalCheckpoint | null {
    for (let i = this.criticalCheckpoints.length - 1; i >= 0; i--) {
      const candidate = this.criticalCheckpoints[i];
      if (!candidate) {
        continue;
      }
      if (
        this.criticalAnalyzer.isCritical(this.eventGraph, candidate.version)
      ) {
        return candidate;
      }
    }
    return null;
  }

  private partialReplayFromCheckpoint(checkpoint: CriticalCheckpoint): void {
    const frontier = this.eventGraph.getFrontier();
    const result = this.partialReplayer.replayFromCheckpoint(
      this.eventGraph,
      checkpoint,
      frontier,
    );
    this.engine = result.engine;
    this.document = result.text;
    this.currentVersion = frontier;
    this.partialReplayCount++;
  }

  private versionsEqual(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
  ): boolean {
    if (left.size !== right.size) {
      return false;
    }
    for (const id of left) {
      if (!right.has(id)) {
        return false;
      }
    }
    return true;
  }

  private tryAcceptRemoteEvent(event: GraphEvent): void {
    if (
      this.eventGraph.hasEvent(event.id) ||
      this.bufferedEventIds.has(event.id)
    ) {
      return;
    }

    const missingParent = this.findMissingParent(event);
    if (missingParent !== null) {
      const queue = this.pendingByMissingParent.get(missingParent) ?? [];
      queue.push(event);
      this.pendingByMissingParent.set(missingParent, queue);
      this.bufferedEventIds.add(event.id);
      return;
    }

    try {
      this.eventGraph.addEvent(event);
    } catch (error) {
      if (
        error instanceof EventAlreadyExistsError ||
        error instanceof MissingParentError
      ) {
        return;
      }
      throw error;
    }

    this.advanceWithEvent(event);
    this.flushPendingChildrenOf(event.id);
  }

  private findMissingParent(event: GraphEvent): EventId | null {
    for (const parentId of event.parentVersion) {
      if (!this.eventGraph.hasEvent(parentId)) {
        return parentId;
      }
    }
    return null;
  }

  private flushPendingChildrenOf(parentId: EventId): void {
    const waiters = this.pendingByMissingParent.get(parentId);
    if (!waiters) {
      return;
    }
    this.pendingByMissingParent.delete(parentId);
    for (const waiter of waiters) {
      this.bufferedEventIds.delete(waiter.id);
      this.tryAcceptRemoteEvent(waiter);
    }
  }

  private inferNextSequenceNumber(): number {
    let maxSequenceNumber = -1;
    const prefix = `${this.replicaId}:`;

    for (const event of this.eventGraph.getAllEvents()) {
      if (!event.id.startsWith(prefix)) {
        continue;
      }

      const sequenceNumber = Number(event.id.slice(prefix.length));
      if (Number.isInteger(sequenceNumber)) {
        maxSequenceNumber = Math.max(maxSequenceNumber, sequenceNumber);
      }
    }

    return maxSequenceNumber + 1;
  }
}

/**
 * Factory function for creating replica instances.
 */
export function createEgWalkerReplica(
  replicaId: string,
  initialText?: string,
): EgWalkerReplica {
  return new EgWalkerReplica(replicaId, initialText);
}
