/**
 * Public replica for Section 3.1 - Index-based operations only
 *
 * This module provides the public interface that:
 * - Only accepts index-based operations
 * - Never exposes CRDT IDs or internal metadata
 * - Returns only plain text state
 */

import {
  MIN_TRANSIENT_CHAIN_EVENTS,
  PackedLinearReplay,
  replayPackedLinear,
} from "./internals/replay-packed-linear";
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
import {
  assertWithinEventLimit,
  eventLimitOf,
} from "../graph/internals/event-limit";
import { MaxHeap } from "../graph/internals/max-heap";
import { runSteps, type Steps } from "../graph/internals/steps";
import { PersistentUtf16Rope } from "../text/persistent-utf16-rope";
import { TransientUtf16RopeEditor } from "../text/transient-utf16-rope";
import {
  coldReplayLadderEventCounts,
  CriticalCheckpointStore,
  MAX_RETAINED_CHECKPOINTS,
  type CriticalCheckpoint,
  type CriticalCheckpointSnapshot,
  type CriticalCheckpointStoreSnapshot,
} from "./internals/critical-checkpoint-store";
import {
  assertRemoteEventWellFormed,
  assertDocumentIndex,
  assertCodePointBoundary,
  assertWellFormedUtf16,
  cloneRemoteEvent,
  createDocumentState,
} from "./invariants";
import {
  EventGraph,
  EventAlreadyExistsError,
  type PackedLinearReplayView,
} from "../graph/event-graph";
import { LinearEventBatch } from "../graph/internals/packed-linear-chain";
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
  planPackedCriticalReplaySectionsSteps,
  type PackedCriticalReplayPlan,
} from "../engine/packed-critical-replay-plan";
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
import { readRemoteLinearBatch } from "./internals/remote-linear-batch";
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
  assertPortableSnapshotMetadata,
  assertPortableSnapshotText,
  createPortableSnapshotGraphSource,
  createPortableSnapshotGraphSteps,
  PORTABLE_SNAPSHOT_FORMAT_VERSION,
  portableSnapshotRequiresTextValidation,
  registerTrustedPortableSnapshot,
  validatePortableSnapshotHeaderOnly,
  type PortableSnapshot,
} from "./portable-snapshot";
import {
  consumeCausalEventBatch,
  inspectCausalEventBatch,
  isExactCausalChain,
  type CausalEventBatch,
} from "./causal-event-batch";

type Utf16DocumentView = Pick<
  PersistentUtf16Rope,
  "length" | "hasSurrogateCodeUnits" | "codeUnitAt"
>;

type LazyEventGraphSource = () => EventGraph;

export type NativeSnapshotResumeCacheMode = "none" | "available" | "rebuild";

/** Options controlling the optional EGWS1 fast-resume cache. */
export interface CreateNativeSnapshotOptions {
  /**
   * - `"none"`: exclude sequence records, delete targets, and checkpoints.
   * - `"available"` (default): include already-live/restored state without
   *   replaying history.
   * - `"rebuild"`: replay the graph when sequence/delete state is missing.
   */
  readonly resumeCache?: NativeSnapshotResumeCacheMode;
}

/** Options for restoring a replica from a snapshot. */
export interface RestoreSnapshotOptions {
  /**
   * Most events the snapshot may hold. A snapshot whose header declares
   * more is rejected before its event graph is decoded, and the graph may
   * not declare more events than the header. Set it when the snapshot bytes
   * may be untrusted: a few bytes of graph can declare millions of events.
   */
  readonly maxEvents?: number;
}

/** Options for {@link EgWalkerReplica.prepare}. */
export interface PrepareReplicaOptions {
  /**
   * Longest run of preparation work, in milliseconds, before control goes
   * back to the host through {@link yieldToHost}. Work is checked against the
   * deadline between bounded steps, so a slice can overrun by one step. A
   * step is usually well under a millisecond; one very large edit, or one
   * column of a large graph's decode, takes longer. Defaults to 8.
   * `Infinity` prepares in one task, for a replica hosted in a Worker.
   */
  readonly sliceMs?: number;
  /**
   * Called between slices. Preparation continues when the returned promise
   * resolves. Defaults to `scheduler.yield()` where the host has it, then
   * `setImmediate`, then a `MessageChannel` message, then `setTimeout(0)`.
   */
  readonly yieldToHost?: () => Promise<void>;
  /**
   * Abandons the preparation between two slices and rejects with the
   * signal's reason. The replica stays as restored: the next call to
   * {@link EgWalkerReplica.prepare}, or the first operation that needs the
   * history, starts again.
   */
  readonly signal?: AbortSignal;
}

/** Default {@link PrepareReplicaOptions.sliceMs}. */
const DEFAULT_PREPARE_SLICE_MS = 8;

// Release large caches at a critical cut, but keep an active concurrent
// interval warm until its estimated byte budget is exhausted.
const REPLAY_CACHE_CRITICAL_RELEASE_EVENTS = 4_096;
const MAX_WARM_BATCH_EVENTS = 4_096;
const MAX_REPLAY_CACHE_BYTES = 32 * 1024 * 1024;
/**
 * Ceiling for the adaptive replay-cache budget.
 *
 * The base budget is sized for ordinary editing. A concurrent interval that
 * legitimately spans a whole document needs one sequence record per code unit,
 * so on merge-heavy histories the base budget can sit *below* the interval's
 * intrinsic floor: the engine is refused, the next event rebuilds the same
 * interval, by a full replay or by a partial replay from the newest critical
 * version before the divergence, and the replica thrashes one replay per
 * batch while never actually holding less memory. When that happens the
 * budget grows (see {@link EgWalkerReplica.growReplayCacheBudgetAfterThrash}
 * and {@link EgWalkerReplica.growReplayCacheBudgetToKeepRebuild}); this
 * ceiling stops the growth so a peer streaming an unboundedly large
 * concurrent interval still releases its cache.
 */
const MAX_REPLAY_CACHE_BUDGET_BYTES = 8 * MAX_REPLAY_CACHE_BYTES;
const ESTIMATED_REPLAY_RECORD_BYTES = 256;
const ESTIMATED_DELETE_TARGET_BYTES = 32;
// Keep a short causally-linear gap inside one obsolete nonlinear replay
// lifetime. Paper critical versions permit discarding temporary CRDT state;
// they do not require it. Start conservatively, then admit a wider bounded
// bridge only when the previous engine's deterministic record/byte pressure
// stayed low. Long linear tails still take the cheaper direct replay path.
const MIN_LINEAR_BRIDGE_EVENTS = 8;
const MID_LINEAR_BRIDGE_EVENTS = 16;
const MAX_LINEAR_BRIDGE_EVENTS = 32;
const LOW_BRIDGE_PRESSURE_RECORDS = 1_024;
const MID_BRIDGE_PRESSURE_RECORDS = 4_096;
const LOW_BRIDGE_PRESSURE_BYTES = 4 * 1024 * 1024;
const MID_BRIDGE_PRESSURE_BYTES = 16 * 1024 * 1024;
// Old critical cuts are not observable after cold replay. Replaying adjacent
// nonlinear cuts in one bounded engine lifetime avoids repeatedly rebuilding
// the ranked sequence and Fugue index while keeping temporary CRDT state
// independent of total history size. The trailing checkpoint window remains
// one section per engine so retained recovery semantics do not change.
const MAX_NONLINEAR_SUPERSECTION_EVENTS = 32_768;

/**
 * Step sizes of a history preparation, by kind of work. A time-sliced
 * preparation checks its deadline after every step, so a step should be a
 * small part of a slice. On the paper traces an engine event costs about
 * 3–5 µs, rarely 100 µs, a linear event under 1 µs, and a planner run well
 * under 1 µs.
 */
interface ReplayChunking {
  /** Whether a lazy graph is decoded in steps of one or two columns. */
  readonly decodeInSteps: boolean;
  readonly planningRuns: number;
  readonly engineEvents: number;
  readonly linearEvents: number;
}

/** Work that nothing pauses runs in as few steps as possible. */
const UNCHUNKED_REPLAY: ReplayChunking = {
  decodeInSteps: false,
  planningRuns: Number.POSITIVE_INFINITY,
  engineEvents: Number.POSITIVE_INFINITY,
  linearEvents: Number.POSITIVE_INFINITY,
};

const SLICED_REPLAY: ReplayChunking = {
  decodeInSteps: true,
  planningRuns: 8_192,
  engineEvents: 128,
  linearEvents: 2_048,
};

interface ReplicaConstructorOptions {
  readonly skipReplay?: boolean;
  readonly restoredText?: string;
  readonly currentVersion?: Version;
  readonly nextSequenceNumber?: number;
  readonly lazyEventGraph?: LazyEventGraphSource;
  /** The lazy graph decoded in steps, for a time-sliced preparation. */
  readonly lazyEventGraphSteps?: () => Steps<EventGraph>;
  /**
   * Text the lazy graph must replay to. The replay that proves it becomes
   * this replica's replay state instead of being thrown away.
   */
  readonly lazyEventGraphText?: string;
  readonly deferLocalReplay?: boolean;
  readonly restoredSequenceRecords?: ReadonlyArray<EngineSequenceRecord>;
  readonly restoredDeleteTargets?: ReadonlyArray<DeleteTargetRecord>;
  readonly restoredEngine?: EgWalkerEngine;
  readonly restoredCheckpoints?: ReadonlyArray<CriticalCheckpointSnapshot>;
}

/**
 * A lazily restored history being decoded and, when its text needs proof,
 * replayed, ahead of its first use. See {@link EgWalkerReplica.prepare}.
 */
interface HistoryPreparation {
  /** The remaining work, as bounded steps. */
  readonly steps: Steps<PreparedHistory>;
  /** Settled once the job is adopted, fails, or is abandoned. */
  outcome: PreparationOutcome | null;
  /** The pending `prepare()` result, while a slice driver runs this job. */
  promise: Promise<void> | null;
}

