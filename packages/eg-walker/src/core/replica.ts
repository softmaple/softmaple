/**
 * Public replica for Section 3.1 - Index-based operations only
 *
 * This module provides the public interface that:
 * - Only accepts index-based operations
 * - Never exposes CRDT IDs or internal metadata
 * - Returns only plain text state
 */

import { OPERATION_TYPE } from "../constants/operation-types";
import { REPLAY_SOURCE, type ReplaySource } from "../constants/replay-source";
import type {
  ApplyRemoteEventResult,
  ExternalOperation,
  DocumentState,
  GraphEvent,
  EventId,
  PositionOperation,
  Version,
  SerializedGraphInput,
  SerializedGraphOutput,
} from "../types";
import {
  CriticalCheckpointStore,
  type CriticalCheckpoint,
} from "./internals/critical-checkpoint-store";
import {
  assertRemoteEventWellFormed,
  assertWellFormedUtf16,
  createDocumentState,
} from "./invariants";
import { EventGraph, EventAlreadyExistsError } from "../graph/event-graph";
import { EgWalkerEngine } from "../engine/eg-walker-engine";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import { PartialReplayManager } from "../engine/partial-replay";
import {
  readReplicaMetadata,
  writeReplicaMetadata,
} from "./internals/persistence-metadata";
import { RemoteEventBuffer } from "./internals/remote-event-buffer";

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
  private readonly remoteEvents: RemoteEventBuffer;
  private fullReplayCount = 0;
  private partialReplayCount = 0;
  private incrementalApplyCount = 0;
  private lastReplaySource: ReplaySource | null = null;
  /**
   * Replica-lifetime high-water mark for the engine's
   * `sequenceRecordCount`. The engine's own peak is engine-scoped and
   * resets whenever a partial or full replay swaps in a fresh engine; we
   * fold the outgoing engine's peak into this field before each swap so
   * the value surfaced through {@link getReplayStats} stays monotonic
   * across the replica's lifetime.
   */
  private replicaPeakSequenceRecordCount = 0;
  private readonly criticalAnalyzer = new CriticalVersionAnalyzer();
  private readonly criticalCheckpoints = new CriticalCheckpointStore(
    this.criticalAnalyzer,
  );
  private readonly partialReplayer = new PartialReplayManager();

  constructor(
    private readonly replicaId: string,
    initialText: string = "",
    eventGraph?: EventGraph,
    replayOrder?: ReadonlyArray<GraphEvent>,
  ) {
    assertWellFormedUtf16(initialText, "initial document text");
    this.document = initialText;
    this.initialText = initialText;
    this.eventGraph = eventGraph ?? new EventGraph();
    this.remoteEvents = new RemoteEventBuffer({
      graph: this.eventGraph,
      advanceWithEvent: (event) => this.advanceWithEvent(event),
    });
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
      this.fullReplay(replayOrder);
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
    const topologicalOrder = graph.getTopologicalOrder();
    const initialText =
      metadata.initialText ??
      (topologicalOrder.length === 0 ? serialized.text : "");
    let replica = new EgWalkerReplica(
      replicaId,
      initialText,
      graph,
      topologicalOrder,
    );
    // Most restores can rebuild from the persisted graph with one replay.
    // Older/order-sensitive payloads may still need the live remote-apply
    // compatibility path to reproduce their persisted text exactly.
    if (topologicalOrder.length > 0 && replica.getText() !== serialized.text) {
      replica = new EgWalkerReplica(replicaId, initialText);
      for (const event of topologicalOrder) {
        replica.applyRemoteEvent(event);
      }
      replica.eventGraph.setMetadata(graph.getMetadata());
    }

    replica.nextSequenceNumber =
      metadata.nextSequenceNumber ?? replica.inferNextSequenceNumber();

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

    // Local edits don't expose the engine's transformed operation; the
    // caller already knows what they typed. Discard the helper's return.
    this.advanceWithEvent(event);
  }

  /**
   * Apply a remote event. Buffers events with unknown parents until they can
   * be applied in causal order, so callers do not need to deliver in order.
   *
   * Returns a structural {@link ApplyRemoteEventResult} so consumers can
   * react to integration / buffering / duplicate paths without inferring
   * them from a `getText()` pre/post comparison. When the event is
   * integrated through the engine's incremental advance path and the
   * apply produces a single transformed operation, that operation is
   * surfaced in the `integrated` result; see the type docstring for the
   * paths where `operation` is `null`.
   */
  applyRemoteEvent(event: GraphEvent): ApplyRemoteEventResult {
    assertRemoteEventWellFormed(event);
    return this.remoteEvents.tryAccept(event);
  }

  /**
   * Number of remote events currently buffered awaiting causal parents.
   * Exposed primarily for tests and diagnostics.
   */
  getPendingRemoteCount(): number {
    return this.remoteEvents.pendingCount;
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
   * - `peakSequenceRecordCount` is monotonic across the replica's lifetime:
   *   the engine's own peak resets on every partial/full replay engine swap,
   *   so we max in {@link replicaPeakSequenceRecordCount} (the peak captured
   *   from prior engines) here.
   */
  getReplayStats(): {
    readonly fullReplays: number;
    readonly partialReplays: number;
    readonly incrementalApplies: number;
    readonly engineRetreats: number;
    readonly engineAdvances: number;
    readonly checkpointCount: number;
    readonly sequenceRecordCount: number;
    readonly peakSequenceRecordCount: number;
    readonly criticalCheckpointHits: number;
    readonly criticalCheckpointMisses: number;
    readonly lastReplaySource: ReplaySource | null;
  } {
    const engineStats = this.engine?.getStats();
    return {
      fullReplays: this.fullReplayCount,
      partialReplays: this.partialReplayCount,
      incrementalApplies: this.incrementalApplyCount,
      engineRetreats: engineStats?.retreatCount ?? 0,
      engineAdvances: engineStats?.advanceCount ?? 0,
      checkpointCount: this.criticalCheckpoints.count,
      sequenceRecordCount: engineStats?.sequenceRecordCount ?? 0,
      peakSequenceRecordCount: Math.max(
        this.replicaPeakSequenceRecordCount,
        engineStats?.peakSequenceRecordCount ?? 0,
      ),
      criticalCheckpointHits: this.criticalCheckpoints.hits,
      criticalCheckpointMisses: this.criticalCheckpoints.misses,
      lastReplaySource: this.lastReplaySource,
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

  private fullReplay(
    replayOrder?: ReadonlyArray<GraphEvent>,
  ): ReadonlyArray<ExternalOperation> {
    // Section 3.4 of the paper: walk the event graph in branch-preserving
    // order so each parent transition matches the engine's current version
    // and triggers the non-conflicting-run fast path instead of forcing a
    // retreat/advance round-trip across an interleaved Kahn order. The
    // columnar codec keeps using {@link EventGraph.getTopologicalOrder}
    // (Kahn) so persisted on-disk bytes stay stable.
    this.captureEnginePeakBeforeSwap();
    const sortedEvents =
      replayOrder ?? this.eventGraph.getBranchPreservingTopologicalOrder();
    const engine = new EgWalkerEngine();
    const generated = engine.generate(sortedEvents, this.initialText, {
      eventGraph: this.eventGraph,
    });
    this.document = generated.text;
    this.currentVersion = this.eventGraph.getFrontier();
    this.engine = engine;
    this.fullReplayCount++;
    this.lastReplaySource = REPLAY_SOURCE.FULL;
    // Returned for the cold-start single-event path in {@link advanceWithEvent};
    // other callers (constructor seed, retreat-needed full replay) ignore
    // this because the array spans the whole graph, not a single event.
    return generated.transformedOperations;
  }

  /**
   * Fold the outgoing engine's `peakSequenceRecordCount` into the
   * replica-lifetime peak. Must be called before any code path that
   * replaces {@link engine} with a fresh instance (see {@link fullReplay}
   * and {@link partialReplayFromCheckpoint}); otherwise the transient
   * pressure observed during a heavy concurrent merge would silently
   * disappear from {@link getReplayStats} after the rebuild.
   */
  private captureEnginePeakBeforeSwap(): void {
    if (!this.engine) {
      return;
    }
    const enginePeak = this.engine.getStats().peakSequenceRecordCount;
    if (enginePeak > this.replicaPeakSequenceRecordCount) {
      this.replicaPeakSequenceRecordCount = enginePeak;
    }
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
   *
   * Returns the position operation attributable to {@link event} when
   * the incremental path is taken and the engine produced a single
   * transformed operation; `null` otherwise. The partial/full replay
   * paths return `null` because concurrent integration retransforms
   * multiple events and there is no single insert/delete on the
   * pre-event document that captures the visible effect of this one
   * event. See {@link ApplyRemoteEventResult} for the contract.
   */
  private advanceWithEvent(event: GraphEvent): PositionOperation | null {
    if (!this.engine) {
      // Cold-start: this code path only fires on a replica that started
      // with an empty event graph and is now seeing its first event. The
      // event was already added to the graph before we got here, so the
      // graph contains exactly that event — `fullReplay` runs the engine
      // on a single-event trace and its `transformedOperations` is the
      // visible effect of this one event, which is exactly what we want
      // to surface to the caller. A replica constructed from a non-empty
      // prebuilt graph already ran `fullReplay` in the constructor, so
      // multi-event cold starts cannot reach this branch.
      const transformed = this.fullReplay();
      this.maybeAdvanceCheckpoint();
      return toPositionOperation(transformed);
    }

    if (this.canIncrementallyAdvance(event)) {
      const applied = this.engine.applyEvent(event, this.eventGraph);
      this.document = this.engine.getText();
      this.currentVersion = this.eventGraph.getFrontier();
      this.incrementalApplyCount++;
      this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
      this.maybeAdvanceCheckpoint();
      return toPositionOperation(applied.transformedOperations);
    }

    const checkpoint = this.criticalCheckpoints.pickFor(this.eventGraph);
    if (checkpoint) {
      this.partialReplayFromCheckpoint(checkpoint);
    } else {
      this.fullReplay();
    }
    this.maybeAdvanceCheckpoint();
    return null;
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
    let directlyCovered = true;
    for (const id of engineVersion) {
      if (!event.parentVersion.has(id)) {
        directlyCovered = false;
        break;
      }
    }
    if (directlyCovered) {
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

  private maybeAdvanceCheckpoint(): void {
    this.criticalCheckpoints.maybeAdvance(this.eventGraph, this.document);
  }

  private partialReplayFromCheckpoint(checkpoint: CriticalCheckpoint): void {
    this.captureEnginePeakBeforeSwap();
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
    this.lastReplaySource = REPLAY_SOURCE.PARTIAL;
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

/**
 * Reduce the engine's per-event transformed operations to a single
 * editor-agnostic {@link PositionOperation}, or `null` when no single
 * operation captures the visible effect of the event.
 *
 * - Zero ops → `null` (visible no-op: empty insert, zero-length delete,
 *   or a delete that fully overlaps already-deleted characters).
 * - Multiple ops → `null` (a delete that coalesced into disjoint runs;
 *   the caller would need a multi-op API to represent it faithfully).
 * - One op → mapped to `PositionOperation`. Insert payloads convert
 *   `text` to `length` (UTF-16 code units) because awareness consumers
 *   address positions by length, not by inserted string.
 */
function toPositionOperation(
  transformed: ReadonlyArray<ExternalOperation>,
): PositionOperation | null {
  if (transformed.length !== 1) {
    return null;
  }
  const [op] = transformed;
  if (!op) {
    return null;
  }
  if (op.type === OPERATION_TYPE.INSERT) {
    if (op.text.length === 0) {
      return null;
    }
    return {
      type: OPERATION_TYPE.INSERT,
      index: op.index,
      length: op.text.length,
    };
  }
  if (op.length === 0) {
    return null;
  }
  return {
    type: OPERATION_TYPE.DELETE,
    index: op.index,
    length: op.length,
  };
}
