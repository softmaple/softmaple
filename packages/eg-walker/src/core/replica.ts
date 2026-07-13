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
import { APPLY_REMOTE_EVENT_STATUS } from "../types";
import type {
  ApplyRemoteEventResult,
  ApplyRemoteEventsResult,
  ExternalOperation,
  DocumentState,
  GraphEvent,
  EventId,
  PositionOperation,
  Version,
  SerializedGraphInput,
  SerializedGraphOutput,
} from "../types";
import { compareEventIds } from "../graph/event-id";
import { MaxHeap } from "../graph/internals/max-heap";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import {
  CriticalCheckpointStore,
  MAX_RETAINED_CHECKPOINTS,
  type CriticalCheckpoint,
  type CriticalCheckpointSnapshot,
  type CriticalCheckpointStoreSnapshot,
} from "./internals/critical-checkpoint-store";
import {
  assertRemoteEventWellFormed,
  assertWellFormedUtf16,
  cloneRemoteEvent,
  createDocumentState,
} from "./invariants";
import {
  EventGraph,
  EventAlreadyExistsError,
  type PackedLinearReplayView,
} from "../graph/event-graph";
import { encodeTopologicallyOrderedEventsBinary } from "../graph/columnar-codec/topological-binary-encoder";
import {
  EgWalkerEngine,
  type DeleteTargetRecord,
  type EngineRecoveryState,
  type EngineStats,
} from "../engine/eg-walker-engine";
import type {
  CompactEngineSequenceRecords,
  EngineSequenceRecord,
} from "../engine/sequence-records";
import { CriticalVersionAnalyzer } from "../engine/critical-version";
import {
  planCriticalReplaySections,
  type CriticalReplaySection,
} from "../engine/critical-section-replay-plan";
import { PartialReplayManager } from "../engine/partial-replay";
import {
  readReplicaMetadata,
  writeReplicaMetadata,
} from "./internals/persistence-metadata";
import {
  RemoteEventBuffer,
  type RemoteIntegrationEffect,
} from "./internals/remote-event-buffer";
import {
  isClosedReadyBatch,
  isLinearBatchFromVersion,
  isOrderedLinearBatchFromVersion,
  isTopologicallyReadyBatch,
} from "./internals/batch-replay-shape";
import { assertPendingCandidatesAcyclic } from "./internals/pending-causality";
import {
  consumeDecodedNativeSnapshotGraphSource,
  consumeDecodedNativeSnapshotRuntimeState,
  NATIVE_SNAPSHOT_FORMAT_VERSION,
  type NativeSnapshot,
  validateGraphMatchesSnapshot,
  validateNativeSnapshot,
  validateNativeSnapshotHeaderOnly,
} from "./native-snapshot";
import {
  createPortableSnapshotGraphSource,
  PORTABLE_SNAPSHOT_FORMAT_VERSION,
  registerTrustedPortableSnapshot,
  validatePortableSnapshotHeaderOnly,
  type PortableSnapshot,
} from "./portable-snapshot";
import {
  consumeCausalEventBatch,
  inspectCausalEventBatch,
  type CausalEventBatch,
} from "./causal-event-batch";

type LazyEventGraphSource = () => EventGraph;

const MAX_REPLAY_CACHE_EVENTS = 4_096;
const MAX_REPLAY_CACHE_BYTES = 32 * 1024 * 1024;
const ESTIMATED_REPLAY_RECORD_BYTES = 256;
const ESTIMATED_DELETE_TARGET_BYTES = 32;

interface ReplicaConstructorOptions {
  readonly skipReplay?: boolean;
  readonly restoredText?: string;
  readonly currentVersion?: Version;
  readonly nextSequenceNumber?: number;
  readonly lazyEventGraph?: LazyEventGraphSource;
  readonly deferLocalReplay?: boolean;
  readonly restoredSequenceRecords?: ReadonlyArray<EngineSequenceRecord>;
  readonly restoredEngine?: EgWalkerEngine;
  readonly restoredCheckpoints?: ReadonlyArray<CriticalCheckpointSnapshot>;
}

interface RemoteBatchCandidate {
  readonly event: GraphEvent;
  readonly inputIndex: number;
}

interface PreparedRemoteBatch {
  readonly candidates: ReadonlyArray<RemoteBatchCandidate>;
  readonly results: ApplyRemoteEventResult[];
  readonly firstInputIndexById: ReadonlyMap<EventId, number>;
}

interface RemoteBatchSnapshot {
  readonly documentBuffer: PersistentUtf16Rope;
  readonly documentCache: string | null;
  readonly currentVersion: Version;
  readonly engineStats: EngineStats | null;
  readonly engineStatsOverride: EngineStats | null;
  readonly checkpoints: CriticalCheckpointStoreSnapshot;
  readonly fullReplayCount: number;
  readonly partialReplayCount: number;
  readonly incrementalApplyCount: number;
  readonly lastReplaySource: ReplaySource | null;
  readonly replicaPeakSequenceRecordCount: number;
  readonly restoredSequenceRecords: ReadonlyArray<EngineSequenceRecord> | null;
  readonly replayCacheBaseVersion: Version | null;
  readonly replayCacheCoveredEventIds: Set<EventId> | null;
  readonly replayCacheCoverageChecks: number;
  readonly replayCacheEvents: number;
  readonly replayCacheBytes: number;
  readonly engineRecoveryAnchor: EngineRecoveryAnchor | null;
}

interface ReplayCacheCoverageAddition {
  readonly coveredEventIds: Set<EventId>;
  readonly eventId: EventId;
}

interface StateEngineRecoveryAnchor {
  readonly kind: "state";
  readonly state: EngineRecoveryState;
  readonly graphEventCount: number;
  readonly estimatedBytes: number;
}

interface CheckpointEngineRecoveryAnchor {
  readonly kind: "checkpoint";
  readonly checkpoint: CriticalCheckpoint;
  readonly estimatedBytes: 0;
}

type EngineRecoveryAnchor =
  | StateEngineRecoveryAnchor
  | CheckpointEngineRecoveryAnchor;

/**
 * Public replica for Eg-walker.
 * Strictly index-based, no CRDT exposure.
 */