type PreparationOutcome =
  | { readonly kind: "adopted" }
  | { readonly kind: "failed"; readonly error: unknown };

interface PreparedHistory {
  readonly graph: EventGraph;
  /** The replay that proved the restored text, if it needed proof. */
  readonly validation: {
    readonly replica: EgWalkerReplica;
    readonly linear: boolean;
  } | null;
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
  readonly restoredDeleteTargets: ReadonlyArray<DeleteTargetRecord> | null;
  readonly replayCacheBaseVersion: Version | null;
  readonly replayCacheCoveredEventIds: Set<EventId> | null;
  readonly replayCacheCoverageChecks: number;
  readonly replayCacheEvents: number;
  readonly replayCacheBytes: number;
  readonly replayCacheBudgetBytes: number;
  readonly releasedCacheAtBudget: boolean;
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
 * Events of one exact chain at offsets `0..count`: a {@link LinearEventBatch},
 * or a chain the graph packed and reads back from its columns.
 */
type LinearChainEvents = PackedLinearReplayView & { readonly lastId: EventId };

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
  private lazyEventGraphSteps: (() => Steps<EventGraph>) | null = null;
  private lazyEventGraphText: string | null = null;
  /** The lazy history's preparation, while one is in progress. */
  private preparation: HistoryPreparation | null = null;
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
  private snapshotValidationStats = { replays: 0, events: 0, linearReplays: 0 };
  private replayCacheEvents = 0;
  private replayCacheBytes = 0;
  /** Adaptive budget; grows only after a refusal forced a full rebuild. */
  private replayCacheBudgetBytes = MAX_REPLAY_CACHE_BYTES;
  /** True while a byte-budget refusal has not yet been paid for by a replay. */
  private releasedCacheAtBudget = false;
  private engineRecoveryAnchor: EngineRecoveryAnchor | null = null;
  private remoteEvents: RemoteEventBuffer | null = null;
  private fullReplayCount = 0;
  private partialReplayCount = 0;
  private incrementalApplyCount = 0;
  private readonly deferLocalReplay: boolean;
  private restoredSequenceRecords: ReadonlyArray<EngineSequenceRecord> | null =
    null;
  private restoredDeleteTargets: ReadonlyArray<DeleteTargetRecord> | null =
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
    this.restoredDeleteTargets = options.restoredDeleteTargets ?? null;
    this.engine = options.restoredEngine ?? null;
    this.eventGraph =
      eventGraph ?? (options.lazyEventGraph ? null : new EventGraph());
    this.lazyEventGraph = options.lazyEventGraph ?? null;
    this.lazyEventGraphSteps =
      this.lazyEventGraph === null
        ? null
        : (options.lazyEventGraphSteps ?? null);
    this.lazyEventGraphText =
      this.lazyEventGraph === null
        ? null
        : (options.lazyEventGraphText ?? null);
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
  insert(index: number, text: string): GraphEvent | null {
    return this.applyLocalOperation({
      type: OPERATION_TYPE.INSERT,
      index,
      text,
    });
  }

  /**
   * Delete text at index - public API
   */
  delete(index: number, length: number): GraphEvent | null {
    return this.applyLocalOperation({
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
   * Read-only copy of the current causal frontier.
   *
   * The returned set is detached from replica state. Mutating it cannot
   * change the parents selected for a later local operation.
   */
  getFrontier(): Version {
    return new Set(this.currentVersion);
  }

  /**
   * Text supplied outside the event graph when this replica was created.
   *
   * Advanced stable-anchor consumers require this value to be empty and
   * must create seed content with a deterministic insert event instead.
   */
  getInitialText(): string {
    return this.initialText;
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
   * Create a versioned native snapshot containing the materialized text and
   * persistent event graph. Existing live/restored resume state is included,
   * but missing transient CRDT state is not rebuilt unless explicitly
   * requested through {@link CreateNativeSnapshotOptions.resumeCache}.
   */
  createNativeSnapshot(
    options: CreateNativeSnapshotOptions = {},
  ): NativeSnapshot {
    const graph = this.ensureEventGraph();
    writeReplicaMetadata(graph, {
      initialText: this.initialText,
      nextSequenceNumber: this.nextSequenceNumber,
    });

    const resumeCache = options.resumeCache ?? "available";
    assertNativeSnapshotResumeCacheMode(resumeCache);
    const engineState =
      resumeCache === "none"
        ? { sequenceRecords: [], deleteTargets: [] }
        : this.engineStateForSnapshot(graph, resumeCache === "rebuild");

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
      checkpoints:
        resumeCache === "none" ? [] : this.criticalCheckpoints.toSnapshot(),
      eventGraph: graph.serialize(),
    };
  }

  /**
   * Create the paper-style persistence boundary: materialized text plus the
   * EGW4 event graph and the minimum metadata needed to continue authoring.
   * Runtime sequence records, delete targets, checkpoints, and replay caches
   * are deliberately excluded.
   */
  createPortableSnapshot(): PortableSnapshot {
    const graph = this.ensureEventGraph();
    try {
      assertPortableSnapshotMetadata(graph.getMetadata());
      const encoded = graph.encodeTopologicalBinary();
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
    options: RestoreSnapshotOptions = {},
  ): EgWalkerReplica {
    const maxEvents = eventLimitOf(options.maxEvents);
    // Checked before the decoded sources are consumed or any graph is
    // decoded, so a retry of a rejected snapshot is rejected the same way.
    const header = validateNativeSnapshotHeaderOnly(snapshot);
    assertWithinEventLimit(header.eventCount, maxEvents);
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
      restoredSequenceRecords:
        sequenceRecords.length === 0 && deleteTargets.length === 0
          ? undefined
          : sequenceRecords,
      restoredDeleteTargets:
        sequenceRecords.length === 0 && deleteTargets.length === 0
          ? undefined
          : deleteTargets,
      restoredEngine,
      restoredCheckpoints: validated.checkpoints,
    });
  }

  /**
   * Restore from the portable paper-style snapshot, which carries no replay
   * state. Restoring only checks the header: reads of the text need no
   * history. The history is decoded and, unless the snapshot is trusted,
   * replayed once to prove the text, the same sectioned replay a cold load
   * runs. That replay's checkpoints and any engine it retains become this
   * replica's replay state, so a divergent first edit does not replay
   * history again.
   *
   * The decode and the proof run in {@link prepare}, or else inside the
   * first operation that needs the history. Call `prepare()` before enabling
   * edits so a keystroke does not wait for them. A snapshot is trusted when
   * it came from live state in this process, through bytes this process
   * encoded, or through
   * {@link PortableSnapshotCodec.decodeAuthenticated}.
   */
  static fromPortableSnapshot(
    snapshot: PortableSnapshot,
    replicaId: string = "portable-snapshot-replica",
    options: RestoreSnapshotOptions = {},
  ): EgWalkerReplica {
    const maxEvents = eventLimitOf(options.maxEvents);
    const validated = validatePortableSnapshotHeaderOnly(snapshot);
    assertWithinEventLimit(validated.eventCount, maxEvents);
    return new EgWalkerReplica(replicaId, validated.initialText, undefined, {
      skipReplay: true,
      restoredText: validated.text,
      currentVersion: new Set(validated.currentVersion),
      nextSequenceNumber: validated.nextSequenceNumber,
      lazyEventGraph: createPortableSnapshotGraphSource(validated),
      lazyEventGraphSteps: createPortableSnapshotGraphSteps(validated),
      lazyEventGraphText: portableSnapshotRequiresTextValidation(validated)
        ? validated.text
        : undefined,
      deferLocalReplay: true,
    });
  }

  /**
   * Whether this replica's history is decoded and, for a snapshot that
   * needed it, proven, so that the next edit or remote event does no
   * restore work. A replica restored with
   * {@link fromPortableSnapshot}, or lazily with {@link fromNativeSnapshot},
   * is not prepared until {@link prepare} or its first operation that needs
   * the history; every other replica is.
   */
  isPrepared(): boolean {
    return this.eventGraph !== null;
  }

  /**
   * Decode and prove the restored history now, in slices that yield to the
   * host, so the first keystroke after it does not wait for that work.
   * Resolves once {@link isPrepared} is true, at once if it already is.
   *
   * Reads of the text work throughout. A snapshot whose text does not match
   * its history rejects, before any local event is created; the replica
   * then stays as restored, and the next attempt proves it again. An
   * operation that needs the history while preparation is running finishes
   * the remaining work synchronously, and this promise settles with it.
   * Calls made while one preparation runs share it and its options.
   *
   * The proof and the replay state it leaves live in this JavaScript realm.
   * To keep the replay off a page's main thread, host the replica itself in
   * a Worker; state prepared in one realm cannot be moved to another.
   */
  prepare(options: PrepareReplicaOptions = {}): Promise<void> {
    if (this.eventGraph !== null) {
      return Promise.resolve();
    }
    const running = this.preparation;
    if (running?.promise) {
      return running.promise;
    }
    let sliceMs: number;
    let yieldToHost: () => Promise<void>;
    try {
      sliceMs = prepareSliceMsOf(options.sliceMs);
      yieldToHost = options.yieldToHost ?? yieldToHostDefault;
      if (typeof yieldToHost !== "function") {
        throw new TypeError("prepare() yieldToHost must be a function");
      }
    } catch (error) {
      return Promise.reject(error);
    }
    const preparation = running ?? this.beginHistoryPreparation(SLICED_REPLAY);
    preparation.promise = this.drivePreparation(
      preparation,
      sliceMs,
      yieldToHost,
      options.signal,
    );
    return preparation.promise;
  }

  /**
   * Apply a local operation and add to event graph.
   *
   * Local operations are always causally rooted at {@link currentVersion}, so
   * the engine can advance incrementally rather than replay from scratch.
   */
  applyLocalOperation(operation: ExternalOperation): GraphEvent | null {
    const validatedOperation = this.validateLocalOperation(operation);
    if (!validatedOperation) {
      return null;
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
        return null;
      }
      throw error;
    }

    if (this.shouldDeferLocalReplay()) {
      this.applyPlainDocumentOperation(validatedOperation);
      this.currentVersion = new Set([event.id]);
      this.restoredSequenceRecords = null;
      this.restoredDeleteTargets = null;
      this.maybeAdvanceCheckpoint();
      return event;
    }

    // Local edits don't expose the engine's transformed operation; the caller
    // already knows what they typed. Discard the helper's return.
    this.advanceWithEvent(event);
    return event;
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
    const cloned = cloneRemoteEvent(event);
    const graph = this.ensureEventGraph();
    const remoteEvents = this.ensureRemoteEvents();
    const known =
      graph.getEvent(cloned.id) ?? remoteEvents.getBufferedEvent(cloned.id);
    if (known !== undefined) {
      assertMatchingDuplicate(known, cloned);
      return { status: APPLY_REMOTE_EVENT_STATUS.Duplicate };
    }
    if (
      remoteEvents.pendingCount !== 0 ||
      [...cloned.parentVersion].some((parent) => !graph.hasEvent(parent))
    ) {
      return this.applyRemoteEvents([cloned]).results[0]!;
    }

    const snapshot = this.captureRemoteBatchSnapshot();
    const transaction = graph.beginAppendTransaction();
    this.replayCacheCoverageJournal = [];
    try {
      graph.addEvent(cloned);
      const effect = this.advanceWithEvent(cloned);
      transaction.commit();
      return {
        status: APPLY_REMOTE_EVENT_STATUS.Integrated,
        operation: effect.operation,
      };
    } catch (error) {
      transaction.rollback();
      this.rollbackReplayCacheCoverage();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    } finally {
      this.replayCacheCoverageJournal = null;
    }
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
    // The batch's builder created these event objects and no public API
    // returns them, so the graph adopts them below without a copy.
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

    const snapshot = this.captureRemoteBatchSnapshot();
    const transaction = graph.beginAppendTransaction();
    this.replayCacheCoverageJournal = [];
    const eventCountBeforeBatch = graph.getEventCount();

    try {
      const firstParents = events[0]!.parentVersion;
      if (
        isExactCausalChain(batch) &&
        versionsEqual(firstParents, this.currentVersion)
      ) {
        // The builder validated every field, so an exact chain goes straight
        // into packed columns and replays from them. The general graph path
        // is left for a graph that is not one packed chain, or for
        // timestamps packed columns cannot hold.
        const packed = graph.canAppendLinearEvents(firstParents)
          ? graph.appendLinearEvents(events)
          : null;
        if (packed !== null) {
          this.applyLinearBatch(packed, eventCountBeforeBatch);
        } else {
          for (const event of events) {
            graph.addOwnedEvent(event);
          }
          this.applyLinearBatch(
            linearBatchFromOwnedEvents(events),
            eventCountBeforeBatch,
          );
        }
      } else {
        for (const event of events) {
          graph.addOwnedEvent(event);
        }
        if (!this.tryApplyWarmBatch(events, graph)) {
          this.engineStatsOverride = null;
          const checkpoint = this.criticalCheckpoints.pickFor(graph);
          if (checkpoint === null) {
            this.fullReplay();
          } else {
            this.partialReplayFromCheckpoint(checkpoint);
            this.maybeAdvanceCheckpoint();
          }
        }
      }

      // Consuming cannot fail after a successful inspection in this
      // synchronous call. Do it before closing the graph transaction so any
      // unexpected lifecycle error can still roll back replica state.
      consumeCausalEventBatch(batch);
      transaction.commit();
    } catch (error) {
      transaction.rollback();
      this.rollbackReplayCacheCoverage();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    } finally {
      this.replayCacheCoverageJournal = null;
    }
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
    // A lazy graph has no buffer yet, so it has nothing pending.
    if (events.length > 1 && (this.remoteEvents?.pendingCount ?? 0) === 0) {
      const linear = readRemoteLinearBatch(events, this.currentVersion);
      const applied =
        linear === null ? null : this.tryApplyRemoteLinearBatch(linear);
      if (applied !== null) {
        return applied;
      }
    }

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
    this.replayCacheCoverageJournal = [];

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

      if (!this.tryApplyWarmBatch(events, graph)) {
        this.engineStatsOverride = null;
        const checkpoint = this.criticalCheckpoints.pickFor(graph);
        if (checkpoint === null) {
          this.fullReplay();
        } else {
          this.partialReplayFromCheckpoint(checkpoint);
          this.maybeAdvanceCheckpoint();
        }
      }

      transaction.commit();
      return { results: prepared.results, operations: null };
    } catch (error) {
      transaction.rollback();
      this.rollbackReplayCacheCoverage();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    } finally {
      this.replayCacheCoverageJournal = null;
    }
  }