export class EgWalkerReplica {
  private documentBuffer = PersistentUtf16Rope.from("");
  private documentCache: string | null = "";
  private readonly initialText: string;
  private eventGraph: EventGraph | null = null;
  private lazyEventGraph: LazyEventGraphSource | null = null;
  private currentVersion: Version = new Set();
  private nextSequenceNumber = 0;
  private engine: EgWalkerEngine | null = null;
  /** Exact diagnostic view retained across an exceptional engine rebuild. */
  private engineStatsOverride: EngineStats | null = null;
  private replayCacheBaseVersion: Version | null = null;
  /**
   * Events known to dominate the complete replay-cache base. Critical
   * checkpoints have singleton frontiers, so every accepted descendant can
   * be tracked with a direct parent lookup. Multi-frontier native resumes use
   * the general closure check once, then track descendants the same way.
   */
  private replayCacheCoveredEventIds: Set<EventId> | null = null;
  private replayCacheCoverageChecks = 0;
  private replayCacheCoverageJournal: ReplayCacheCoverageAddition[] | null =
    null;
  private replayCacheEvents = 0;
  private replayCacheBytes = 0;
  private engineRecoveryAnchor: EngineRecoveryAnchor | null = null;
  private remoteEvents: RemoteEventBuffer | null = null;
  private fullReplayCount = 0;
  private partialReplayCount = 0;
  private incrementalApplyCount = 0;
  private readonly deferLocalReplay: boolean;
  private restoredSequenceRecords: ReadonlyArray<EngineSequenceRecord> | null =
    null;
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
    options: ReplicaConstructorOptions = {},
  ) {
    assertWellFormedUtf16(initialText, "initial document text");
    if (options.restoredText !== undefined) {
      assertWellFormedUtf16(options.restoredText, "restored document text");
    }
    const restoredDocument = options.restoredText ?? initialText;
    this.documentBuffer = PersistentUtf16Rope.from(restoredDocument);
    this.documentCache = restoredDocument;
    this.initialText = initialText;
    this.deferLocalReplay = options.deferLocalReplay ?? false;
    this.restoredSequenceRecords = options.restoredSequenceRecords ?? null;
    this.engine = options.restoredEngine ?? null;
    this.eventGraph =
      eventGraph ?? (options.lazyEventGraph ? null : new EventGraph());
    this.lazyEventGraph = options.lazyEventGraph ?? null;
    if (this.eventGraph) {
      this.remoteEvents = this.createRemoteEventBuffer(this.eventGraph);
    }
    this.currentVersion =
      options.currentVersion !== undefined
        ? new Set(options.currentVersion)
        : this.ensureEventGraph().getFrontier();
    if (this.engine !== null) {
      // Native resume state is guaranteed only for forward continuation from
      // its captured frontier. A divergent suffix falls back to a retained
      // checkpoint instead of treating restored runtime indexes as a cold
      // full-graph cache.
      this.setReplayCacheBase(this.currentVersion);
      this.replayCacheEvents = 0;
      this.captureEngineRecoveryAnchor(this.engine, this.ensureEventGraph());
      this.refreshReplayCacheMetrics();
      this.evictReplayCacheIfNeeded();
    }
    this.nextSequenceNumber =
      options.nextSequenceNumber ?? this.inferNextSequenceNumber();
    if (this.eventGraph && this.eventGraph.getEventCount() > 0) {
      // A prebuilt graph bypasses {@link applyRemoteEvent}, so its event
      // payloads have never been screened by
      // {@link assertRemoteEventWellFormed}. Validate them here before
      // {@link fullReplay} so a tampered persisted payload (lone
      // surrogate, negative delete length) cannot produce malformed
      // {@link getText} output.
      this.eventGraph.validateStoredEvents(assertRemoteEventWellFormed);
      if (!options.skipReplay) {
        this.fullReplay();
      }
    }
    if (options.restoredCheckpoints) {
      this.criticalCheckpoints.restore(options.restoredCheckpoints);
    }
    if (this.eventGraph) {
      this.maybeAdvanceCheckpoint();
    }
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
    return createDocumentState(this.getText());
  }

  getText(): string {
    if (this.documentCache === null) {
      this.documentCache = this.documentBuffer.toString();
    }
    return this.documentCache;
  }

  /**
   * Serialize the document state (text + event graph)
   */
  serialize(): { text: string; eventGraph: SerializedGraphOutput } {
    const graph = this.ensureEventGraph();
    writeReplicaMetadata(graph, {
      initialText: this.initialText,
      nextSequenceNumber: this.nextSequenceNumber,
    });

    return {
      text: this.getText(),
      eventGraph: graph.serialize(),
    };
  }

  /**
   * Create a versioned native snapshot. Phase 1 stores the materialized text
   * and persistent event graph so snapshot load can answer reads immediately;
   * the engine is restored lazily before the first post-load edit.
   */
  createNativeSnapshot(): NativeSnapshot {
    const graph = this.ensureEventGraph();
    writeReplicaMetadata(graph, {
      initialText: this.initialText,
      nextSequenceNumber: this.nextSequenceNumber,
    });

    const engineState = this.engineStateForSnapshot(graph);

    return {
      formatVersion: NATIVE_SNAPSHOT_FORMAT_VERSION,
      text: this.getText(),
      initialText: this.initialText,
      currentVersion: Array.from(graph.getFrontier()),
      eventCount: graph.getEventCount(),
      nextSequenceNumber: this.nextSequenceNumber,
      metadata: graph.getMetadata(),
      sequenceRecords: engineState.sequenceRecords,
      deleteTargets: engineState.deleteTargets,
      checkpoints: this.criticalCheckpoints.toSnapshot(),
      eventGraph: graph.serialize(),
    };
  }

  /**
   * Create the paper-style persistence boundary: materialized text plus the
   * EGW3 event graph and the minimum metadata needed to continue authoring.
   * Runtime sequence records, delete targets, checkpoints, and replay caches
   * are deliberately excluded.
   */
  createPortableSnapshot(): PortableSnapshot {
    const graph = this.ensureEventGraph();
    try {
      const events =
        graph.getLinearReplayOrder() ?? graph.getTopologicalOrder();
      const encoded = encodeTopologicallyOrderedEventsBinary(events);
      return registerTrustedPortableSnapshot({
        formatVersion: PORTABLE_SNAPSHOT_FORMAT_VERSION,
        text: this.getText(),
        initialText: this.initialText,
        currentVersion: encoded.frontier,
        eventCount: graph.getEventCount(),
        nextSequenceNumber: this.nextSequenceNumber,
        eventGraph: encoded.binary,
      });
    } finally {
      graph.releaseTraversalCaches();
    }
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
    let replica = new EgWalkerReplica(replicaId, initialText, graph);
    // Most restores can rebuild from the persisted graph with one replay.
    // Older/order-sensitive payloads may still need the live remote-apply
    // compatibility path to reproduce their persisted text exactly.
    if (topologicalOrder.length > 0 && replica.getText() !== serialized.text) {
      replica = new EgWalkerReplica(replicaId, initialText);
      for (const event of topologicalOrder) {
        replica.applyRemoteEvent(event);
      }
      replica.ensureEventGraph().setMetadata(graph.getMetadata());
    }

    replica.nextSequenceNumber =
      metadata.nextSequenceNumber ?? replica.inferNextSequenceNumber();

    return replica;
  }

  static fromNativeSnapshot(
    snapshot: NativeSnapshot,
    replicaId: string = "native-snapshot-replica",
  ): EgWalkerReplica {
    const graphSource = consumeDecodedNativeSnapshotGraphSource(snapshot);
    const runtimeState = consumeDecodedNativeSnapshotRuntimeState(snapshot);
    let lazyEventGraph: LazyEventGraphSource | undefined;
    let graph: EventGraph | undefined;
    let sequenceRecords: ReadonlyArray<EngineSequenceRecord> = [];
    let deleteTargets: ReadonlyArray<DeleteTargetRecord> = [];
    const validated =
      graphSource === undefined
        ? (() => {
            const fullSnapshot = validateNativeSnapshot(snapshot);
            sequenceRecords = fullSnapshot.sequenceRecords;
            deleteTargets = fullSnapshot.deleteTargets;
            graph = EventGraph.deserialize(fullSnapshot.eventGraph);
            validateGraphMatchesSnapshot(graph, fullSnapshot);
            return fullSnapshot;
          })()
        : (() => {
            const header = validateNativeSnapshotHeaderOnly(snapshot);
            lazyEventGraph = (): EventGraph => {
              const graph = graphSource();
              validateGraphMatchesSnapshot(graph, header);
              graph.setMetadata({
                ...graph.getMetadata(),
                ...(header.metadata ?? {}),
                initialText: header.initialText,
                nextSequenceNumber: header.nextSequenceNumber,
              });
              return graph;
            };
            return header;
          })();
    if (graphSource !== undefined && runtimeState === undefined) {
      sequenceRecords = snapshot.sequenceRecords;
      deleteTargets = snapshot.deleteTargets;
    }
    const snapshotFrontier = new Set(validated.currentVersion);

    if (graph) {
      graph.setMetadata({
        ...graph.getMetadata(),
        ...(validated.metadata ?? {}),
        initialText: validated.initialText,
        nextSequenceNumber: validated.nextSequenceNumber,
      });
    }

    let restoredEngine: EgWalkerEngine | undefined;
    const hasSequenceRecords =
      runtimeState !== undefined
        ? runtimeState.sequenceRecords.count > 0
        : sequenceRecords.length > 0;
    // Restored engines can accept public local indexes directly only while
    // prepare-visible length matches plain document length. Once deletes or
    // retreated records are present, keep the records for re-snapshotting but
    // defer engine replay until the next non-local integration needs it.
    const canRestoreEngine =
      runtimeState !== undefined
        ? compactRecordsUsePlainIndexes(runtimeState.sequenceRecords)
        : recordsUsePlainIndexes(sequenceRecords);
    if (hasSequenceRecords && canRestoreEngine) {
      graph ??= lazyEventGraph?.();
      lazyEventGraph = undefined;
      if (!graph) {
        throw new Error("Invalid native snapshot: event graph is unavailable");
      }
      restoredEngine = EgWalkerEngine.fromSnapshotState({
        graph,
        currentVersion: snapshotFrontier,
        text: validated.text,
        sequenceRecords,
        compactSequenceRecords: runtimeState?.sequenceRecords,
        deleteTargets,
        compactDeleteTargets: runtimeState?.deleteTargets,
      });
    } else if (hasSequenceRecords && runtimeState !== undefined) {
      sequenceRecords = snapshot.sequenceRecords;
      deleteTargets = snapshot.deleteTargets;
    }

    return new EgWalkerReplica(replicaId, validated.initialText, graph, {
      skipReplay: true,
      restoredText: validated.text,
      currentVersion: snapshotFrontier,
      nextSequenceNumber: validated.nextSequenceNumber,
      lazyEventGraph,
      deferLocalReplay: restoredEngine === undefined,
      restoredSequenceRecords: sequenceRecords,
      restoredEngine,
      restoredCheckpoints: validated.checkpoints,
    });
  }

  /**
   * Restore from the portable paper-style snapshot without retaining replay
   * state. Validation replays the graph once at this persistence boundary;
   * the live replica starts from plain text and builds transient state only
   * if a later divergent event requires it.
   */
  static fromPortableSnapshot(
    snapshot: PortableSnapshot,
    replicaId: string = "portable-snapshot-replica",
  ): EgWalkerReplica {
    const validated = validatePortableSnapshotHeaderOnly(snapshot);
    const lazyEventGraph = createPortableSnapshotGraphSource(validated);

    return new EgWalkerReplica(replicaId, validated.initialText, undefined, {
      skipReplay: true,
      restoredText: validated.text,
      currentVersion: new Set(validated.currentVersion),
      nextSequenceNumber: validated.nextSequenceNumber,
      lazyEventGraph,
      deferLocalReplay: true,
    });
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
      this.ensureEventGraph().addEvent(event);
    } catch (error) {
      if (error instanceof EventAlreadyExistsError) {
        return;
      }
      throw error;
    }

    if (this.shouldDeferLocalReplay()) {
      this.applyPlainDocumentOperation(validatedOperation);
      this.currentVersion = new Set([event.id]);
      this.restoredSequenceRecords = null;
      this.maybeAdvanceCheckpoint();
      return;
    }

    // Local edits don't expose the engine's transformed operation; the caller
    // already knows what they typed. Discard the helper's return.
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
    return this.applyRemoteEvents([event]).results[0]!;
  }

  /**
   * Apply an owned batch that is already in strict causal order.
   *
   * This ingestion boundary is intended for persistence decoders and causal
   * diff transports. Unlike {@link applyRemoteEvents}, it does not buffer,
   * deduplicate, clone caller events, or allocate per-event result objects.
   * Every event ID must be new and every parent must already exist in the
   * graph or occur earlier in this batch. The batch is consumed only after
   * graph and document state commit successfully, so a failed attempt can be
   * retried after its missing prerequisite is installed.
   */
  applyCausalBatch(batch: CausalEventBatch): void {
    const events = inspectCausalEventBatch(batch);
    const graph = this.ensureEventGraph();
    if (this.ensureRemoteEvents().pendingCount !== 0) {
      throw new Error(
        "Cannot apply a causal batch while remote events are pending",
      );
    }
    if (events.length === 0) {
      consumeCausalEventBatch(batch);
      return;
    }
    if (
      graph.getEventCount() === 0 &&
      isOrderedLinearBatchFromVersion(events, this.currentVersion)
    ) {
      this.applyInitialPackedCausalBatch(batch, events, graph);
      return;
    }

    const snapshot = this.captureRemoteBatchSnapshot();
    const transaction = graph.beginAppendTransaction();
    const eventCountBeforeBatch = graph.getEventCount();
    let orderedLinear = true;
    let previousId: EventId | null = null;

    try {
      for (let index = 0; index < events.length; index++) {
        const event = events[index]!;
        if (index === 0) {
          orderedLinear = versionsEqual(
            event.parentVersion,
            this.currentVersion,
          );
        } else if (
          event.parentVersion.size !== 1 ||
          previousId === null ||
          !event.parentVersion.has(previousId)
        ) {
          orderedLinear = false;
        }
        graph.addEvent(event);
        previousId = event.id;
      }

      if (orderedLinear) {
        this.applyCausalLinearBatch(events, eventCountBeforeBatch);
      } else {
        this.engineStatsOverride = null;
        const checkpoint = this.criticalCheckpoints.pickFor(graph);
        if (checkpoint === null) {
          this.fullReplay();
        } else {
          this.partialReplayFromCheckpoint(checkpoint);
          this.maybeAdvanceCheckpoint();
        }
      }

      // Consuming cannot fail after a successful inspection in this
      // synchronous call. Do it before closing the graph transaction so any
      // unexpected lifecycle error can still roll back replica state.
      consumeCausalEventBatch(batch);
      transaction.commit();
    } catch (error) {
      transaction.rollback();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    }
  }

  /** Install an initial exact chain without retaining an object graph tail. */
  private applyInitialPackedCausalBatch(
    batch: CausalEventBatch,
    events: ReadonlyArray<GraphEvent>,
    emptyGraph: EventGraph,
  ): void {
    const packedGraph = EventGraph.fromOwnedLinearEvents(
      events,
      emptyGraph.getMetadata(),
    );
    const snapshot = this.captureRemoteBatchSnapshot();
    try {
      this.applyCausalLinearBatch(events, 0);
      consumeCausalEventBatch(batch);
    } catch (error) {
      this.restoreRemoteBatchSnapshot(snapshot, emptyGraph);
      throw error;
    }

    this.eventGraph = packedGraph;
    this.lazyEventGraph = null;
    this.remoteEvents = this.createRemoteEventBuffer(packedGraph);
  }

  /**
   * Atomically validate and accept a remote event batch.
   *
   * Events are detached from caller-owned objects, causally ordered, and then
   * appended through one transaction. Any integration failure rolls back the
   * graph, document, pending queues, replay state, checkpoints, and counters.
   */
  applyRemoteEvents(
    events: ReadonlyArray<GraphEvent>,
  ): ApplyRemoteEventsResult {
    const clonedEvents = events.map(cloneRemoteEvent);
    const graph = this.ensureEventGraph();
    const remoteEvents = this.ensureRemoteEvents();
    const isTopologicallyReady =
      clonedEvents.length > 1 &&
      isTopologicallyReadyBatch(clonedEvents, graph, remoteEvents.pendingCount);
    const prepared = isTopologicallyReady
      ? prepareKnownNewBatch(clonedEvents)
      : prepareRemoteBatch(clonedEvents, graph, remoteEvents);
    if (prepared.candidates.length === 0) {
      return { results: prepared.results, operations: [] };
    }

    const candidateEvents = isTopologicallyReady
      ? clonedEvents
      : prepared.candidates.map(({ event }) => event);
    if (
      prepared.candidates.length > 1 &&
      (isTopologicallyReady ||
        isClosedReadyBatch(candidateEvents, graph, remoteEvents.pendingCount))
    ) {
      return this.applyClosedRemoteBatch(
        prepared,
        graph,
        candidateEvents,
        isTopologicallyReady
          ? isOrderedLinearBatchFromVersion(
              candidateEvents,
              this.currentVersion,
            )
          : undefined,
      );
    }

    const snapshot = this.captureRemoteBatchSnapshot();
    const remoteTransaction = remoteEvents.beginTransaction();
    const transaction = graph.beginAppendTransaction();
    const coverageJournal: ReplayCacheCoverageAddition[] = [];
    this.replayCacheCoverageJournal = coverageJournal;
    const operations: PositionOperation[] = [];
    let operationsAreExact = true;

    try {
      for (const candidate of prepared.candidates) {
        const acceptance = remoteEvents.tryAcceptDetailed(candidate.event);
        prepared.results[candidate.inputIndex] = acceptance.directResult;

        for (const integration of acceptance.integrations) {
          const inputIndex = prepared.firstInputIndexById.get(
            integration.eventId,
          );
          if (inputIndex !== undefined && inputIndex !== candidate.inputIndex) {
            prepared.results[inputIndex] = {
              status: APPLY_REMOTE_EVENT_STATUS.Integrated,
              operation: integration.effect.operation,
            };
          }
          if (!integration.effect.exact) {
            operationsAreExact = false;
          } else if (integration.effect.operation !== null) {
            operations.push(integration.effect.operation);
          }
        }
      }

      transaction.commit();
      remoteTransaction.commit();
      this.replayCacheCoverageJournal = null;
      return {
        results: prepared.results,
        operations: operationsAreExact ? operations : null,
      };
    } catch (error) {
      transaction.rollback();
      remoteTransaction.rollback();
      for (let index = coverageJournal.length - 1; index >= 0; index--) {
        const addition = coverageJournal[index]!;
        addition.coveredEventIds.delete(addition.eventId);
      }
      this.replayCacheCoverageJournal = null;
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    }
  }

  /**
   * Integrate a causally-closed batch without invoking the single-event
   * pending/drain path. Linear batches edit the persistent rope directly;
   * divergent batches append once and replay once, so a batch of N events
   * cannot accidentally trigger N successively larger replays.
   */
  private applyClosedRemoteBatch(
    prepared: PreparedRemoteBatch,
    graph: EventGraph,
    events: ReadonlyArray<GraphEvent>,
    orderedLinear?: boolean,
  ): ApplyRemoteEventsResult {
    const snapshot = this.captureRemoteBatchSnapshot();
    const transaction = graph.beginAppendTransaction();

    try {
      if (
        orderedLinear ??
        isLinearBatchFromVersion(events, this.currentVersion)
      ) {
        const operations = this.applyClosedLinearBatch(prepared, graph);
        transaction.commit();
        return { results: prepared.results, operations };
      }

      for (const candidate of prepared.candidates) {
        graph.addEvent(candidate.event);
        prepared.results[candidate.inputIndex] = {
          status: APPLY_REMOTE_EVENT_STATUS.Integrated,
          operation: null,
        };
      }

      this.engineStatsOverride = null;
      const checkpoint = this.criticalCheckpoints.pickFor(graph);
      if (checkpoint === null) {
        this.fullReplay();
      } else {
        this.partialReplayFromCheckpoint(checkpoint);
        this.maybeAdvanceCheckpoint();
      }

      transaction.commit();
      return { results: prepared.results, operations: null };
    } catch (error) {
      transaction.rollback();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    }
  }

  private applyClosedLinearBatch(
    prepared: PreparedRemoteBatch,
    graph: EventGraph,
  ): ReadonlyArray<PositionOperation> {
    const previousStats = this.engineStatsOverride ?? this.engine?.getStats();
    this.captureEnginePeakBeforeSwap();
    this.engine = null;
    this.engineStatsOverride =
      previousStats === undefined
        ? null
        : withLiveSequenceRecordCount(previousStats, 0);
    this.engineRecoveryAnchor = null;
    this.setReplayCacheBase(null);
    this.replayCacheEvents = 0;
    this.replayCacheBytes = 0;

    const operations: PositionOperation[] = [];
    const checkpointStart = Math.max(
      0,
      prepared.candidates.length - MAX_RETAINED_CHECKPOINTS,
    );
    for (const [index, candidate] of prepared.candidates.entries()) {
      const { event } = candidate;
      graph.addEvent(event);
      const operation = this.validateLocalOperation(event.operation);
      if (operation !== null) {
        this.applyPlainDocumentOperation(operation);
      }
      const transformedOperation = toPositionOperation(operation);
      prepared.results[candidate.inputIndex] = {
        status: APPLY_REMOTE_EVENT_STATUS.Integrated,
        operation: transformedOperation,
      };
      if (transformedOperation !== null) {
        operations.push(transformedOperation);
      }
      if (index >= checkpointStart) {
        this.currentVersion = new Set([event.id]);
        this.maybeAdvanceCheckpoint();
      }
    }
    const last = prepared.candidates[prepared.candidates.length - 1];
    if (last !== undefined) {
      this.currentVersion = new Set([last.event.id]);
    }
    this.restoredSequenceRecords = null;
    this.incrementalApplyCount += prepared.candidates.length;
    this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
    return operations;
  }

  /** Apply an already-appended exact chain without result allocations. */
  private applyCausalLinearBatch(
    events: ReadonlyArray<GraphEvent>,
    eventCountBeforeBatch: number,
  ): void {
    const previousStats = this.engineStatsOverride ?? this.engine?.getStats();
    this.captureEnginePeakBeforeSwap();
    this.engine = null;
    this.engineStatsOverride =
      previousStats === undefined
        ? null
        : withLiveSequenceRecordCount(previousStats, 0);
    this.engineRecoveryAnchor = null;
    this.setReplayCacheBase(null);
    this.replayCacheEvents = 0;
    this.replayCacheBytes = 0;

    const checkpointStart = Math.max(
      0,
      events.length - MAX_RETAINED_CHECKPOINTS,
    );
    this.replayCausalLinearPrefix(events, checkpointStart);
    for (let index = checkpointStart; index < events.length; index++) {
      const event = events[index]!;
      const operation = this.validateCausalLinearOperation(event.operation);
      if (operation !== null) {
        this.applyPlainDocumentOperation(operation);
      }
      this.criticalCheckpoints.record(
        new Set([event.id]),
        this.documentBuffer,
        eventCountBeforeBatch + index + 1,
      );
    }

    const last = events[events.length - 1]!;
    this.currentVersion = new Set([last.id]);
    this.restoredSequenceRecords = null;
    this.incrementalApplyCount += events.length;
    this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
  }

  /** Fold a trusted linear batch prefix without losing per-event validation. */
  private replayCausalLinearPrefix(
    events: ReadonlyArray<GraphEvent>,
    endOffset: number,
  ): void {
    let pendingKind: "insert" | "delete" | null = null;
    let pendingIndex = 0;
    let pendingLength = 0;
    let pendingInsertParts: string[] = [];

    const flush = (): void => {
      if (pendingKind === "insert") {
        this.applyPlainDocumentOperation({
          type: OPERATION_TYPE.INSERT,
          index: pendingIndex,
          text:
            pendingInsertParts.length === 1
              ? pendingInsertParts[0]!
              : pendingInsertParts.join(""),
        });
      } else if (pendingKind === "delete") {
        this.applyPlainDocumentOperation({
          type: OPERATION_TYPE.DELETE,
          index: pendingIndex,
          length: pendingLength,
        });
      }
      pendingKind = null;
      pendingLength = 0;
      pendingInsertParts = [];
    };

    for (let offset = 0; offset < endOffset; offset++) {
      const operation = events[offset]!.operation;
      if (operation.type === OPERATION_TYPE.INSERT) {
        if (operation.text.length === 0) {
          continue;
        }
        if (
          pendingKind === "insert" &&
          operation.index === pendingIndex + pendingLength
        ) {
          pendingInsertParts.push(operation.text);
          pendingLength += operation.text.length;
          continue;
        }

        flush();
        this.validateCausalLinearOperation(operation);
        pendingKind = "insert";
        pendingIndex = operation.index;
        pendingLength = operation.text.length;
        pendingInsertParts = [operation.text];
        continue;
      }

      if (operation.length === 0) {
        continue;
      }
      if (pendingKind === "delete" && operation.index === pendingIndex) {
        const virtualDocumentLength =
          this.documentBuffer.length - pendingLength;
        if (operation.index + operation.length > virtualDocumentLength) {
          throw new Error(
            `Delete range [${operation.index}, ${operation.index + operation.length}) exceeds document length ${virtualDocumentLength}`,
          );
        }
        const combinedLength = pendingLength + operation.length;
        this.assertNotMidSurrogate(operation.index + combinedLength);
        pendingLength = combinedLength;
        continue;
      }

      flush();
      this.validateCausalLinearOperation(operation);
      pendingKind = "delete";
      pendingIndex = operation.index;
      pendingLength = operation.length;
    }

    flush();
  }

  /**
   * Number of remote events currently buffered awaiting causal parents.
   * Exposed primarily for tests and diagnostics.
   */
  getPendingRemoteCount(): number {
    return this.remoteEvents?.pendingCount ?? 0;
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
    readonly replayCacheEvents: number;
    readonly replayCacheBytes: number;
    readonly replayCacheCoverageChecks: number;
    readonly textBufferNodeCount: number;
    readonly checkpointUniqueTextBytes: number;
    readonly integrationProbeCount: number;
    readonly fugueComparisons: number;
    readonly fugueMarkerOperations: number;
    readonly fugueRotations: number;
    readonly fugueRebuilds: number;
    readonly sequenceTreeOperations: number;
  } {
    const engineStats = this.engineStatsOverride ?? this.engine?.getStats();
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
      replayCacheEvents: this.replayCacheEvents,
      replayCacheBytes: this.replayCacheBytes,
      replayCacheCoverageChecks: this.replayCacheCoverageChecks,
      textBufferNodeCount: this.documentBuffer.nodeCount,
      checkpointUniqueTextBytes: this.criticalCheckpoints.uniqueTextBytes,
      integrationProbeCount: engineStats?.integrationProbeCount ?? 0,
      fugueComparisons: engineStats?.fugueComparisons ?? 0,
      fugueMarkerOperations: engineStats?.fugueMarkerOperations ?? 0,
      fugueRotations: engineStats?.fugueRotations ?? 0,
      fugueRebuilds: engineStats?.fugueRebuilds ?? 0,
      sequenceTreeOperations: engineStats?.sequenceTreeOperations ?? 0,
    };
  }

  private ensureEventGraph(): EventGraph {
    if (!this.eventGraph) {
      const source = this.lazyEventGraph;
      if (!source) {
        throw new Error("Replica event graph is unavailable");
      }
      const graph = source();
      graph.validateStoredEvents(assertRemoteEventWellFormed);
      this.eventGraph = graph;
      this.lazyEventGraph = null;
      this.remoteEvents = this.createRemoteEventBuffer(graph);
    }
    return this.eventGraph;
  }

  private ensureRemoteEvents(): RemoteEventBuffer {
    if (!this.remoteEvents) {
      this.remoteEvents = this.createRemoteEventBuffer(this.ensureEventGraph());
    }
    return this.remoteEvents;
  }

  private createRemoteEventBuffer(graph: EventGraph): RemoteEventBuffer {
    return new RemoteEventBuffer({
      graph,
      advanceWithEvent: (event) => this.advanceWithEvent(event),
    });
  }

  private captureRemoteBatchSnapshot(): RemoteBatchSnapshot {
    return {
      documentBuffer: this.documentBuffer,
      documentCache: this.documentCache,
      currentVersion: new Set(this.currentVersion),
      engineStats: this.engine?.getStats() ?? null,
      engineStatsOverride: this.engineStatsOverride,
      checkpoints: this.criticalCheckpoints.snapshotForTransaction(),
      fullReplayCount: this.fullReplayCount,
      partialReplayCount: this.partialReplayCount,
      incrementalApplyCount: this.incrementalApplyCount,
      lastReplaySource: this.lastReplaySource,
      replicaPeakSequenceRecordCount: this.replicaPeakSequenceRecordCount,
      restoredSequenceRecords: this.restoredSequenceRecords,
      replayCacheBaseVersion:
        this.replayCacheBaseVersion === null
          ? null
          : new Set(this.replayCacheBaseVersion),
      // Keep the set by reference. New IDs are journaled for the duration of
      // the batch and removed on rollback, avoiding an O(history) clone for
      // every single-event applyRemoteEvent call.
      replayCacheCoveredEventIds: this.replayCacheCoveredEventIds,
      replayCacheCoverageChecks: this.replayCacheCoverageChecks,
      replayCacheEvents: this.replayCacheEvents,
      replayCacheBytes: this.replayCacheBytes,
      engineRecoveryAnchor: this.engineRecoveryAnchor,
    };
  }

  private restoreRemoteBatchSnapshot(
    snapshot: RemoteBatchSnapshot,
    graph: EventGraph,
  ): void {
    this.criticalCheckpoints.restoreTransaction(snapshot.checkpoints);
    this.fullReplayCount = snapshot.fullReplayCount;
    this.partialReplayCount = snapshot.partialReplayCount;
    this.incrementalApplyCount = snapshot.incrementalApplyCount;
    this.lastReplaySource = snapshot.lastReplaySource;
    this.replicaPeakSequenceRecordCount =
      snapshot.replicaPeakSequenceRecordCount;
    this.restoredSequenceRecords = snapshot.restoredSequenceRecords;
    this.currentVersion = new Set(snapshot.currentVersion);
    this.documentBuffer = snapshot.documentBuffer;
    this.documentCache = snapshot.documentCache;
    this.engineStatsOverride = snapshot.engineStatsOverride;
    this.replayCacheBaseVersion =
      snapshot.replayCacheBaseVersion === null
        ? null
        : new Set(snapshot.replayCacheBaseVersion);
    this.replayCacheCoveredEventIds = snapshot.replayCacheCoveredEventIds;
    this.replayCacheCoverageChecks = snapshot.replayCacheCoverageChecks;
    this.replayCacheEvents = snapshot.replayCacheEvents;
    this.replayCacheBytes = snapshot.replayCacheBytes;
    this.engineRecoveryAnchor = snapshot.engineRecoveryAnchor;

    if (snapshot.engineStats === null) {
      this.engine = null;
      return;
    }
    const anchor = snapshot.engineRecoveryAnchor;
    if (anchor === null) {
      throw new Error("Missing replay-engine recovery anchor");
    }
    let restoredEngine: EgWalkerEngine;
    if (anchor.kind === "checkpoint") {
      restoredEngine = this.partialReplayer.replayFromCheckpoint(
        graph,
        anchor.checkpoint,
        snapshot.currentVersion,
        { collectTransformedOperations: false },
      ).engine;
    } else {
      restoredEngine = EgWalkerEngine.fromRecoveryState(anchor.state, graph);
      let eventOffset = 0;
      for (const event of graph.iterateEventsInInsertionOrder()) {
        if (eventOffset++ < anchor.graphEventCount) continue;
        restoredEngine.applyEvent(event, graph);
      }
    }
    restoredEngine.restoreStats(snapshot.engineStats);
    this.engine = restoredEngine;
  }

  private shouldDeferLocalReplay(): boolean {
    return this.deferLocalReplay && this.engine === null;
  }

  private applyPlainDocumentOperation(operation: ExternalOperation): void {
    if (operation.type === OPERATION_TYPE.INSERT) {
      this.documentBuffer = this.documentBuffer.insert(
        operation.index,
        operation.text,
      );
      this.documentCache = null;
      return;
    }
    this.documentBuffer = this.documentBuffer.delete(
      operation.index,
      operation.length,
    );
    this.documentCache = null;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): EventId {
    const graph = this.ensureEventGraph();
    while (true) {
      const sequenceNumber = this.nextSequenceNumber;
      if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0) {
        throw new RangeError(
          `event ID sequence for ${this.replicaId} is exhausted`,
        );
      }
      const eventId = `${this.replicaId}:${sequenceNumber}`;
      if (!graph.hasEvent(eventId)) {
        if (sequenceNumber < Number.MAX_SAFE_INTEGER) {
          this.nextSequenceNumber = sequenceNumber + 1;
        }
        return eventId;
      }
      if (sequenceNumber === Number.MAX_SAFE_INTEGER) {
        throw new RangeError(
          `event ID sequence for ${this.replicaId} is exhausted`,
        );
      }
      this.nextSequenceNumber = sequenceNumber + 1;
    }
  }

  private validateIndex(index: number, allowEnd: boolean): void {
    if (!Number.isSafeInteger(index)) {
      throw new Error(`Index ${index} must be a safe integer`);
    }
    const max = allowEnd
      ? this.documentBuffer.length
      : this.documentBuffer.length - 1;
    if (index < 0 || index > max) {
      throw new Error(
        `Index ${index} out of bounds [0, ${max}] for document of length ${this.documentBuffer.length}`,
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
    if (index <= 0 || index >= this.documentBuffer.length) {
      return;
    }
    const high = this.documentBuffer.codeUnitAt(index - 1)!;
    if (high < 0xd800 || high > 0xdbff) {
      return;
    }
    const low = this.documentBuffer.codeUnitAt(index)!;
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

    if (!Number.isSafeInteger(operation.length)) {
      throw new Error(
        `Delete length ${operation.length} must be a safe integer`,
      );
    }

    // Zero/negative-length deletes are no-ops; skip index validation.
    if (operation.length <= 0) {
      return null;
    }
    this.validateIndex(operation.index, false);
    this.assertNotMidSurrogate(operation.index);

    if (operation.index + operation.length > this.documentBuffer.length) {
      throw new Error(
        `Delete range [${operation.index}, ${operation.index + operation.length}) exceeds document length ${this.documentBuffer.length}`,
      );
    }
    this.assertNotMidSurrogate(operation.index + operation.length);

    return operation;
  }

  /**
   * Validate document-relative bounds for an opaque builder-owned event.
   * Scalar fields and UTF-16 payloads were validated exactly once while the
   * batch was built and cannot be mutated through its public surface.
   */
  private validateCausalLinearOperation(
    operation: ExternalOperation,
  ): ExternalOperation | null {
    if (operation.type === OPERATION_TYPE.INSERT) {
      if (operation.text.length === 0) {
        return null;
      }
      this.validateIndex(operation.index, true);
      this.assertNotMidSurrogate(operation.index);
      return operation;
    }

    if (operation.length === 0) {
      return null;
    }
    this.validateIndex(operation.index, false);
    this.assertNotMidSurrogate(operation.index);
    if (operation.index + operation.length > this.documentBuffer.length) {
      throw new Error(
        `Delete range [${operation.index}, ${operation.index + operation.length}) exceeds document length ${this.documentBuffer.length}`,
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
    return this.ensureEventGraph().getAllEvents();
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
    const graph = this.ensureEventGraph();
    this.captureEnginePeakBeforeSwap();
    if (graph.isExactLinearHistory()) {
      this.fullReplayLinearGraph(graph);
      return;
    }
    const sections = planCriticalReplaySections(graph);
    let replayedEventCount = 0;
    let aggregateStats: EngineStats | null = null;
    let retainedEngine: EgWalkerEngine | null = null;
    let retainedBaseCheckpoint: CriticalCheckpoint | null = null;
    let retainedEventIds: ReadonlyArray<EventId> = [];

    this.documentBuffer = PersistentUtf16Rope.from(this.initialText);
    this.documentCache = null;
    this.currentVersion = new Set();

    const retainedCheckpointSectionStart = Math.max(
      0,
      sections.length - MAX_RETAINED_CHECKPOINTS,
    );
    for (let sectionIndex = 0; sectionIndex < sections.length; ) {
      const section = sections[sectionIndex]!;
      if (
        sectionIndex < retainedCheckpointSectionStart &&
        isLinearReplaySection(section.events, section.baseFrontier)
      ) {
        let sectionEnd = sectionIndex + 1;
        let groupedEventCount = section.events.length;
        while (sectionEnd < retainedCheckpointSectionStart) {
          const candidate = sections[sectionEnd]!;
          if (
            !isLinearReplaySection(candidate.events, candidate.baseFrontier)
          ) {
            break;
          }
          groupedEventCount += candidate.events.length;
          sectionEnd++;
        }
        this.replayCoalescedLinearSections(sections, sectionIndex, sectionEnd);
        replayedEventCount += groupedEventCount;
        sectionIndex = sectionEnd;
        continue;
      }

      const baseCheckpoint: CriticalCheckpoint = {
        version: new Set(section.baseFrontier),
        textBuffer: this.documentBuffer,
        eventCount: replayedEventCount,
      };

      if (isLinearReplaySection(section.events, section.baseFrontier)) {
        this.replayLinearSection(
          section.events,
          section.baseFrontier,
          replayedEventCount,
          sections.length === 1,
        );
      } else {
        const engine = new EgWalkerEngine();
        const generated = engine.generate(section.events, "", {
          initialVersion: section.baseFrontier,
          initialTextBuffer: this.documentBuffer,
          eventGraph: graph,
          eventOrder: section.events,
          collectTransformedOperations: false,
        });
        this.documentBuffer = generated.textBuffer;
        this.documentCache = null;
        this.currentVersion = new Set(section.endFrontier);
        aggregateStats = mergeEngineStats(aggregateStats, generated.stats);

        const isLastSection = sectionIndex === sections.length - 1;
        if (
          isLastSection &&
          section.endFrontier.size > 1 &&
          canRetainReplayEngine(
            section.events.length,
            this.documentBuffer,
            generated.stats,
          )
        ) {
          retainedEngine = engine;
          retainedBaseCheckpoint = baseCheckpoint;
          retainedEventIds = section.events.map(({ id }) => id);
        }
      }

      replayedEventCount += section.events.length;
      if (sectionIndex >= retainedCheckpointSectionStart) {
        this.criticalCheckpoints.record(
          section.endFrontier,
          this.documentBuffer,
          replayedEventCount,
        );
      }
      sectionIndex++;
    }

    this.currentVersion = graph.getFrontier();
    this.engine = retainedEngine;
    this.engineStatsOverride =
      aggregateStats === null
        ? null
        : withLiveSequenceRecordCount(
            aggregateStats,
            retainedEngine?.getStats().sequenceRecordCount ?? 0,
          );
    this.replicaPeakSequenceRecordCount = Math.max(
      this.replicaPeakSequenceRecordCount,
      aggregateStats?.peakSequenceRecordCount ?? 0,
    );
    if (retainedEngine !== null && retainedBaseCheckpoint !== null) {
      this.engineRecoveryAnchor = {
        kind: "checkpoint",
        checkpoint: retainedBaseCheckpoint,
        estimatedBytes: 0,
      };
      this.setReplayCacheBase(retainedBaseCheckpoint.version, retainedEventIds);
      this.replayCacheEvents = retainedEventIds.length;
    } else {
      this.engineRecoveryAnchor = null;
      this.setReplayCacheBase(null);
      this.replayCacheEvents = 0;
    }
    this.restoredSequenceRecords = null;
    this.fullReplayCount++;
    this.lastReplaySource = REPLAY_SOURCE.FULL;
    this.refreshReplayCacheMetrics();
    graph.releaseTraversalCaches();
  }

  /**
   * Replay an exact causal chain directly from packed graph storage.
   *
   * The general critical-section planner exposes arrays because nonlinear
   * sections need random access. A persisted single-author trace does not:
   * streaming it prevents cold load from retaining one GraphEvent, operation,
   * and parent Set per historical event merely to apply each value once.
   */
  private fullReplayLinearGraph(graph: EventGraph): void {
    const eventCount = graph.getEventCount();
    const checkpointStart = Math.max(0, eventCount - MAX_RETAINED_CHECKPOINTS);
    let replayedEventCount = 0;

    this.documentBuffer = PersistentUtf16Rope.from(this.initialText);
    this.documentCache = null;
    this.currentVersion = new Set();

    const packed = graph.getPackedLinearReplayView();
    if (packed === null) {
      for (const event of graph.iterateEventsInInsertionOrder()) {
        const operation = this.validateLocalOperation(event.operation);
        if (operation !== null) {
          this.applyPlainDocumentOperation(operation);
        }
        replayedEventCount++;
        if (replayedEventCount > checkpointStart) {
          this.criticalCheckpoints.record(
            new Set([event.id]),
            this.documentBuffer,
            replayedEventCount,
          );
        }
      }
    } else {
      this.replayPackedLinearPrefix(packed, checkpointStart);
      replayedEventCount = checkpointStart;
      for (let offset = checkpointStart; offset < packed.count; offset++) {
        const operation = this.validateLocalOperation(
          packed.operationAt(offset),
        );
        if (operation !== null) {
          this.applyPlainDocumentOperation(operation);
        }
        replayedEventCount++;
        const eventId = packed.idAt(offset);
        if (eventId === undefined) {
          throw new Error(`Packed graph is missing event at offset ${offset}`);
        }
        this.criticalCheckpoints.record(
          new Set([eventId]),
          this.documentBuffer,
          replayedEventCount,
        );
      }
    }

    if (replayedEventCount !== eventCount) {
      throw new Error("Event graph changed during linear replay");
    }
    this.currentVersion = graph.getFrontier();
    this.engine = null;
    this.engineStatsOverride = null;
    this.engineRecoveryAnchor = null;
    this.setReplayCacheBase(null);
    this.replayCacheEvents = 0;
    this.restoredSequenceRecords = null;
    this.fullReplayCount++;
    this.lastReplaySource = REPLAY_SOURCE.FULL;
    this.refreshReplayCacheMetrics();

    graph.releaseTraversalCaches();
  }

  /**
   * Fold the checkpoint-free prefix of a packed causal chain into larger rope
   * edits. The decoder has already validated scalar fields and every insert
   * slice; this method validates document-relative indexes while delaying the
   * physical edit until an adjacent run ends.
   */
  private replayPackedLinearPrefix(
    packed: PackedLinearReplayView,
    endOffset: number,
  ): void {
    let pendingKind: "insert" | "delete" | null = null;
    let pendingIndex = 0;
    let pendingLength = 0;
    let pendingContentStart = 0;
    let pendingContentEnd = 0;

    const flush = (): void => {
      if (pendingKind === "insert") {
        this.documentBuffer = this.documentBuffer.insert(
          pendingIndex,
          packed.sliceInsertedContent(pendingContentStart, pendingContentEnd),
        );
        this.documentCache = null;
      } else if (pendingKind === "delete") {
        this.documentBuffer = this.documentBuffer.delete(
          pendingIndex,
          pendingLength,
        );
        this.documentCache = null;
      }
      pendingKind = null;
      pendingLength = 0;
    };

    for (let offset = 0; offset < endOffset; offset++) {
      const length = packed.operationLengthAt(offset);
      if (length === 0) {
        continue;
      }
      const index = packed.operationIndexAt(offset);

      if (packed.isInsertAt(offset)) {
        const contentStart = packed.insertStartAt(offset);
        if (
          pendingKind === "insert" &&
          index === pendingIndex + pendingLength &&
          contentStart === pendingContentEnd
        ) {
          pendingLength += length;
          pendingContentEnd += length;
          continue;
        }

        flush();
        this.validateIndex(index, true);
        this.assertNotMidSurrogate(index);
        pendingKind = "insert";
        pendingIndex = index;
        pendingLength = length;
        pendingContentStart = contentStart;
        pendingContentEnd = contentStart + length;
        continue;
      }

      if (pendingKind === "delete" && index === pendingIndex) {
        const virtualDocumentLength =
          this.documentBuffer.length - pendingLength;
        if (index + length > virtualDocumentLength) {
          throw new Error(
            `Delete range [${index}, ${index + length}) exceeds document length ${virtualDocumentLength}`,
          );
        }
        const combinedLength = pendingLength + length;
        this.assertNotMidSurrogate(index + combinedLength);
        pendingLength = combinedLength;
        continue;
      }

      flush();
      this.validateIndex(index, false);
      this.assertNotMidSurrogate(index);
      if (index + length > this.documentBuffer.length) {
        throw new Error(
          `Delete range [${index}, ${index + length}) exceeds document length ${this.documentBuffer.length}`,
        );
      }
      this.assertNotMidSurrogate(index + length);
      pendingKind = "delete";
      pendingIndex = index;
      pendingLength = length;
    }

    flush();
  }

  /** Apply a causally-linear replay section directly to the persistent rope. */
  private replayLinearSection(
    events: ReadonlyArray<GraphEvent>,
    baseVersion: Version,
    eventCountBeforeSection: number,
    retainTrailingCheckpoints: boolean,
  ): void {
    const checkpointStart = retainTrailingCheckpoints
      ? Math.max(0, events.length - MAX_RETAINED_CHECKPOINTS)
      : events.length;
    for (const [index, event] of events.entries()) {
      const operation = this.validateLocalOperation(event.operation);
      if (operation !== null) {
        this.applyPlainDocumentOperation(operation);
      }
      if (index >= checkpointStart) {
        this.criticalCheckpoints.record(
          new Set([event.id]),
          this.documentBuffer,
          eventCountBeforeSection + index + 1,
        );
      }
    }
    const last = events[events.length - 1];
    this.currentVersion =
      last === undefined ? new Set(baseVersion) : new Set([last.id]);
  }

  /**
   * Replay old critical sections as one physical rope batch.
   *
   * Only the trailing checkpoint window is observable after a cold replay.
   * Earlier one-event critical sections can therefore share the same pending
   * insert/delete accumulator instead of forcing one persistent-rope edit at
   * every section boundary. Event-relative validation still happens in order.
   */
  private replayCoalescedLinearSections(
    sections: ReadonlyArray<CriticalReplaySection>,
    startSection: number,
    endSection: number,
  ): void {
    let pendingKind: "insert" | "delete" | null = null;
    let pendingIndex = 0;
    let pendingLength = 0;
    let pendingInsertParts: string[] = [];

    const flush = (): void => {
      if (pendingKind === "insert") {
        this.applyPlainDocumentOperation({
          type: OPERATION_TYPE.INSERT,
          index: pendingIndex,
          text:
            pendingInsertParts.length === 1
              ? pendingInsertParts[0]!
              : pendingInsertParts.join(""),
        });
      } else if (pendingKind === "delete") {
        this.applyPlainDocumentOperation({
          type: OPERATION_TYPE.DELETE,
          index: pendingIndex,
          length: pendingLength,
        });
      }
      pendingKind = null;
      pendingLength = 0;
      pendingInsertParts = [];
    };

    for (
      let sectionIndex = startSection;
      sectionIndex < endSection;
      sectionIndex++
    ) {
      for (const event of sections[sectionIndex]!.events) {
        const operation = event.operation;
        if (operation.type === OPERATION_TYPE.INSERT) {
          if (operation.text.length === 0) {
            continue;
          }
          if (
            pendingKind === "insert" &&
            operation.index === pendingIndex + pendingLength
          ) {
            pendingInsertParts.push(operation.text);
            pendingLength += operation.text.length;
            continue;
          }

          flush();
          this.validateLocalOperation(operation);
          pendingKind = "insert";
          pendingIndex = operation.index;
          pendingLength = operation.text.length;
          pendingInsertParts = [operation.text];
          continue;
        }

        if (operation.length === 0) {
          continue;
        }
        if (pendingKind === "delete" && operation.index === pendingIndex) {
          const virtualDocumentLength =
            this.documentBuffer.length - pendingLength;
          if (operation.index + operation.length > virtualDocumentLength) {
            throw new Error(
              `Delete range [${operation.index}, ${operation.index + operation.length}) exceeds document length ${virtualDocumentLength}`,
            );
          }
          const combinedLength = pendingLength + operation.length;
          this.assertNotMidSurrogate(operation.index + combinedLength);
          pendingLength = combinedLength;
          continue;
        }

        flush();
        this.validateLocalOperation(operation);
        pendingKind = "delete";
        pendingIndex = operation.index;
        pendingLength = operation.length;
      }
    }

    flush();
    const lastSection = sections[endSection - 1];
    this.currentVersion = new Set(lastSection?.endFrontier ?? []);
  }

  private engineStateForSnapshot(graph: EventGraph): {
    readonly sequenceRecords: ReadonlyArray<EngineSequenceRecord>;
    readonly deleteTargets: ReadonlyArray<DeleteTargetRecord>;
  } {
    if (
      this.engine &&
      versionsEqual(this.engine.getCurrentVersion(), graph.getFrontier())
    ) {
      return {
        sequenceRecords: this.engine.getSequenceRecords(),
        deleteTargets: this.engine.getDeleteTargetRecords(),
      };
    }
    if (this.restoredSequenceRecords) {
      return {
        sequenceRecords: this.restoredSequenceRecords,
        deleteTargets: [],
      };
    }
    if (graph.getEventCount() === 0) {
      return { sequenceRecords: [], deleteTargets: [] };
    }

    return this.rebuildEngineStateForSnapshot(graph);
  }

  private rebuildEngineStateForSnapshot(graph: EventGraph): {
    readonly sequenceRecords: ReadonlyArray<EngineSequenceRecord>;
    readonly deleteTargets: ReadonlyArray<DeleteTargetRecord>;
  } {
    try {
      const engine = new EgWalkerEngine();
      const eventOrder = graph.getBranchPreservingTopologicalOrder();
      const generated = engine.generate(eventOrder, this.initialText, {
        eventGraph: graph,
        eventOrder,
      });
      return generated.text === this.getText()
        ? {
            sequenceRecords: engine.getSequenceRecords(),
            deleteTargets: engine.getDeleteTargetRecords(),
          }
        : { sequenceRecords: [], deleteTargets: [] };
    } finally {
      graph.releaseTraversalCaches();
    }
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
  private advanceWithEvent(event: GraphEvent): RemoteIntegrationEffect {
    this.engineStatsOverride = null;
    const graph = this.ensureEventGraph();

    // Paper fast path: a causal extension is already expressed in indexes of
    // the current plain document, so no CRDT replay state is needed at all.
    if (
      !this.engine &&
      versionsEqual(event.parentVersion, this.currentVersion)
    ) {
      const operation = this.validateLocalOperation(event.operation);
      if (operation !== null) {
        this.applyPlainDocumentOperation(operation);
      }
      this.currentVersion = graph.getFrontier();
      this.incrementalApplyCount++;
      this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
      this.maybeAdvanceCheckpoint();
      return toRemoteIntegrationEffect(operation === null ? [] : [operation]);
    }

    // A retained replay engine can retreat as well as advance. Reuse it for a
    // concurrent burst while its seed checkpoint remains an ancestor of the
    // incoming prepare version.
    if (this.engine && this.replayCacheCovers(event.parentVersion)) {
      const applied = this.engine.applyEvent(event, graph);
      this.markReplayCacheCovered(event.id);
      this.documentBuffer = applied.textBuffer;
      this.documentCache = null;
      this.currentVersion = graph.getFrontier();
      this.incrementalApplyCount++;
      this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
      this.replayCacheEvents++;
      this.refreshReplayCacheMetrics();
      this.evictReplayCacheIfNeeded();
      this.maybeAdvanceCheckpoint();
      return toRemoteIntegrationEffect(applied.transformedOperations);
    }

    const checkpoint = this.criticalCheckpoints.pickFor(graph);
    if (checkpoint) {
      this.partialReplayFromCheckpoint(checkpoint);
    } else {
      this.fullReplay();
    }
    this.maybeAdvanceCheckpoint();
    return { operation: null, exact: false };
  }

  private replayCacheCovers(parentVersion: Version): boolean {
    const base = this.replayCacheBaseVersion;
    if (base === null) {
      return false;
    }
    if (base.size === 0) {
      return true;
    }

    if (versionsEqual(base, parentVersion)) {
      return true;
    }

    const coveredEventIds = this.replayCacheCoveredEventIds;
    if (coveredEventIds !== null) {
      for (const parentId of parentVersion) {
        this.replayCacheCoverageChecks++;
        if (coveredEventIds.has(parentId)) {
          return true;
        }
      }
    }
    if (base.size === 1) {
      return false;
    }

    // Native resume state can be based at a multi-element frontier. Preserve
    // the general closure check for that uncommon extension path; critical
    // checkpoint caches always use the direct-parent index above.
    const expandedParent = this.ensureEventGraph().expandVersion(parentVersion);
    this.replayCacheCoverageChecks += expandedParent.size;
    for (const eventId of base) {
      if (!expandedParent.has(eventId)) {
        return false;
      }
    }
    return true;
  }

  private markReplayCacheCovered(eventId: EventId): void {
    const coveredEventIds = this.replayCacheCoveredEventIds;
    if (coveredEventIds === null || coveredEventIds.has(eventId)) {
      return;
    }
    coveredEventIds.add(eventId);
    this.replayCacheCoverageJournal?.push({ coveredEventIds, eventId });
  }

  private setReplayCacheBase(
    baseVersion: Version | null,
    coveredEventIds: Iterable<EventId> = [],
  ): void {
    this.replayCacheBaseVersion =
      baseVersion === null ? null : new Set(baseVersion);
    if (baseVersion === null || baseVersion.size === 0) {
      this.replayCacheCoveredEventIds = null;
      return;
    }
    this.replayCacheCoveredEventIds = new Set(coveredEventIds);
    if (baseVersion.size === 1) {
      for (const eventId of baseVersion) {
        this.replayCacheCoveredEventIds.add(eventId);
      }
    }
  }

  private maybeAdvanceCheckpoint(): void {
    this.criticalCheckpoints.maybeAdvance(
      this.ensureEventGraph(),
      this.documentBuffer,
    );
  }

  private captureEngineRecoveryAnchor(
    engine: EgWalkerEngine,
    graph: EventGraph,
  ): void {
    const state = engine.captureRecoveryState();
    const deleteTargetEntries = state.deleteTargets.reduce(
      (count, target) => count + target.targetIds.length + 1,
      0,
    );
    this.engineRecoveryAnchor = {
      kind: "state",
      state,
      graphEventCount: graph.getEventCount(),
      estimatedBytes:
        state.textBuffer.length * 2 +
        state.sequenceRecords.length * ESTIMATED_REPLAY_RECORD_BYTES +
        (deleteTargetEntries + state.eventOrder.length) *
          ESTIMATED_DELETE_TARGET_BYTES,
    };
  }

  private refreshReplayCacheMetrics(): void {
    if (this.engine === null) {
      this.replayCacheEvents = 0;
      this.replayCacheBytes = 0;
      return;
    }
    this.replayCacheBytes =
      this.documentBuffer.length * 2 +
      this.engine.getStats().sequenceRecordCount *
        ESTIMATED_REPLAY_RECORD_BYTES +
      (this.engineRecoveryAnchor?.estimatedBytes ?? 0);
  }

  private evictReplayCacheIfNeeded(): void {
    if (
      this.replayCacheEvents <= MAX_REPLAY_CACHE_EVENTS &&
      this.replayCacheBytes <= MAX_REPLAY_CACHE_BYTES
    ) {
      return;
    }
    this.captureEnginePeakBeforeSwap();
    this.engine = null;
    this.engineStatsOverride = null;
    this.engineRecoveryAnchor = null;
    this.setReplayCacheBase(null);
    this.replayCacheEvents = 0;
    this.replayCacheBytes = 0;
  }

  private partialReplayFromCheckpoint(checkpoint: CriticalCheckpoint): void {
    const graph = this.ensureEventGraph();
    this.captureEnginePeakBeforeSwap();
    const frontier = graph.getFrontier();
    const result = this.partialReplayer.replayFromCheckpoint(
      graph,
      checkpoint,
      frontier,
      { collectTransformedOperations: false },
    );
    this.engine = result.engine;
    this.engineRecoveryAnchor = {
      kind: "checkpoint",
      checkpoint,
      estimatedBytes: 0,
    };
    this.setReplayCacheBase(checkpoint.version, result.replayedEventIds);
    this.replayCacheEvents = result.replayedEventIds.length;
    this.documentBuffer = result.textBuffer;
    this.documentCache = null;
    this.currentVersion = frontier;
    this.partialReplayCount++;
    this.lastReplaySource = REPLAY_SOURCE.PARTIAL;
    this.refreshReplayCacheMetrics();
    this.evictReplayCacheIfNeeded();
  }

  private inferNextSequenceNumber(): number {
    const maxSequenceNumber =
      this.ensureEventGraph().getMaximumSequenceForReplica(this.replicaId) ??
      -1;

    return maxSequenceNumber === Number.MAX_SAFE_INTEGER
      ? Number.MAX_SAFE_INTEGER
      : maxSequenceNumber + 1;
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
function toRemoteIntegrationEffect(
  transformed: ReadonlyArray<ExternalOperation>,
): RemoteIntegrationEffect {
  if (transformed.length === 0) {
    return { operation: null, exact: true };
  }
  if (transformed.length > 1) {
    return { operation: null, exact: false };
  }
  const [op] = transformed;
  if (!op) {
    return { operation: null, exact: true };
  }
  return { operation: toPositionOperation(op), exact: true };
}

const toPositionOperation = (
  operation: ExternalOperation | null,
): PositionOperation | null => {
  if (operation === null) {
    return null;
  }
  if (operation.type === OPERATION_TYPE.INSERT) {
    if (operation.text.length === 0) {
      return null;
    }
    return {
      type: OPERATION_TYPE.INSERT,
      index: operation.index,
      length: operation.text.length,
    };
  }
  if (operation.length === 0) {
    return null;
  }
  return {
    type: OPERATION_TYPE.DELETE,
    index: operation.index,
    length: operation.length,
  };
};

const prepareRemoteBatch = (
  events: ReadonlyArray<GraphEvent>,
  graph: EventGraph,
  remoteEvents: RemoteEventBuffer,
): PreparedRemoteBatch => {
  const results: ApplyRemoteEventResult[] = events.map(() => ({
    status: APPLY_REMOTE_EVENT_STATUS.Duplicate,
  }));
  const firstById = new Map<
    EventId,
    { readonly event: GraphEvent; readonly inputIndex: number }
  >();
  const candidates: RemoteBatchCandidate[] = [];

  for (let inputIndex = 0; inputIndex < events.length; inputIndex++) {
    const event = events[inputIndex]!;
    const known =
      graph.getEvent(event.id) ?? remoteEvents.getBufferedEvent(event.id);
    if (known !== undefined) {
      assertMatchingDuplicate(known, event);
      continue;
    }

    const first = firstById.get(event.id);
    if (first !== undefined) {
      assertMatchingDuplicate(first.event, event);
      continue;
    }

    firstById.set(event.id, { event, inputIndex });
    candidates.push({ event, inputIndex });
  }

  assertPendingCandidatesAcyclic(
    candidates.map((candidate) => candidate.event),
    (eventId) => remoteEvents.getBufferedEvent(eventId),
  );

  return {
    candidates: topologicallyOrderRemoteCandidates(candidates),
    results,
    firstInputIndexById: new Map(
      Array.from(firstById, ([eventId, value]) => [eventId, value.inputIndex]),
    ),
  };
};

/**
 * Prepare a batch already proven new, causally closed, and topological.
 *
 * The closed-batch executor never consults `firstInputIndexById`, so avoid
 * materialising another event-ID map proportional to a large persistence
 * import. Results still stay aligned with the public input contract.
 */
const prepareKnownNewBatch = (
  events: ReadonlyArray<GraphEvent>,
): PreparedRemoteBatch => ({
  candidates: events.map((event, inputIndex) => ({ event, inputIndex })),
  results: events.map(() => ({
    status: APPLY_REMOTE_EVENT_STATUS.Duplicate,
  })),
  firstInputIndexById: new Map(),
});

const topologicallyOrderRemoteCandidates = (
  candidates: ReadonlyArray<RemoteBatchCandidate>,
): ReadonlyArray<RemoteBatchCandidate> => {
  const byId = new Map(
    candidates.map((candidate) => [candidate.event.id, candidate]),
  );
  const indegree = new Map<EventId, number>();
  const children = new Map<EventId, EventId[]>();

  for (const candidate of candidates) {
    let degree = 0;
    for (const parentId of candidate.event.parentVersion) {
      if (!byId.has(parentId)) {
        continue;
      }
      degree++;
      const siblings = children.get(parentId) ?? [];
      siblings.push(candidate.event.id);
      children.set(parentId, siblings);
    }
    indegree.set(candidate.event.id, degree);
  }

  const ready = new MaxHeap<RemoteBatchCandidate>((left, right) =>
    compareEventIds(right.event.id, left.event.id),
  );
  for (const candidate of candidates) {
    if (indegree.get(candidate.event.id) === 0) {
      ready.push(candidate);
    }
  }
  const ordered: RemoteBatchCandidate[] = [];
  while (ready.size > 0) {
    const next = ready.pop()!;
    ordered.push(next);
    for (const childId of children.get(next.event.id) ?? []) {
      const remaining = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, remaining);
      if (remaining === 0) {
        ready.push(byId.get(childId)!);
      }
    }
  }

  if (ordered.length !== candidates.length) {
    throw new Error("remote event batch contains a causal cycle");
  }
  return ordered;
};

const assertMatchingDuplicate = (
  known: GraphEvent,
  candidate: GraphEvent,
): void => {
  if (!eventsEqual(known, candidate)) {
    throw new Error(
      `remote event ${candidate.id} conflicts with an existing ID`,
    );
  }
};

const eventsEqual = (left: GraphEvent, right: GraphEvent): boolean => {
  if (
    left.id !== right.id ||
    left.timestamp !== right.timestamp ||
    left.operation.type !== right.operation.type ||
    left.operation.index !== right.operation.index ||
    !versionsEqual(left.parentVersion, right.parentVersion)
  ) {
    return false;
  }
  return left.operation.type === OPERATION_TYPE.INSERT &&
    right.operation.type === OPERATION_TYPE.INSERT
    ? left.operation.text === right.operation.text
    : left.operation.type === OPERATION_TYPE.DELETE &&
        right.operation.type === OPERATION_TYPE.DELETE &&
        left.operation.length === right.operation.length;
};

const versionsEqual = (
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

const isLinearReplaySection = (
  events: ReadonlyArray<GraphEvent>,
  baseVersion: Version,
): boolean => {
  const first = events[0];
  if (first === undefined) {
    return true;
  }
  if (!versionsEqual(first.parentVersion, baseVersion)) {
    return false;
  }
  let previousId = first.id;
  for (let index = 1; index < events.length; index++) {
    const event = events[index]!;
    if (
      event.parentVersion.size !== 1 ||
      !event.parentVersion.has(previousId)
    ) {
      return false;
    }
    previousId = event.id;
  }
  return true;
};

const canRetainReplayEngine = (
  eventCount: number,
  document: PersistentUtf16Rope,
  stats: EngineStats,
): boolean =>
  eventCount <= MAX_REPLAY_CACHE_EVENTS &&
  document.length * 2 +
    stats.sequenceRecordCount * ESTIMATED_REPLAY_RECORD_BYTES +
    eventCount * ESTIMATED_DELETE_TARGET_BYTES <=
    MAX_REPLAY_CACHE_BYTES;

const mergeEngineStats = (
  aggregate: EngineStats | null,
  next: EngineStats,
): EngineStats => {
  if (aggregate === null) {
    return next;
  }
  return {
    retreatCount: aggregate.retreatCount + next.retreatCount,
    advanceCount: aggregate.advanceCount + next.advanceCount,
    eventsProcessed: aggregate.eventsProcessed + next.eventsProcessed,
    nonConflictingRunCount:
      aggregate.nonConflictingRunCount + next.nonConflictingRunCount,
    fullReplayCount: aggregate.fullReplayCount + next.fullReplayCount,
    sequenceRecordCount: next.sequenceRecordCount,
    peakSequenceRecordCount: Math.max(
      aggregate.peakSequenceRecordCount,
      next.peakSequenceRecordCount,
    ),
    integrationProbeCount:
      aggregate.integrationProbeCount + next.integrationProbeCount,
    fugueComparisons: aggregate.fugueComparisons + next.fugueComparisons,
    fugueMarkerOperations:
      aggregate.fugueMarkerOperations + next.fugueMarkerOperations,
    fugueRotations: aggregate.fugueRotations + next.fugueRotations,
    fugueRebuilds: aggregate.fugueRebuilds + next.fugueRebuilds,
    sequenceTreeOperations:
      aggregate.sequenceTreeOperations + next.sequenceTreeOperations,
  };
};

const withLiveSequenceRecordCount = (
  stats: EngineStats,
  sequenceRecordCount: number,
): EngineStats => ({ ...stats, sequenceRecordCount });

const recordsUsePlainIndexes = (
  records: ReadonlyArray<EngineSequenceRecord>,
): boolean =>
  records.every((record) => record.prepareState === 1 && !record.everDeleted);

const compactRecordsUsePlainIndexes = (
  records: CompactEngineSequenceRecords,
): boolean => {
  for (let index = 0; index < records.count; index++) {
    if (
      (records.prepareStates[index] ?? 0) !== 1 ||
      (records.everDeleted[index] ?? 0) !== 0
    ) {
      return false;
    }
  }
  return true;
};