  /**
   * Advance a retained engine within one bounded receive transaction. The graph
   * already contains the closed batch; publish its frontier/checkpoint only
   * after all effects have been applied. On a coverage/size miss the caller
   * replays the complete batch once, never once per remaining event. Byte
   * pressure is decided after the batch lands: eviction releases the oversized
   * cache and keeps the applied document instead of replaying it a second time.
   */
  private tryApplyWarmBatch(
    events: ReadonlyArray<GraphEvent>,
    graph: EventGraph,
  ): boolean {
    if (this.engine === null || events.length > MAX_WARM_BATCH_EVENTS)
      return false;
    this.engineStatsOverride = null;
    for (const event of events) {
      if (!this.replayCacheCovers(event.parentVersion)) return false;
      this.markReplayCacheCovered(event.id);
    }
    this.documentBuffer = this.engine.applyEventBatch(events, graph);
    this.documentCache = null;
    this.replayCacheEvents += events.length;
    this.refreshReplayCacheMetrics();
    this.currentVersion = graph.getFrontier();
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;
    this.incrementalApplyCount += events.length;
    this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
    this.clearSupersededReplayCacheRefusal();
    this.evictReplayCacheIfNeeded();
    this.maybeAdvanceCheckpoint();
    return true;
  }

  private rollbackReplayCacheCoverage(): void {
    for (const addition of this.replayCacheCoverageJournal ?? []) {
      addition.coveredEventIds.delete(addition.eventId);
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
    this.restoredDeleteTargets = null;
    this.incrementalApplyCount += prepared.candidates.length;
    this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
    return operations;
  }

  /**
   * Take the linear fast path for a caller's batch when the reference path
   * would integrate it through {@link applyClosedLinearBatch}: a closed chain
   * of new events extending {@link currentVersion}, with nothing pending.
   *
   * Returns `null`, with every change undone, when the batch repeats an ID or
   * an operation does not fit the document. The general path then handles
   * duplicates and reports errors exactly as it did before this path existed.
   */
  private tryApplyRemoteLinearBatch(
    batch: LinearEventBatch,
  ): ApplyRemoteEventsResult | null {
    const graph = this.ensureEventGraph();
    if (
      this.ensureRemoteEvents().pendingCount !== 0 ||
      !versionsEqual(batch.firstParents, this.currentVersion)
    ) {
      return null;
    }

    const snapshot = this.captureRemoteBatchSnapshot();
    const transaction = graph.beginAppendTransaction();
    const eventCountBeforeBatch = graph.getEventCount();
    try {
      if (graph.canAppendLinearBatch(batch)) {
        graph.appendLinearBatch(batch);
      } else {
        for (let offset = 0; offset < batch.count; offset++) {
          graph.addOwnedEvent(ownedLinearBatchEvent(batch, offset));
        }
      }
    } catch (error) {
      transaction.rollback();
      if (error instanceof EventAlreadyExistsError) {
        return null;
      }
      throw error;
    }

    this.replayCacheCoverageJournal = [];
    try {
      this.applyLinearBatch(batch, eventCountBeforeBatch);
      transaction.commit();
    } catch {
      transaction.rollback();
      this.rollbackReplayCacheCoverage();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      return null;
    } finally {
      this.replayCacheCoverageJournal = null;
    }
    return linearBatchResults(batch);
  }

  /**
   * Apply an exact chain the graph already holds, dropping any retained replay
   * engine: a causal extension is expressed in the plain document's indexes.
   * Edits before the retained-checkpoint window are coalesced into rope
   * splices; each event in the window is applied and checkpointed on its own.
   */
  private applyLinearBatch(
    batch: LinearChainEvents,
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

    const count = batch.count;
    const checkpointStart = Math.max(0, count - MAX_RETAINED_CHECKPOINTS);
    const eventCountAfterBatch = eventCountBeforeBatch + count;
    if (checkpointStart > 0) {
      this.replayPackedLinearRange(batch, 0, checkpointStart);
    }
    for (let offset = checkpointStart; offset < count; offset++) {
      const operation = this.validateCausalLinearOperation(
        batch.operationAt(offset),
      );
      if (operation !== null) {
        this.applyPlainDocumentOperation(operation);
      }
      this.criticalCheckpoints.record(
        new Set([batch.idAt(offset)!]),
        this.documentBuffer,
        eventCountBeforeBatch + offset + 1,
        eventCountAfterBatch,
      );
    }

    this.currentVersion = new Set([batch.lastId]);
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;
    this.incrementalApplyCount += count;
    this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
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
    /** Successful cold portable-snapshot text validations, separate from live replays. */
    readonly snapshotValidationReplays: number;
    readonly snapshotValidationEvents: number;
    readonly snapshotValidationLinearReplays: number;
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
    const liveEngineStats = this.engine?.getStats();
    const engineStats = this.engineStatsOverride ?? liveEngineStats;
    return {
      snapshotValidationReplays: this.snapshotValidationStats.replays,
      snapshotValidationEvents: this.snapshotValidationStats.events,
      snapshotValidationLinearReplays:
        this.snapshotValidationStats.linearReplays,
      fullReplays: this.fullReplayCount,
      partialReplays: this.partialReplayCount,
      incrementalApplies: this.incrementalApplyCount,
      engineRetreats: engineStats?.retreatCount ?? 0,
      engineAdvances: engineStats?.advanceCount ?? 0,
      checkpointCount: this.criticalCheckpoints.count,
      sequenceRecordCount:
        liveEngineStats?.sequenceRecordCount ??
        engineStats?.sequenceRecordCount ??
        0,
      peakSequenceRecordCount: Math.max(
        this.replicaPeakSequenceRecordCount,
        engineStats?.peakSequenceRecordCount ?? 0,
        liveEngineStats?.peakSequenceRecordCount ?? 0,
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
    if (this.eventGraph !== null) {
      return this.eventGraph;
    }
    // Finish a preparation in progress, or run a whole one now.
    const preparation =
      this.preparation ?? this.beginHistoryPreparation(UNCHUNKED_REPLAY);
    let prepared: PreparedHistory;
    try {
      prepared = runSteps(preparation.steps);
    } catch (error) {
      this.abandonHistoryPreparation(preparation, error);
      throw error;
    }
    return this.adoptPreparedHistory(preparation, prepared);
  }

  private beginHistoryPreparation(
    chunking: ReplayChunking,
  ): HistoryPreparation {
    const source = this.lazyEventGraph;
    if (source === null) {
      throw new Error("Replica event graph is unavailable");
    }
    const preparation: HistoryPreparation = {
      steps: this.prepareHistorySteps(
        source,
        chunking.decodeInSteps ? this.lazyEventGraphSteps : null,
        this.lazyEventGraphText,
        chunking,
      ),
      outcome: null,
      promise: null,
    };
    this.preparation = preparation;
    return preparation;
  }

  /**
   * Decode the lazy graph, in steps when `decodeSteps` is given, and, when
   * `expectedText` is given, prove that it replays to that text with the
   * same sectioned cold replay a decoded graph gets. The replay runs on a
   * detached replica, so this one keeps its restored state, and answers
   * reads with it, until the proof succeeds.
   */
  private *prepareHistorySteps(
    decode: LazyEventGraphSource,
    decodeSteps: (() => Steps<EventGraph>) | null,
    expectedText: string | null,
    chunking: ReplayChunking,
  ): Steps<PreparedHistory> {
    const graph = decodeSteps === null ? decode() : yield* decodeSteps();
    graph.validateStoredEvents(assertRemoteEventWellFormed);
    if (expectedText === null) {
      return { graph, validation: null };
    }
    yield;
    const linear = graph.isExactLinearHistory();
    const validator = EgWalkerReplica.forValidationReplay(
      this.replicaId,
      this.initialText,
      graph,
    );
    yield* validator.fullReplaySteps(chunking);
    assertPortableSnapshotText(validator.getText(), expectedText);
    return { graph, validation: { replica: validator, linear } };
  }

  /**
   * Run `preparation` in slices of at most `sliceMs`, yielding to the host
   * between them, until it is adopted or fails.
   */
  private async drivePreparation(
    preparation: HistoryPreparation,
    sliceMs: number,
    yieldToHost: () => Promise<void>,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    while (true) {
      // An operation that needed the history may have finished the job.
      const outcome = preparation.outcome;
      if (outcome !== null) {
        if (outcome.kind === "failed") {
          throw outcome.error;
        }
        return;
      }
      if (signal?.aborted === true) {
        this.abandonHistoryPreparation(preparation, signal.reason);
        throw signal.reason;
      }
      const deadline = monotonicNow() + sliceMs;
      let step: IteratorResult<void, PreparedHistory>;
      try {
        do {
          step = preparation.steps.next();
        } while (step.done !== true && monotonicNow() < deadline);
      } catch (error) {
        this.abandonHistoryPreparation(preparation, error);
        throw error;
      }
      if (step.done === true) {
        this.adoptPreparedHistory(preparation, step.value);
        return;
      }
      try {
        await yieldToHost();
      } catch (error) {
        this.abandonHistoryPreparation(preparation, error);
        throw error;
      }
    }
  }

  /**
   * Drop a preparation that failed or was abandoned. The replica keeps its
   * restored state and lazy source, so the next attempt starts over.
   */
  private abandonHistoryPreparation(
    preparation: HistoryPreparation,
    error: unknown,
  ): void {
    if (preparation.outcome === null) {
      preparation.outcome = { kind: "failed", error };
    }
    if (this.preparation === preparation) {
      this.preparation = null;
    }
    preparation.steps.return(undefined as never);
  }

  private adoptPreparedHistory(
    preparation: HistoryPreparation,
    prepared: PreparedHistory,
  ): EventGraph {
    const { graph, validation } = prepared;
    if (validation !== null) {
      this.adoptValidationReplay(validation.replica);
      this.snapshotValidationStats = {
        replays: this.snapshotValidationStats.replays + 1,
        events: this.snapshotValidationStats.events + graph.getEventCount(),
        linearReplays:
          this.snapshotValidationStats.linearReplays +
          (validation.linear ? 1 : 0),
      };
    }
    this.eventGraph = graph;
    this.lazyEventGraph = null;
    this.lazyEventGraphSteps = null;
    this.lazyEventGraphText = null;
    this.remoteEvents = this.createRemoteEventBuffer(graph);
    preparation.outcome = { kind: "adopted" };
    if (this.preparation === preparation) {
      this.preparation = null;
    }
    return graph;
  }

  /**
   * Take over the text, checkpoints and retained engine of a validation
   * replay: the state the same cold replay would have left on this replica.
   * A replica waiting for its history has no replay state of its own, and
   * the validation replay is counted apart from live replays.
   */
  private adoptValidationReplay(validator: EgWalkerReplica): void {
    this.documentBuffer = validator.documentBuffer;
    this.documentCache = validator.documentCache;
    this.currentVersion = validator.currentVersion;
    this.engine = validator.engine;
    this.engineStatsOverride = validator.engineStatsOverride;
    this.engineRecoveryAnchor = validator.engineRecoveryAnchor;
    this.replicaPeakSequenceRecordCount = Math.max(
      this.replicaPeakSequenceRecordCount,
      validator.replicaPeakSequenceRecordCount,
    );
    this.replayCacheBaseVersion = validator.replayCacheBaseVersion;
    this.replayCacheCoveredEventIds = validator.replayCacheCoveredEventIds;
    this.replayCacheEvents = validator.replayCacheEvents;
    this.replayCacheBytes = validator.replayCacheBytes;
    this.replayCacheBudgetBytes = validator.replayCacheBudgetBytes;
    this.releasedCacheAtBudget = validator.releasedCacheAtBudget;
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;
    const counters = this.criticalCheckpoints.snapshotForTransaction();
    this.criticalCheckpoints.restoreTransaction({
      checkpoints:
        validator.criticalCheckpoints.snapshotForTransaction().checkpoints,
      hits: counters.hits,
      misses: counters.misses,
    });
  }

  /**
   * A replica that only runs the cold replay proving a restored text. It
   * starts empty and never records a checkpoint for text it has not
   * replayed.
   */
  private static forValidationReplay(
    replicaId: string,
    initialText: string,
    graph: EventGraph,
  ): EgWalkerReplica {
    // A lazy source keeps the constructor from touching the graph; the replay
    // that follows is the only thing that reads it.
    const validator = new EgWalkerReplica(replicaId, initialText, undefined, {
      skipReplay: true,
      currentVersion: new Set(),
      nextSequenceNumber: 0,
      lazyEventGraph: () => graph,
    });
    validator.eventGraph = graph;
    validator.lazyEventGraph = null;
    return validator;
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
      currentVersion: this.currentVersion,
      engineStats: this.engine?.getStats() ?? null,
      engineStatsOverride: this.engineStatsOverride,
      checkpoints: this.criticalCheckpoints.snapshotForTransaction(),
      fullReplayCount: this.fullReplayCount,
      partialReplayCount: this.partialReplayCount,
      incrementalApplyCount: this.incrementalApplyCount,
      lastReplaySource: this.lastReplaySource,
      replicaPeakSequenceRecordCount: this.replicaPeakSequenceRecordCount,
      restoredSequenceRecords: this.restoredSequenceRecords,
      restoredDeleteTargets: this.restoredDeleteTargets,
      replayCacheBaseVersion: this.replayCacheBaseVersion,
      // Keep the set by reference. New IDs are journaled for the duration of
      // the batch and removed on rollback, avoiding an O(history) clone for
      // every single-event applyRemoteEvent call.
      replayCacheCoveredEventIds: this.replayCacheCoveredEventIds,
      replayCacheCoverageChecks: this.replayCacheCoverageChecks,
      replayCacheEvents: this.replayCacheEvents,
      replayCacheBytes: this.replayCacheBytes,
      replayCacheBudgetBytes: this.replayCacheBudgetBytes,
      releasedCacheAtBudget: this.releasedCacheAtBudget,
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
    this.restoredDeleteTargets = snapshot.restoredDeleteTargets;
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
    // A batch that failed and rolled back never paid for its refusal, so the
    // adaptive budget and the pending refusal both belong to the discarded
    // attempt.
    this.replayCacheBudgetBytes = snapshot.replayCacheBudgetBytes;
    this.releasedCacheAtBudget = snapshot.releasedCacheAtBudget;
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

  private validateIndex(
    index: number,
    allowEnd: boolean,
    document: Utf16DocumentView = this.documentBuffer,
  ): void {
    assertDocumentIndex(index, allowEnd, document);
  }

  private assertNotMidSurrogate(
    index: number,
    document: Utf16DocumentView = this.documentBuffer,
  ): void {
    assertCodePointBoundary(index, document);
  }

  private validateLocalOperation(
    operation: ExternalOperation,
    document: Utf16DocumentView = this.documentBuffer,
  ): ExternalOperation | null {
    if (operation.type === OPERATION_TYPE.INSERT) {
      // Empty inserts are no-ops; skip index validation.
      if (operation.text.length === 0) {
        return null;
      }
      assertWellFormedUtf16(operation.text, "insert text");
      this.validateIndex(operation.index, true, document);
      this.assertNotMidSurrogate(operation.index, document);
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
    this.validateIndex(operation.index, false, document);
    this.assertNotMidSurrogate(operation.index, document);

    if (operation.index + operation.length > document.length) {
      throw new Error(
        `Delete range [${operation.index}, ${operation.index + operation.length}) exceeds document length ${document.length}`,
      );
    }
    this.assertNotMidSurrogate(operation.index + operation.length, document);

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

    replica.applyRemoteEvents(events);
    return replica;
  }

  private fullReplay(): void {
    runSteps(this.fullReplaySteps(UNCHUNKED_REPLAY));
  }

  /**
   * The cold replay as a sequence of steps. {@link fullReplay} runs them back
   * to back. A time-sliced preparation pauses between them, so each step is
   * one bounded unit of work: a chunk of `chunking` events, a section, or the
   * planning pass. The steps leave the same state whatever the chunk sizes.
   */
  private *fullReplaySteps(chunking: ReplayChunking): Steps<void> {
    const graph = this.ensureEventGraph();
    // A rebuild from scratch is exactly the cost a released cache was supposed
    // to avoid. Widen the budget before this replay picks its retention so the
    // interval can stay warm next time instead of thrashing.
    this.growReplayCacheBudgetAfterThrash();
    this.captureEnginePeakBeforeSwap();
    if (graph.isExactLinearHistory()) {
      yield* this.fullReplayLinearGraphSteps(graph, chunking);
      return;
    }
    // Every nonlinear graph has a packed planning view: events added through
    // addEvent are packed behind the prefix, or on their own, for the replay.
    const packedPlan = yield* planPackedCriticalReplaySectionsSteps(
      graph,
      chunking.planningRuns,
    );
    if (packedPlan === null) {
      throw new Error("A nonlinear event graph has no packed replay plan");
    }
    yield;
    yield* this.fullReplayPackedGraphSteps(graph, packedPlan, chunking);
  }

  /**
   * Cold replay for a nonlinear graph, over its packed planning view.
   *
   * The compact planner stores only numeric event order, section ends, and a
   * linear bit per cut. Nonlinear events are materialised one section at a
   * time for the CRDT engine; obsolete linear sections stream directly from
   * packed operation columns. This avoids retaining the full GraphEvent
   * order plus hundreds of thousands of section slices and frontier Sets.
   */
  private *fullReplayPackedGraphSteps(
    graph: EventGraph,
    plan: PackedCriticalReplayPlan,
    chunking: ReplayChunking,
  ): Steps<void> {
    let replayedEventCount = 0;
    let aggregateStats: EngineStats | null = null;
    let retainedEngine: EgWalkerEngine | null = null;
    let retainedBaseCheckpoint: CriticalCheckpoint | null = null;
    let retainedEventIds: ReadonlyArray<EventId> = [];
    let maxLinearBridgeEvents = MIN_LINEAR_BRIDGE_EVENTS;

    this.documentBuffer = PersistentUtf16Rope.from(this.initialText);
    this.documentCache = null;
    this.currentVersion = new Set();

    const retainedCheckpointSectionStart = Math.max(
      0,
      plan.sectionCount - MAX_RETAINED_CHECKPOINTS,
    );
    // Old sections are replayed in coalesced ranges. A range stops at the
    // next ladder cut so that cut's text can be kept as a checkpoint.
    const ladderSections = packedLadderSections(
      plan,
      retainedCheckpointSectionStart,
    );
    let ladderCursor = 0;
    const recordLadderCheckpoint = (rangeEnd: number): void => {
      if (ladderSections[ladderCursor] !== rangeEnd - 1) {
        return;
      }
      ladderCursor++;
      this.criticalCheckpoints.record(
        this.currentVersion,
        this.documentBuffer,
        replayedEventCount,
        plan.eventCount,
      );
    };
    for (let sectionIndex = 0; sectionIndex < plan.sectionCount; ) {
      const coalescedRangeLimit =
        ladderCursor < ladderSections.length
          ? ladderSections[ladderCursor]! + 1
          : retainedCheckpointSectionStart;
      if (
        sectionIndex < retainedCheckpointSectionStart &&
        plan.isLinearSection(sectionIndex)
      ) {
        let sectionEnd = sectionIndex + 1;
        while (
          sectionEnd < coalescedRangeLimit &&
          plan.isLinearSection(sectionEnd)
        ) {
          sectionEnd++;
        }
        yield* this.replayCoalescedPackedLinearSectionsSteps(
          plan,
          sectionIndex,
          sectionEnd,
          chunking.linearEvents,
        );
        replayedEventCount = plan.sectionEndAt(sectionEnd - 1);
        recordLadderCheckpoint(sectionEnd);
        sectionIndex = sectionEnd;
        yield;
        continue;
      }

      let sectionEnd = sectionIndex + 1;
      let sectionEventCount = plan.sectionEventCountAt(sectionIndex);
      if (
        sectionIndex < retainedCheckpointSectionStart &&
        !plan.isLinearSection(sectionIndex)
      ) {
        const grouped = extendPackedNonlinearReplayRange(
          plan,
          sectionIndex,
          coalescedRangeLimit,
          maxLinearBridgeEvents,
        );
        sectionEnd = grouped.endSection;
        sectionEventCount = grouped.eventCount;
      }
      const baseVersion = new Set(this.currentVersion);
      const baseCheckpoint: CriticalCheckpoint = {
        version: baseVersion,
        textBuffer: this.documentBuffer,
        eventCount: replayedEventCount,
      };

      if (plan.isLinearSection(sectionIndex)) {
        yield* this.replayPackedPlanLinearSectionSteps(
          plan,
          sectionIndex,
          replayedEventCount,
          plan.sectionCount === 1,
          chunking.linearEvents,
        );
      } else {
        const endVersion = plan.advanceFrontierRange(
          baseVersion,
          sectionIndex,
          sectionEnd,
        );
        const engine = new EgWalkerEngine();
        const generated = Number.isFinite(chunking.engineEvents)
          ? yield* engine.generatePackedSectionRangeSteps(
              plan,
              sectionIndex,
              sectionEnd,
              graph,
              baseVersion,
              this.documentBuffer,
              chunking.engineEvents,
            )
          : engine.generatePackedSectionRange(
              plan,
              sectionIndex,
              sectionEnd,
              graph,
              baseVersion,
              this.documentBuffer,
            );
        this.documentBuffer = generated.textBuffer;
        this.documentCache = null;
        this.currentVersion = endVersion;
        aggregateStats = mergeEngineStats(aggregateStats, generated.stats);
        maxLinearBridgeEvents = selectPackedLinearBridgeEventLimit(
          generated.stats,
        );

        const isLastSection = sectionEnd === plan.sectionCount;
        if (
          isLastSection &&
          endVersion.size > 1 &&
          this.canRetainReplayEngineWithinBudget(
            sectionEventCount,
            generated.stats,
          )
        ) {
          engine.preparePackedRetention(plan, sectionIndex, sectionEnd);
          retainedEngine = engine;
          retainedBaseCheckpoint = baseCheckpoint;
          retainedEventIds = plan.eventIdsInSectionRange(
            sectionIndex,
            sectionEnd,
          );
        }
      }

      replayedEventCount += sectionEventCount;
      if (sectionIndex >= retainedCheckpointSectionStart) {
        this.criticalCheckpoints.record(
          this.currentVersion,
          this.documentBuffer,
          replayedEventCount,
          plan.eventCount,
        );
      } else {
        recordLadderCheckpoint(sectionEnd);
      }
      sectionIndex = sectionEnd;
      yield;
    }

    if (replayedEventCount !== plan.eventCount) {
      throw new Error("Packed replay plan did not apply every graph event");
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
    this.restoredDeleteTargets = null;
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
  private *fullReplayLinearGraphSteps(
    graph: EventGraph,
    chunking: ReplayChunking,
  ): Steps<void> {
    const eventCount = graph.getEventCount();
    const checkpointStart = Math.max(0, eventCount - MAX_RETAINED_CHECKPOINTS);
    const ladder = coldReplayLadderEventCounts(eventCount, checkpointStart);
    let replayedEventCount = 0;

    this.documentBuffer = PersistentUtf16Rope.from(this.initialText);
    this.documentCache = null;
    this.currentVersion = new Set();

    const packed = graph.getPackedLinearReplayView();
    if (packed === null) {
      let ladderCursor = 0;
      let eventsSinceStep = 0;
      for (const event of graph.iterateEventsInInsertionOrder()) {
        const operation = this.validateLocalOperation(event.operation);
        if (operation !== null) {
          this.applyPlainDocumentOperation(operation);
        }
        replayedEventCount++;
        const onLadder = ladder[ladderCursor] === replayedEventCount;
        if (onLadder) {
          ladderCursor++;
        }
        if (onLadder || replayedEventCount > checkpointStart) {
          this.criticalCheckpoints.record(
            new Set([event.id]),
            this.documentBuffer,
            replayedEventCount,
            eventCount,
          );
        }
        if (++eventsSinceStep >= chunking.linearEvents) {
          eventsSinceStep = 0;
          yield;
        }
      }
    } else {
      for (const cut of ladder) {
        yield* this.replayPackedLinearRangeSteps(
          packed,
          replayedEventCount,
          cut,
          chunking.linearEvents,
        );
        replayedEventCount = cut;
        this.criticalCheckpoints.record(
          new Set([requirePackedEventId(packed, cut - 1)]),
          this.documentBuffer,
          replayedEventCount,
          eventCount,
        );
        yield;
      }
      yield* this.replayPackedLinearRangeSteps(
        packed,
        replayedEventCount,
        checkpointStart,
        chunking.linearEvents,
      );
      replayedEventCount = checkpointStart;
      for (let offset = checkpointStart; offset < packed.count; offset++) {
        const operation = this.validateLocalOperation(
          packed.operationAt(offset),
        );
        if (operation !== null) {
          this.applyPlainDocumentOperation(operation);
        }
        replayedEventCount++;
        this.criticalCheckpoints.record(
          new Set([requirePackedEventId(packed, offset)]),
          this.documentBuffer,
          replayedEventCount,
          eventCount,
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
    this.restoredDeleteTargets = null;
    this.fullReplayCount++;
    this.lastReplaySource = REPLAY_SOURCE.FULL;
    this.refreshReplayCacheMetrics();

    graph.releaseTraversalCaches();
  }

  /**
   * Fold a checkpoint-free range of a packed causal chain into larger rope
   * edits. The decoder has already validated scalar fields and every insert
   * slice; this method validates document-relative indexes while delaying the
   * physical edit until an adjacent run ends.
   */
  private replayPackedLinearRange(
    packed: PackedLinearReplayView,
    startOffset: number,
    endOffset: number,
  ): void {
    this.documentBuffer = replayPackedLinear(
      packed,
      this.documentBuffer,
      endOffset,
      startOffset,
    );
    this.documentCache = null;
  }

  /**
   * {@link replayPackedLinearRange} in steps of `chunkEvents` events over
   * one open piece index.
   */
  private *replayPackedLinearRangeSteps(
    packed: PackedLinearReplayView,
    startOffset: number,
    endOffset: number,
    chunkEvents: number,
  ): Steps<void> {
    const replay = new PackedLinearReplay(
      packed,
      this.documentBuffer,
      endOffset,
      startOffset,
    );
    replay.advance(chunkEvents);
    while (!replay.done) {
      yield;
      replay.advance(chunkEvents);
    }
    this.documentBuffer = replay.finish();
    this.documentCache = null;
  }

  /**
   * Apply one compact-plan linear section without reconstructing parents, in
   * steps of `chunkEvents` events.
   */
  private *replayPackedPlanLinearSectionSteps(
    plan: PackedCriticalReplayPlan,
    sectionIndex: number,
    eventCountBeforeSection: number,
    retainTrailingCheckpoints: boolean,
    chunkEvents: number,
  ): Steps<void> {
    const start = plan.sectionStartAt(sectionIndex);
    const end = plan.sectionEndAt(sectionIndex);
    const checkpointStart = retainTrailingCheckpoints
      ? Math.max(start, end - MAX_RETAINED_CHECKPOINTS)
      : end;

    for (let chunkStart = start; chunkStart < end; ) {
      const chunkEnd = Math.min(end, chunkStart + chunkEvents);
      this.replayPackedPlanLinearRange(
        plan,
        chunkStart,
        chunkEnd,
        start,
        checkpointStart,
        eventCountBeforeSection,
      );
      chunkStart = chunkEnd;
      if (chunkStart < end) {
        yield;
      }
    }

    if (end > start) {
      this.currentVersion = new Set([plan.eventIdAt(end - 1)]);
    }
  }

  /** Events `[chunkStart, chunkEnd)` of a linear section starting at `start`. */
  private replayPackedPlanLinearRange(
    plan: PackedCriticalReplayPlan,
    chunkStart: number,
    chunkEnd: number,
    start: number,
    checkpointStart: number,
    eventCountBeforeSection: number,
  ): void {
    for (let orderIndex = chunkStart; orderIndex < chunkEnd; orderIndex++) {
      const operation = this.validateLocalOperation(
        plan.operationAt(orderIndex),
      );
      if (operation !== null) {
        this.applyPlainDocumentOperation(operation);
      }
      if (orderIndex >= checkpointStart) {
        this.criticalCheckpoints.record(
          new Set([plan.eventIdAt(orderIndex)]),
          this.documentBuffer,
          eventCountBeforeSection + orderIndex - start + 1,
          plan.eventCount,
        );
      }
    }
  }

  /**
   * Coalesce old linear packed sections while streaming raw operation
   * columns. No GraphEvent, parent Set, or per-section array is created.
   * Steps are chunks of `chunkEvents` events over one open piece index.
   */
  private *replayCoalescedPackedLinearSectionsSteps(
    plan: PackedCriticalReplayPlan,
    startSection: number,
    endSection: number,
    chunkEvents: number,
  ): Steps<void> {
    // These sections precede the retained checkpoint window, so no
    // intermediate persistent root is observable. Apply their splices to a
    // one-shot piece index and freeze once at the section-range boundary.
    const replay: CoalescedLinearReplay = {
      editor: new TransientUtf16RopeEditor(this.documentBuffer),
      pendingKind: null,
      pendingIndex: 0,
      pendingLength: 0,
      pendingInsertParts: [],
    };

    const start = plan.sectionStartAt(startSection);
    const end = plan.sectionEndAt(endSection - 1);
    for (let chunkStart = start; chunkStart < end; ) {
      const chunkEnd = Math.min(end, chunkStart + chunkEvents);
      this.replayCoalescedPackedLinearRange(plan, replay, chunkStart, chunkEnd);
      chunkStart = chunkEnd;
      if (chunkStart < end) {
        yield;
      }
    }

    flushCoalescedLinearReplay(replay);
    this.documentBuffer = replay.editor.finish();
    this.documentCache = null;
    if (end > start) {
      this.currentVersion = new Set([plan.eventIdAt(end - 1)]);
    }
  }

  /**
   * Events `[start, end)` of a coalesced linear replay. The pending edit stays
   * open across calls, so chunks coalesce exactly as one call would.
   */
  private replayCoalescedPackedLinearRange(
    plan: PackedCriticalReplayPlan,
    replay: CoalescedLinearReplay,
    start: number,
    end: number,
  ): void {
    const editor = replay.editor;
    for (let orderIndex = start; orderIndex < end; orderIndex++) {
      const operationIndex = plan.operationIndexAt(orderIndex);
      const operationLength = plan.operationLengthAt(orderIndex);

      if (plan.isInsertAt(orderIndex)) {
        if (operationLength === 0) {
          continue;
        }
        const contentStart = plan.insertStartAt(orderIndex);
        const content = plan.sliceInsertedContent(
          contentStart,
          contentStart + operationLength,
        );
        if (
          replay.pendingKind === "insert" &&
          operationIndex === replay.pendingIndex + replay.pendingLength
        ) {
          replay.pendingInsertParts.push(content);
          replay.pendingLength += operationLength;
          continue;
        }

        flushCoalescedLinearReplay(replay);
        this.validateLocalOperation(
          {
            type: OPERATION_TYPE.INSERT,
            index: operationIndex,
            text: content,
          },
          editor,
        );
        replay.pendingKind = "insert";
        replay.pendingIndex = operationIndex;
        replay.pendingLength = operationLength;
        replay.pendingInsertParts = [content];
        continue;
      }

      if (operationLength === 0) {
        continue;
      }
      if (
        replay.pendingKind === "delete" &&
        operationIndex === replay.pendingIndex
      ) {
        const virtualDocumentLength = editor.length - replay.pendingLength;
        if (operationIndex + operationLength > virtualDocumentLength) {
          throw new Error(
            `Delete range [${operationIndex}, ${operationIndex + operationLength}) exceeds document length ${virtualDocumentLength}`,
          );
        }
        const combinedLength = replay.pendingLength + operationLength;
        this.assertNotMidSurrogate(operationIndex + combinedLength, editor);
        replay.pendingLength = combinedLength;
        continue;
      }

      flushCoalescedLinearReplay(replay);
      this.validateLocalOperation(
        {
          type: OPERATION_TYPE.DELETE,
          index: operationIndex,
          length: operationLength,
        },
        editor,
      );
      replay.pendingKind = "delete";
      replay.pendingIndex = operationIndex;
      replay.pendingLength = operationLength;
    }
  }

  private engineStateForSnapshot(
    graph: EventGraph,
    rebuildResumeCache: boolean,
  ): {
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
    if (this.restoredSequenceRecords !== null) {
      return {
        sequenceRecords: this.restoredSequenceRecords,
        deleteTargets: this.restoredDeleteTargets ?? [],
      };
    }
    if (graph.getEventCount() === 0 || !rebuildResumeCache) {
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
    // Restored runtime records describe exactly the frontier captured by their
    // native snapshot. The caller has already appended `event` to `graph`, so
    // they must not survive this graph advance and later be mistaken for a
    // current cache after the live replay engine is evicted.
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;

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
      this.clearSupersededReplayCacheRefusal();
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
      this.clearSupersededReplayCacheRefusal();
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

  /**
   * Drop a pending budget refusal once an incremental apply re-established
   * state.
   *
   * A refusal only justifies growing the budget when the replica had to
   * rebuild the cache straight afterwards. An incremental apply absorbed it
   * instead, so it must not be carried forward and charged to some later,
   * unrelated replay.
   */
  private clearSupersededReplayCacheRefusal(): void {
    this.releasedCacheAtBudget = false;
  }

  /**
   * Widen the replay-cache budget when a refusal cost a full rebuild.
   *
   * A release is only worth its price when the state can be rebuilt cheaply.
   * If the previous release happened at the byte budget and the very next thing
   * the replica had to do was replay from scratch, the budget was too small for
   * this history: nothing was saved and a whole-graph replay was paid for.
   */
  private growReplayCacheBudgetAfterThrash(): void {
    if (!this.releasedCacheAtBudget) {
      return;
    }
    this.releasedCacheAtBudget = false;
    this.replayCacheBudgetBytes = Math.min(
      this.replayCacheBudgetBytes * 2,
      MAX_REPLAY_CACHE_BUDGET_BYTES,
    );
  }

  /**
   * Widen the budget so the cache a partial replay just built is kept, when
   * releasing it would only make the next event rebuild it.
   *
   * The replay started its engine at the newest critical version before the
   * divergence. While the frontier still has more than one head, the
   * divergence is open and the next event on the concurrent branch needs the
   * same interval. Releasing an over-budget cache then saves memory only
   * until that event and pays the whole replay again. That is the thrash a
   * full replay after a refusal detects, and it is treated the same way when
   * this replay rebuilt a refused cache. A rebuild of more than
   * {@link REPLAY_CACHE_CRITICAL_RELEASE_EVENTS} events is that costly from
   * its first refusal, so it does not wait to be paid twice. A smaller cache
   * is cheap to rebuild and is still released the first time.
   *
   * The budget grows in one step to fit the estimate, bounded by
   * {@link MAX_REPLAY_CACHE_BUDGET_BYTES}; a cache above the ceiling is still
   * released.
   */
  private growReplayCacheBudgetToKeepRebuild(
    rebuildsRefusedCache: boolean,
  ): void {
    if (
      this.replayCacheBytes <= this.replayCacheBudgetBytes ||
      this.currentVersion.size <= 1 ||
      (!rebuildsRefusedCache &&
        this.replayCacheEvents <= REPLAY_CACHE_CRITICAL_RELEASE_EVENTS)
    ) {
      return;
    }
    this.replayCacheBudgetBytes = replayCacheBudgetToFit(
      this.replayCacheBudgetBytes,
      this.replayCacheBytes,
    );
  }

  /** Retention check against the adaptive budget, flagging a refusal. */
  private canRetainReplayEngineWithinBudget(
    eventCount: number,
    stats: EngineStats,
  ): boolean {
    const retainable = canRetainReplayEngine(
      eventCount,
      this.documentBuffer,
      stats,
      this.replayCacheBudgetBytes,
    );
    if (!retainable) {
      this.releasedCacheAtBudget = true;
    }
    return retainable;
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
      this.replayCacheEvents * ESTIMATED_DELETE_TARGET_BYTES +
      (this.engineRecoveryAnchor?.estimatedBytes ?? 0);
  }

  private evictReplayCacheIfNeeded(): void {
    const overBudget = this.replayCacheBytes > this.replayCacheBudgetBytes;
    if (
      !overBudget &&
      (this.replayCacheEvents <= REPLAY_CACHE_CRITICAL_RELEASE_EVENTS ||
        this.currentVersion.size > 1)
    ) {
      return;
    }
    if (overBudget && this.engine !== null) {
      this.releasedCacheAtBudget = true;
    }
    this.captureEnginePeakBeforeSwap();
    this.engine = null;
    this.engineStatsOverride = null;
    this.engineRecoveryAnchor = null;
    this.setReplayCacheBase(null);
    this.replayCacheEvents = 0;
    this.replayCacheBytes = 0;
  }

  /**
   * Section 3.6 partial replay of the events after `checkpoint`.
   *
   * Only the last nonlinear critical section after the checkpoint needs CRDT
   * state: every cut before it stays critical whatever arrives later. The
   * sections before it are replayed the way a cold replay replays them, chains
   * straight onto the rope and nonlinear sections in throwaway engines, so the
   * retained engine starts at the nearest critical version before the
   * divergence rather than at the checkpoint, which the checkpoint ladder may
   * have placed up to twice as far back.
   */
  private partialReplayFromCheckpoint(checkpoint: CriticalCheckpoint): void {
    const graph = this.ensureEventGraph();
    // A refusal still pending means this replay rebuilds a cache that was
    // refused at the budget. Settle it here: the end of this replay either
    // keeps the rebuilt cache or records a new refusal.
    const rebuildsRefusedCache = this.releasedCacheAtBudget;
    this.releasedCacheAtBudget = false;
    this.captureEnginePeakBeforeSwap();
    const frontier = graph.getFrontier();
    const sections = graph.planInsertionSuffixSections(
      checkpoint.eventCount,
      checkpoint.version,
    );
    // Consecutive chains are one section, so a suffix without concurrency
    // keeps the whole chain in the engine, as a single replay would.
    let engineSection = sections.length - 1;
    while (engineSection > 0 && sections[engineSection]!.linear) {
      engineSection--;
    }

    let document = checkpoint.textBuffer;
    let peakSequenceRecordCount = 0;
    const fastForwardEnd = Math.max(0, engineSection);
    for (let sectionIndex = 0; sectionIndex < fastForwardEnd; ) {
      const section = sections[sectionIndex]!;
      if (section.linear) {
        document = this.replayChainAtInsertionRanks(
          graph,
          section.start,
          section.end,
          document,
        );
        sectionIndex++;
        continue;
      }
      // One engine lifetime covers nonlinear sections separated only by
      // short chains, as in a cold replay, so a history of many small
      // concurrent sections does not rebuild the document once per section.
      let groupEnd = sectionIndex + 1;
      while (groupEnd < fastForwardEnd) {
        const next = sections[groupEnd]!;
        // A chain joins only together with the nonlinear section after it.
        const joinedEnd = next.linear ? groupEnd + 2 : groupEnd + 1;
        if (
          joinedEnd > fastForwardEnd ||
          (next.linear && next.end - next.start > MAX_LINEAR_BRIDGE_EVENTS) ||
          sections[joinedEnd - 1]!.end - section.start >
            MAX_NONLINEAR_SUPERSECTION_EVENTS
        ) {
          break;
        }
        groupEnd = joinedEnd;
      }
      const events = graph.getRankedReplayEventsInRange(
        section.start,
        sections[groupEnd - 1]!.end,
      );
      const generated = new EgWalkerEngine().generate(events, "", {
        initialVersion: section.baseFrontier,
        initialTextBuffer: document,
        eventGraph: graph,
        eventOrder: events,
        collectTransformedOperations: false,
      });
      document = generated.textBuffer;
      peakSequenceRecordCount = Math.max(
        peakSequenceRecordCount,
        generated.stats.peakSequenceRecordCount,
      );
      sectionIndex = groupEnd;
    }

    const engineStart =
      engineSection === -1
        ? checkpoint.eventCount
        : sections[engineSection]!.start;
    const base: CriticalCheckpoint = {
      version: new Set(
        engineSection === -1
          ? checkpoint.version
          : sections[engineSection]!.baseFrontier,
      ),
      textBuffer: document,
      eventCount: engineStart,
    };
    const result = this.partialReplayer.replayEvents(
      graph,
      base,
      graph.getRankedReplayEventsInRange(engineStart, graph.getEventCount()),
      { collectTransformedOperations: false },
    );
    this.engine = result.engine;
    this.engineRecoveryAnchor = {
      kind: "checkpoint",
      checkpoint: base,
      estimatedBytes: 0,
    };
    this.setReplayCacheBase(base.version, result.replayedEventIds);
    this.replayCacheEvents = result.replayedEventIds.length;
    this.replicaPeakSequenceRecordCount = Math.max(
      this.replicaPeakSequenceRecordCount,
      peakSequenceRecordCount,
    );
    this.documentBuffer = result.textBuffer;
    this.documentCache = null;
    this.currentVersion = frontier;
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;
    this.partialReplayCount++;
    this.lastReplaySource = REPLAY_SOURCE.PARTIAL;
    this.refreshReplayCacheMetrics();
    this.growReplayCacheBudgetToKeepRebuild(rebuildsRefusedCache);
    this.evictReplayCacheIfNeeded();
  }

  /**
   * Apply the chain of events at insertion ranks `[start, end)` to
   * `document`, validating each operation against the text it edits.
   *
   * A long chain goes through a one-shot piece index. Freezing that index
   * rebuilds the whole document, so a short chain edits the persistent rope
   * directly, joining adjacent inserts and deletes into one edit.
   */
  private replayChainAtInsertionRanks(
    graph: EventGraph,
    start: number,
    end: number,
    document: PersistentUtf16Rope,
  ): PersistentUtf16Rope {
    if (end - start >= MIN_TRANSIENT_CHAIN_EVENTS) {
      const editor = new TransientUtf16RopeEditor(document);
      for (let rank = start; rank < end; rank++) {
        const operation = this.validateLocalOperation(
          graph.operationAtInsertionRank(rank),
          editor,
        );
        if (operation === null) {
          continue;
        }
        if (operation.type === OPERATION_TYPE.INSERT) {
          editor.insert(operation.index, operation.text);
        } else {
          editor.delete(operation.index, operation.length);
        }
      }
      return editor.finish();
    }

    let rope = document;
    let pendingKind: "insert" | "delete" | null = null;
    let pendingIndex = 0;
    let pendingLength = 0;
    let pendingInsertParts: string[] = [];
    const flush = (): void => {
      if (pendingKind === "insert") {
        rope = rope.insert(pendingIndex, pendingInsertParts.join(""));
      } else if (pendingKind === "delete") {
        rope = rope.delete(pendingIndex, pendingLength);
      }
      pendingKind = null;
      pendingLength = 0;
      pendingInsertParts = [];
    };

    for (let rank = start; rank < end; rank++) {
      const operation = graph.operationAtInsertionRank(rank);
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
        this.validateLocalOperation(operation, rope);
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
        const virtualDocumentLength = rope.length - pendingLength;
        if (operation.index + operation.length > virtualDocumentLength) {
          throw new Error(
            `Delete range [${operation.index}, ${operation.index + operation.length}) exceeds document length ${virtualDocumentLength}`,
          );
        }
        const combinedLength = pendingLength + operation.length;
        this.assertNotMidSurrogate(operation.index + combinedLength, rope);
        pendingLength = combinedLength;
        continue;
      }
      flush();
      this.validateLocalOperation(operation, rope);
      pendingKind = "delete";
      pendingIndex = operation.index;
      pendingLength = operation.length;
    }
    flush();
    return rope;
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

/** Copy a causal builder's exact chain into columns. */
const linearBatchFromOwnedEvents = (
  events: ReadonlyArray<GraphEvent>,
): LinearEventBatch => {
  const batch = new LinearEventBatch(events[0]!.parentVersion);
  for (const event of events) {
    const operation = event.operation;
    if (operation.type === OPERATION_TYPE.INSERT) {
      batch.appendInsert(
        event.id,
        operation.index,
        operation.text,
        event.timestamp,
      );
    } else {
      batch.appendDelete(
        event.id,
        operation.index,
        operation.length,
        event.timestamp,
      );
    }
  }
  return batch.finish();
};

/** Build the graph's own event object for one event of a linear batch. */
const ownedLinearBatchEvent = (
  batch: LinearEventBatch,
  offset: number,
): GraphEvent => ({
  id: batch.idAt(offset)!,
  operation: batch.operationAt(offset),
  parentVersion:
    offset === 0
      ? new Set(batch.firstParents)
      : new Set([batch.idAt(offset - 1)!]),
  timestamp: batch.timestampAt(offset),
});

/**
 * Per-event results of an integrated linear batch. A causal extension is
 * applied to the plain document as given, so each event's position operation
 * is its own operation, and `null` when it changes nothing.
 */
const linearBatchResults = (
  batch: LinearEventBatch,
): ApplyRemoteEventsResult => {
  const results: ApplyRemoteEventResult[] = [];
  const operations: PositionOperation[] = [];
  for (let offset = 0; offset < batch.count; offset++) {
    const index = batch.operationIndexAt(offset);
    const length = batch.operationLengthAt(offset);
    const operation: PositionOperation | null =
      length === 0
        ? null
        : batch.isInsertAt(offset)
          ? { type: OPERATION_TYPE.INSERT, index, length }
          : { type: OPERATION_TYPE.DELETE, index, length };
    results.push({ status: APPLY_REMOTE_EVENT_STATUS.Integrated, operation });
    if (operation !== null) {
      operations.push(operation);
    }
  }
  return { results, operations };
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

const requirePackedEventId = (
  packed: PackedLinearReplayView,
  offset: number,
): EventId => {
  const eventId = packed.idAt(offset);
  if (eventId === undefined) {
    throw new Error(`Packed graph is missing event at offset ${offset}`);
  }
  return eventId;
};

/**
 * Sections before the trailing checkpoint window whose end is a ladder cut,
 * in replay order. See {@link coldReplayLadderEventCounts}.
 */
const packedLadderSections = (
  plan: PackedCriticalReplayPlan,
  retainedSectionStart: number,
): number[] => {
  if (retainedSectionStart === 0) {
    return [];
  }
  const sections: number[] = [];
  const limit = plan.sectionEndAt(retainedSectionStart - 1) + 1;
  for (const cut of coldReplayLadderEventCounts(plan.eventCount, limit)) {
    const section = plan.lastSectionEndingAtOrBefore(cut);
    if (section >= 0 && section !== sections[sections.length - 1]) {
      sections.push(section);
    }
  }
  return sections;
};

interface PackedNonlinearReplayRange {
  readonly endSection: number;
  readonly eventCount: number;
}

/**
 * Extend one obsolete nonlinear packed range across only short linear gaps.
 *
 * The returned range always starts and ends with a nonlinear section. A
 * trailing linear run is deliberately left to the direct rope path, and the
 * caller-provided limit keeps the retained checkpoint window independent.
 */
const extendPackedNonlinearReplayRange = (
  plan: PackedCriticalReplayPlan,
  startSection: number,
  endSectionLimit: number,
  maxLinearBridgeEvents: number,
): PackedNonlinearReplayRange => {
  let endSection = startSection + 1;
  let eventCount = plan.sectionEventCountAt(startSection);

  while (endSection < endSectionLimit) {
    let candidateSection = endSection;
    let bridgeEventCount = 0;
    while (
      candidateSection < endSectionLimit &&
      plan.isLinearSection(candidateSection)
    ) {
      bridgeEventCount += plan.sectionEventCountAt(candidateSection);
      if (bridgeEventCount > maxLinearBridgeEvents) {
        return { endSection, eventCount };
      }
      candidateSection++;
    }

    // Do not absorb a trailing linear tail: without another nonlinear cut,
    // the direct packed replay path is strictly less stateful.
    if (candidateSection >= endSectionLimit) {
      break;
    }

    const candidateEventCount =
      bridgeEventCount + plan.sectionEventCountAt(candidateSection);
    if (eventCount + candidateEventCount > MAX_NONLINEAR_SUPERSECTION_EVENTS) {
      break;
    }
    eventCount += candidateEventCount;
    endSection = candidateSection + 1;
  }

  return { endSection, eventCount };
};

/** @internal Deterministic pressure feedback for obsolete packed replay. */
export const selectPackedLinearBridgeEventLimit = (
  stats: EngineStats,
): number => {
  const estimatedTransientBytes =
    stats.peakSequenceRecordCount * ESTIMATED_REPLAY_RECORD_BYTES +
    stats.eventsProcessed * ESTIMATED_DELETE_TARGET_BYTES;
  if (
    stats.peakSequenceRecordCount <= LOW_BRIDGE_PRESSURE_RECORDS &&
    estimatedTransientBytes <= LOW_BRIDGE_PRESSURE_BYTES
  ) {
    return MAX_LINEAR_BRIDGE_EVENTS;
  }
  if (
    stats.peakSequenceRecordCount <= MID_BRIDGE_PRESSURE_RECORDS &&
    estimatedTransientBytes <= MID_BRIDGE_PRESSURE_BYTES
  ) {
    return MID_LINEAR_BRIDGE_EVENTS;
  }
  return MIN_LINEAR_BRIDGE_EVENTS;
};

const canRetainReplayEngine = (
  eventCount: number,
  document: PersistentUtf16Rope,
  stats: EngineStats,
  budgetBytes: number,
): boolean =>
  document.length * 2 +
    stats.sequenceRecordCount * ESTIMATED_REPLAY_RECORD_BYTES +
    eventCount * ESTIMATED_DELETE_TARGET_BYTES <=
  budgetBytes;

/**
 * `budget` doubled as many times as a cache of `estimatedBytes` needs, at
 * most {@link MAX_REPLAY_CACHE_BUDGET_BYTES}. The budget stays a power-of-two
 * multiple of {@link MAX_REPLAY_CACHE_BYTES}, so the result is what repeated
 * thrash would reach one doubling at a time.
 */
const replayCacheBudgetToFit = (
  budget: number,
  estimatedBytes: number,
): number =>
  budget >= estimatedBytes || budget >= MAX_REPLAY_CACHE_BUDGET_BYTES
    ? Math.min(budget, MAX_REPLAY_CACHE_BUDGET_BYTES)
    : replayCacheBudgetToFit(budget * 2, estimatedBytes);

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

/** Scheduling hooks a host may provide; all optional. */
interface HostScheduling {
  readonly scheduler?: { readonly yield?: () => Promise<void> };
  readonly setImmediate?: (callback: () => void) => unknown;
  readonly MessageChannel?: typeof MessageChannel;
  readonly performance?: { readonly now?: () => number };
}

const host = globalThis as HostScheduling;

const monotonicNow = (): number => host.performance?.now?.() ?? Date.now();

/** The default {@link PrepareReplicaOptions.yieldToHost}. */
const yieldToHostDefault = (): Promise<void> => {
  const scheduler = host.scheduler;
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield();
  }
  const setImmediate = host.setImmediate;
  if (typeof setImmediate === "function") {
    return new Promise((resolve) => {
      setImmediate(() => resolve());
    });
  }
  const Channel = host.MessageChannel;
  if (typeof Channel === "function") {
    return new Promise((resolve) => {
      const channel = new Channel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
};

const prepareSliceMsOf = (sliceMs: number | undefined): number => {
  if (sliceMs === undefined) {
    return DEFAULT_PREPARE_SLICE_MS;
  }
  if (typeof sliceMs !== "number" || Number.isNaN(sliceMs) || sliceMs < 0) {
    throw new RangeError(
      `prepare() sliceMs must be a non-negative number, got ${String(sliceMs)}`,
    );
  }
  return sliceMs;
};

/**
 * Open state of a coalesced linear replay: the piece index and the edit
 * still being extended. See `replayCoalescedPackedLinearSectionsSteps`.
 */
interface CoalescedLinearReplay {
  readonly editor: TransientUtf16RopeEditor;
  pendingKind: "insert" | "delete" | null;
  pendingIndex: number;
  pendingLength: number;
  pendingInsertParts: string[];
}

const flushCoalescedLinearReplay = (replay: CoalescedLinearReplay): void => {
  if (replay.pendingKind === "insert") {
    replay.editor.insert(
      replay.pendingIndex,
      replay.pendingInsertParts.length === 1
        ? replay.pendingInsertParts[0]!
        : replay.pendingInsertParts.join(""),
    );
  } else if (replay.pendingKind === "delete") {
    replay.editor.delete(replay.pendingIndex, replay.pendingLength);
  }
  replay.pendingKind = null;
  replay.pendingLength = 0;
  replay.pendingInsertParts = [];
};

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

function assertNativeSnapshotResumeCacheMode(
  mode: unknown,
): asserts mode is NativeSnapshotResumeCacheMode {
  if (mode !== "none" && mode !== "available" && mode !== "rebuild") {
    throw new Error(
      `Invalid native snapshot resume-cache mode: ${String(mode)}`,
    );
  }
}
