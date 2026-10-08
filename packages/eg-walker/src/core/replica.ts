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
  advanceCriticalCut,
  emptyIntervalAuthors,
  isCriticalCutConfirmed,
  openCriticalCut,
  scanIntervalAuthors,
  type IntervalAuthors,
  type PendingCriticalCut,
} from "./internals/critical-cut-confirmation";
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
  planPackedSuffixCriticalReplaySections,
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
  createTrustedNativeSnapshot,
  NATIVE_SNAPSHOT_FORMAT_VERSION,
  type NativeSnapshot,
  validateGraphMatchesSnapshot,
  validateNativeSnapshotHeaderOnly,
  validateNativeSnapshotWithGraph,
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

// Release large caches at a critical cut once its authors have built on it
// (see `isAtConfirmedCriticalCut`), unless a release had to be rebuilt (see
// `retainReplayCacheAcrossCuts`), but keep an active concurrent interval warm
// until its estimated byte budget is exhausted.
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
  readonly retiredEngineStats: EngineStats | null;
  readonly fullReplayEvents: number;
  readonly partialReplayEvents: number;
  readonly replayCacheEvictions: number;
  readonly replayCacheBudgetRefusals: number;
  readonly checkpoints: CriticalCheckpointStoreSnapshot;
  readonly fullReplayCount: number;
  readonly partialReplayCount: number;
  readonly incrementalApplyCount: number;
  readonly lastReplaySource: ReplaySource | null;
  readonly replicaPeakSequenceRecordCount: number;
  readonly restoredSequenceRecords: ReadonlyArray<EngineSequenceRecord> | null;
  readonly restoredDeleteTargets: ReadonlyArray<DeleteTargetRecord> | null;
  readonly replayCacheBaseVersion: Version | null;
  readonly replayCacheBaseEventCount: number;
  readonly replayCacheBaseLocalVersions: ReadonlyArray<number>;
  readonly replayCacheCoverageChecks: number;
  readonly replayCacheEvents: number;
  readonly replayCacheBytes: number;
  readonly replayCacheBudgetBytes: number;
  readonly releasedCacheAtBudget: boolean;
  readonly replayCacheCriticalReleaseCut: number;
  readonly retainReplayCacheAcrossCuts: boolean;
  readonly replayCacheAuthors: IntervalAuthors;
  readonly pendingCriticalCut: PendingCriticalCut | null;
  readonly engineRecoveryAnchor: EngineRecoveryAnchor | null;
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

/** What a partial replay leaves for the replica to adopt. */
interface SuffixReplay {
  /** Engine over the last nonlinear section after the checkpoint, onwards. */
  readonly engine: EgWalkerEngine;
  /** Where that engine starts: the newest critical cut before it. */
  readonly base: CriticalCheckpoint;
  readonly textBuffer: PersistentUtf16Rope;
  /** Peak records of the throwaway engines before {@link base}. */
  readonly peakSequenceRecordCount: number;
}

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
  /**
   * The version the document text is at. It is often the graph's live
   * frontier view ({@link EventGraph.getFrontierView}), which follows every
   * later append, so a reader that needs this version after the graph changes
   * must copy it first.
   */
  private currentVersion: Version = new Set();
  private nextSequenceNumber = 0;
  private engine: EgWalkerEngine | null = null;
  /** Exact diagnostic view retained across an exceptional engine rebuild. */
  private engineStatsOverride: EngineStats | null = null;
  /** Completed engine lifetimes, excluding the engine still in use. */
  private retiredEngineStats: EngineStats | null = null;
  /** Restored history excluded from lifetime work, even after engine retirement. */
  private restoredEngineEventBaseline = 0;
  private fullReplayEvents = 0;
  private partialReplayEvents = 0;
  private replayCacheEvictions = 0;
  private replayCacheBudgetRefusals = 0;
  private replayCacheBaseVersion: Version | null = null;
  /**
   * Events before the replay-cache base's cut, which is the base version's
   * closure. While the cache lives, every event at or after this insertion
   * rank descends from the base: an event that does not is never applied to
   * the cache, it replaces the cache with a replay. Coverage is then a check
   * of an event's direct parents, whatever the history's length.
   */
  private replayCacheBaseEventCount = 0;
  /** Local versions of {@link replayCacheBaseVersion}'s events. */
  private replayCacheBaseLocalVersions: ReadonlyArray<number> = [];
  private readonly coverageParents: number[] = [];
  private readonly pushCoverageParent = (parent: number): void => {
    this.coverageParents.push(parent);
  };
  private replayCacheCoverageChecks = 0;
  private snapshotValidationStats = { replays: 0, events: 0, linearReplays: 0 };
  private replayCacheEvents = 0;
  private replayCacheBytes = 0;
  /** Adaptive budget; grows only after a refusal forced a full rebuild. */
  private replayCacheBudgetBytes = MAX_REPLAY_CACHE_BYTES;
  /** True while a byte-budget refusal has not yet been paid for by a replay. */
  private releasedCacheAtBudget = false;
  /** Event count at the last release of a replay cache at a critical cut. */
  private replayCacheCriticalReleaseCut = -1;
  /**
   * Keep the replay cache across critical cuts while batches arrive.
   *
   * A cache of more than {@link REPLAY_CACHE_CRITICAL_RELEASE_EVENTS} events
   * is released at the next critical cut, a bet that later events do not
   * reach back past it. A long-lived branch that is merged and then extended
   * again loses that bet: its next event is concurrent with everything since
   * the branch's last cut, and the partial replay that follows rebuilds the
   * events the release dropped, as often as the branch is extended. When a
   * partial replay for a batch rebuilt more than
   * REPLAY_CACHE_CRITICAL_RELEASE_EVENTS events from before the last release,
   * the cache it builds is kept until it is released for its size or dropped
   * by a linear batch. Single events still release it at a confirmed critical
   * cut: a kept engine would integrate every event after the cut, where a
   * release lets the linear ones edit the text directly.
   */
  private retainReplayCacheAcrossCuts = false;
  /** Authors of the replay cache's interval, counted up to a cursor. */
  private replayCacheAuthors: IntervalAuthors = emptyIntervalAuthors(0);
  /**
   * The singleton frontier the replay cache waits to be released at; see
   * {@link isAtConfirmedCriticalCut}.
   */
  private pendingCriticalCut: PendingCriticalCut | null = null;
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
        : this.ensureEventGraph().getFrontierView();
    if (this.engine !== null) {
      // Native resume state is guaranteed only for forward continuation from
      // its captured frontier. A divergent suffix falls back to a retained
      // checkpoint instead of treating restored runtime indexes as a cold
      // full-graph cache.
      this.setReplayCacheBase(
        this.currentVersion,
        this.ensureEventGraph().getEventCount(),
      );
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
   * The text and the event graph as JSON (see `EventGraph.serialize`).
   *
   * For debugging, tests and interop on small documents, not for storage: it
   * builds an object for every event and is two to three orders of magnitude
   * larger than EGW4 on the paper's keystroke traces. Store a document with
   * {@link createPortableSnapshot} and `PortableSnapshotCodec` instead.
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
   *
   * The graph is encoded once as EGW4, as {@link createPortableSnapshot}
   * does. `eventGraph` is decoded from those bytes only when read, and
   * `NativeSnapshotCodec.encode` writes them without revalidating the
   * graph while the snapshot keeps the fields it was created with.
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

    let encoded: ReturnType<EventGraph["encodeTopologicalBinary"]>;
    try {
      encoded = graph.encodeTopologicalBinary();
    } finally {
      graph.releaseTraversalCaches();
    }
    return createTrustedNativeSnapshot(
      {
        formatVersion: NATIVE_SNAPSHOT_FORMAT_VERSION,
        text: this.getText(),
        initialText: this.initialText,
        currentVersion: [...encoded.frontier],
        eventCount: graph.getEventCount(),
        nextSequenceNumber: this.nextSequenceNumber,
        metadata: graph.getMetadata(),
        sequenceRecords: engineState.sequenceRecords,
        deleteTargets: engineState.deleteTargets,
        checkpoints:
          resumeCache === "none" ? [] : this.criticalCheckpoints.toSnapshot(),
      },
      encoded.binary,
    );
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

  /**
   * Rebuild a replica from {@link serialize} JSON by replaying its whole
   * history. Open a stored portable snapshot with
   * {@link fromPortableSnapshot} instead.
   */
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
            const full = validateNativeSnapshotWithGraph(snapshot);
            sequenceRecords = full.snapshot.sequenceRecords;
            deleteTargets = full.snapshot.deleteTargets;
            graph = full.graph;
            return full.snapshot;
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

    const replica = new EgWalkerReplica(
      replicaId,
      validated.initialText,
      graph,
      {
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
      },
    );
    replica.restoredEngineEventBaseline =
      restoredEngine?.getStats().eventsProcessed ?? 0;
    return replica;
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
      // The current version can be the graph's live frontier, which this
      // append changes; the event keeps the parents it was created with.
      parentVersion: new Set(this.currentVersion),
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
    this.advanceWithEvent(event, true);
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

    const extendsCurrentVersion = versionsEqual(
      cloned.parentVersion,
      this.currentVersion,
    );
    const snapshot = this.captureRemoteBatchSnapshot();
    const transaction = graph.beginAppendTransaction();
    try {
      graph.addEvent(cloned);
      const effect = this.advanceWithEvent(cloned, extendsCurrentVersion);
      transaction.commit();
      return {
        status: APPLY_REMOTE_EVENT_STATUS.Integrated,
        operation: effect.operation,
      };
    } catch (error) {
      transaction.rollback();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
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
    const columns = inspectCausalEventBatch(batch);
    const graph = this.ensureEventGraph();
    if (this.ensureRemoteEvents().pendingCount !== 0) {
      throw new Error(
        "Cannot apply a causal batch while remote events are pending",
      );
    }
    if (columns.count === 0) {
      consumeCausalEventBatch(batch);
      return;
    }

    const snapshot = this.captureRemoteBatchSnapshot();
    const transaction = graph.beginAppendTransaction();
    const eventCountBeforeBatch = graph.getEventCount();

    try {
      const extendsCurrent =
        columns.exactChain &&
        versionsEqual(columns.eventAt(0).parentVersion, this.currentVersion);
      graph.appendCausalColumns(columns);
      if (extendsCurrent) {
        this.applyLinearBatch(columns, eventCountBeforeBatch);
      } else {
        // Only the bounded warm path needs wrappers. Cold replay reads the
        // adopted columns directly, including for non-linear histories.
        const warm =
          this.engine !== null &&
          columns.count <= MAX_WARM_BATCH_EVENTS &&
          this.tryApplyWarmBatch(
            Array.from({ length: columns.count }, (_, offset) =>
              columns.eventAt(offset),
            ),
            graph,
          );
        if (!warm) {
          this.engineStatsOverride = null;
          const checkpoint = this.criticalCheckpoints.pickFor(graph);
          if (checkpoint === null) {
            this.fullReplay();
          } else {
            this.partialReplayFromCheckpoint(checkpoint, true);
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
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    }
    if (columns.sealedOperations !== null) {
      graph.compactEventColumns(
        eventCountBeforeBatch === 0 ? columns.sealedOperations : undefined,
      );
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
      return {
        results: prepared.results,
        operations: operationsAreExact ? operations : null,
      };
    } catch (error) {
      transaction.rollback();
      remoteTransaction.rollback();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    }
  }

  /**
   * Integrate a causally-closed batch without invoking the single-event
   * pending/drain path. Linear batches edit the persistent rope directly,
   * unless a retained replay engine integrates them (see
   * {@link keepsReplayCacheThroughChain}); divergent batches append once and
   * replay once, so a batch of N events cannot accidentally trigger N
   * successively larger replays.
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
      const linear =
        orderedLinear ?? isLinearBatchFromVersion(events, this.currentVersion);
      if (linear && !this.keepsReplayCacheThroughChain(events.length)) {
        const operations = this.applyClosedLinearBatch(prepared, graph);
        transaction.commit();
        return { results: prepared.results, operations };
      }

      // A causal extension changes the document by its own operations.
      const operations: PositionOperation[] | null = linear ? [] : null;
      for (const candidate of prepared.candidates) {
        graph.addEvent(candidate.event);
        const operation = linear
          ? toPositionOperation(candidate.event.operation)
          : null;
        prepared.results[candidate.inputIndex] = {
          status: APPLY_REMOTE_EVENT_STATUS.Integrated,
          operation,
        };
        if (operation !== null) {
          operations?.push(operation);
        }
      }

      if (!this.tryApplyWarmBatch(events, graph)) {
        this.engineStatsOverride = null;
        const checkpoint = this.criticalCheckpoints.pickFor(graph);
        if (checkpoint === null) {
          this.fullReplay();
        } else {
          this.partialReplayFromCheckpoint(checkpoint, true);
          this.maybeAdvanceCheckpoint();
        }
      }

      transaction.commit();
      return { results: prepared.results, operations };
    } catch (error) {
      transaction.rollback();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      throw error;
    }
  }

  /**
   * Whether a retained replay engine integrates a causal chain of
   * `eventCount` events rather than being dropped for it.
   *
   * The chain alone does not need the engine: it edits the text directly.
   * But an event concurrent with the chain may still be in flight, and when
   * the history has no critical version left, as under sustained
   * concurrency, the engine dropped here is rebuilt by replaying the whole
   * history. So the engine integrates the chain as it would the same events
   * one at a time, and is released only at a confirmed critical cut (see
   * {@link isAtConfirmedCriticalCut}). A chain longer than a warm batch still
   * drops it.
   */
  private keepsReplayCacheThroughChain(eventCount: number): boolean {
    return this.engine !== null && eventCount <= MAX_WARM_BATCH_EVENTS;
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
    events: ReadonlyArray<Pick<GraphEvent, "id" | "operation">>,
    graph: EventGraph,
  ): boolean {
    if (this.engine === null || events.length > MAX_WARM_BATCH_EVENTS)
      return false;
    this.engineStatsOverride = null;
    // The caller appended the batch last, so it holds the newest local
    // versions, in order.
    const firstLocalVersion = graph.getEventCount() - events.length;
    for (let offset = 0; offset < events.length; offset++) {
      if (!this.replayCacheCoversEventAt(graph, firstLocalVersion + offset)) {
        return false;
      }
    }
    this.documentBuffer = this.engine.applyEventBatch(
      events,
      graph,
      firstLocalVersion,
    );
    this.documentCache = null;
    this.replayCacheEvents += events.length;
    this.refreshReplayCacheMetrics();
    this.currentVersion = graph.getFrontierView();
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;
    this.incrementalApplyCount += events.length;
    this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
    this.clearSupersededReplayCacheRefusal();
    this.growReplayCacheBudgetToKeepRebuild(false);
    this.evictReplayCacheIfNeeded(this.retainReplayCacheAcrossCuts);
    this.maybeAdvanceCheckpoint();
    return true;
  }

  private applyClosedLinearBatch(
    prepared: PreparedRemoteBatch,
    graph: EventGraph,
  ): ReadonlyArray<PositionOperation> {
    const previousStats = this.engineStatsOverride ?? this.engine?.getStats();
    if (this.engine !== null) this.replayCacheEvictions++;
    this.captureEngineStatsBeforeSwap();
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

    try {
      this.applyLinearBatch(batch, eventCountBeforeBatch);
      transaction.commit();
    } catch {
      transaction.rollback();
      this.restoreRemoteBatchSnapshot(snapshot, graph);
      return null;
    }
    return linearBatchResults(batch);
  }

  /**
   * Apply an exact chain the graph already holds. A causal extension is
   * expressed in the plain document's indexes, so unless a retained replay
   * engine integrates the chain (see {@link keepsReplayCacheThroughChain}),
   * the engine is dropped and the chain edits the text directly. Edits before
   * the retained-checkpoint window are coalesced into rope splices; each
   * event in the window is applied and checkpointed on its own.
   */
  private applyLinearBatch(
    batch: LinearChainEvents,
    eventCountBeforeBatch: number,
  ): void {
    if (this.keepsReplayCacheThroughChain(batch.count)) {
      const events = Array.from({ length: batch.count }, (_unused, offset) => ({
        id: requirePackedEventId(batch, offset),
        operation: batch.operationAt(offset),
      }));
      if (this.tryApplyWarmBatch(events, this.ensureEventGraph())) {
        return;
      }
    }
    const previousStats = this.engineStatsOverride ?? this.engine?.getStats();
    if (this.engine !== null) this.replayCacheEvictions++;
    this.captureEngineStatsBeforeSwap();
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
   * - `replayedEvents` counts full and partial replay events plus successful
   *   snapshot validation events, including chains replayed without an engine.
   *   Incremental applies are separate. All work counters roll back with a
   *   rejected batch; they describe committed work, not failed attempts.
   * - `lifetime*` counters include discarded engines and successful snapshot
   *   validation. They survive cache release and engine replacement.
   * - `currentEngineStats` describes only the retained engine (null if absent).
   *   Legacy fields such as `engineRetreats`, `sequenceTreeOperations` and
   *   `fugueComparisons` retain their engine/latest-replay scope.
   * - `peakSequenceRecordCount` is monotonic across the replica's lifetime:
   *   the engine's own peak resets on every partial/full replay engine swap,
   *   so we max in {@link replicaPeakSequenceRecordCount} (the peak captured
   *   from prior engines) here.
   * - `engineEventsProcessed`, `recordSplitCount`, `prepareToggleCount` and
   *   `placeholderStructuralOperations` describe the state the replay engines
   *   built (see {@link EngineStats}). With the record counts, they show how
   *   fragmented that state is: how many events each record holds, and how
   *   many events a transition moves per record it toggles.
   */
  getReplayStats(): {
    /** Successful cold portable-snapshot text validations, separate from live replays. */
    readonly snapshotValidationReplays: number;
    readonly snapshotValidationEvents: number;
    readonly snapshotValidationLinearReplays: number;
    /** Total replayed events, including successful snapshot validation. */
    readonly replayedEvents: number;
    /** Live full replays, excluding snapshot validation. */
    readonly fullReplayEvents: number;
    /** Entire suffix replayed after the selected checkpoint, including chains. */
    readonly partialReplayEvents: number;
    /** Retained engines released by policy or a direct linear apply. */
    readonly replayCacheEvictions: number;
    /** Retention checks/evictions refused by the byte budget. */
    readonly replayCacheBudgetRefusals: number;
    readonly replayCacheBudgetBytes: number;
    readonly currentEngineStats: EngineStats | null;
    readonly lifetimeRetreats: number;
    readonly lifetimeAdvances: number;
    readonly lifetimeSequenceTreeOperations: number;
    readonly lifetimeIntegrationProbeCount: number;
    readonly lifetimeFugueComparisons: number;
    readonly lifetimeFugueMarkerOperations: number;
    readonly lifetimeFugueRotations: number;
    readonly lifetimeFugueRebuilds: number;
    readonly lifetimeEngineEventsProcessed: number;
    readonly lifetimeRecordSplitCount: number;
    readonly lifetimePrepareToggleCount: number;
    readonly lifetimePlaceholderStructuralOperations: number;
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
    /** Events the replay engines replayed: the nonlinear part of a cold replay. */
    readonly engineEventsProcessed: number;
    readonly recordSplitCount: number;
    readonly prepareToggleCount: number;
    readonly placeholderStructuralOperations: number;
  } {
    const liveEngineStats = this.engine?.getStats();
    const engineStats = this.engineStatsOverride ?? liveEngineStats;
    const lifetimeStats = liveEngineStats
      ? mergeEngineStats(this.retiredEngineStats, liveEngineStats)
      : this.retiredEngineStats;
    return {
      snapshotValidationReplays: this.snapshotValidationStats.replays,
      snapshotValidationEvents: this.snapshotValidationStats.events,
      snapshotValidationLinearReplays:
        this.snapshotValidationStats.linearReplays,
      replayedEvents:
        this.fullReplayEvents +
        this.partialReplayEvents +
        this.snapshotValidationStats.events,
      fullReplayEvents: this.fullReplayEvents,
      partialReplayEvents: this.partialReplayEvents,
      replayCacheEvictions: this.replayCacheEvictions,
      replayCacheBudgetRefusals: this.replayCacheBudgetRefusals,
      replayCacheBudgetBytes: this.replayCacheBudgetBytes,
      currentEngineStats: liveEngineStats ?? null,
      lifetimeRetreats: lifetimeStats?.retreatCount ?? 0,
      lifetimeAdvances: lifetimeStats?.advanceCount ?? 0,
      lifetimeSequenceTreeOperations:
        lifetimeStats?.sequenceTreeOperations ?? 0,
      lifetimeIntegrationProbeCount: lifetimeStats?.integrationProbeCount ?? 0,
      lifetimeFugueComparisons: lifetimeStats?.fugueComparisons ?? 0,
      lifetimeFugueMarkerOperations: lifetimeStats?.fugueMarkerOperations ?? 0,
      lifetimeFugueRotations: lifetimeStats?.fugueRotations ?? 0,
      lifetimeFugueRebuilds: lifetimeStats?.fugueRebuilds ?? 0,
      lifetimeEngineEventsProcessed:
        (lifetimeStats?.eventsProcessed ?? 0) -
        this.restoredEngineEventBaseline,
      lifetimeRecordSplitCount: lifetimeStats?.recordSplitCount ?? 0,
      lifetimePrepareToggleCount: lifetimeStats?.prepareToggleCount ?? 0,
      lifetimePlaceholderStructuralOperations:
        lifetimeStats?.placeholderStructuralOperations ?? 0,
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
      engineEventsProcessed: engineStats?.eventsProcessed ?? 0,
      recordSplitCount: engineStats?.recordSplitCount ?? 0,
      prepareToggleCount: engineStats?.prepareToggleCount ?? 0,
      placeholderStructuralOperations:
        engineStats?.placeholderStructuralOperations ?? 0,
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
    this.retiredEngineStats = validator.retiredEngineStats;
    this.replayCacheEvictions += validator.replayCacheEvictions;
    this.replayCacheBudgetRefusals += validator.replayCacheBudgetRefusals;
    this.engineRecoveryAnchor = validator.engineRecoveryAnchor;
    this.replicaPeakSequenceRecordCount = Math.max(
      this.replicaPeakSequenceRecordCount,
      validator.replicaPeakSequenceRecordCount,
    );
    this.replayCacheBaseVersion = validator.replayCacheBaseVersion;
    this.replayCacheBaseEventCount = validator.replayCacheBaseEventCount;
    this.replayCacheBaseLocalVersions = validator.replayCacheBaseLocalVersions;
    this.replayCacheEvents = validator.replayCacheEvents;
    this.replayCacheBytes = validator.replayCacheBytes;
    this.replayCacheBudgetBytes = validator.replayCacheBudgetBytes;
    this.releasedCacheAtBudget = validator.releasedCacheAtBudget;
    this.replayCacheCriticalReleaseCut =
      validator.replayCacheCriticalReleaseCut;
    this.retainReplayCacheAcrossCuts = validator.retainReplayCacheAcrossCuts;
    this.replayCacheAuthors = validator.replayCacheAuthors;
    this.pendingCriticalCut = validator.pendingCriticalCut;
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
      extendsCurrentVersion: (event) =>
        versionsEqual(event.parentVersion, this.currentVersion),
      advanceWithEvent: (event, extendsCurrentVersion) =>
        this.advanceWithEvent(event, extendsCurrentVersion),
    });
  }

  private captureRemoteBatchSnapshot(): RemoteBatchSnapshot {
    return {
      documentBuffer: this.documentBuffer,
      documentCache: this.documentCache,
      currentVersion: this.currentVersion,
      engineStats: this.engine?.getStats() ?? null,
      engineStatsOverride: this.engineStatsOverride,
      retiredEngineStats: this.retiredEngineStats,
      fullReplayEvents: this.fullReplayEvents,
      partialReplayEvents: this.partialReplayEvents,
      replayCacheEvictions: this.replayCacheEvictions,
      replayCacheBudgetRefusals: this.replayCacheBudgetRefusals,
      checkpoints: this.criticalCheckpoints.snapshotForTransaction(),
      fullReplayCount: this.fullReplayCount,
      partialReplayCount: this.partialReplayCount,
      incrementalApplyCount: this.incrementalApplyCount,
      lastReplaySource: this.lastReplaySource,
      replicaPeakSequenceRecordCount: this.replicaPeakSequenceRecordCount,
      restoredSequenceRecords: this.restoredSequenceRecords,
      restoredDeleteTargets: this.restoredDeleteTargets,
      replayCacheBaseVersion: this.replayCacheBaseVersion,
      replayCacheBaseEventCount: this.replayCacheBaseEventCount,
      replayCacheBaseLocalVersions: this.replayCacheBaseLocalVersions,
      replayCacheCoverageChecks: this.replayCacheCoverageChecks,
      replayCacheEvents: this.replayCacheEvents,
      replayCacheBytes: this.replayCacheBytes,
      replayCacheBudgetBytes: this.replayCacheBudgetBytes,
      releasedCacheAtBudget: this.releasedCacheAtBudget,
      replayCacheCriticalReleaseCut: this.replayCacheCriticalReleaseCut,
      retainReplayCacheAcrossCuts: this.retainReplayCacheAcrossCuts,
      replayCacheAuthors: this.replayCacheAuthors,
      pendingCriticalCut: this.pendingCriticalCut,
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
    this.retiredEngineStats = snapshot.retiredEngineStats;
    this.fullReplayEvents = snapshot.fullReplayEvents;
    this.partialReplayEvents = snapshot.partialReplayEvents;
    this.replayCacheEvictions = snapshot.replayCacheEvictions;
    this.replayCacheBudgetRefusals = snapshot.replayCacheBudgetRefusals;
    this.replayCacheBaseVersion =
      snapshot.replayCacheBaseVersion === null
        ? null
        : new Set(snapshot.replayCacheBaseVersion);
    this.replayCacheBaseEventCount = snapshot.replayCacheBaseEventCount;
    this.replayCacheBaseLocalVersions = snapshot.replayCacheBaseLocalVersions;
    this.replayCacheCoverageChecks = snapshot.replayCacheCoverageChecks;
    this.replayCacheEvents = snapshot.replayCacheEvents;
    this.replayCacheBytes = snapshot.replayCacheBytes;
    // A batch that failed and rolled back never paid for its refusal, so the
    // adaptive budget and the pending refusal both belong to the discarded
    // attempt.
    this.replayCacheBudgetBytes = snapshot.replayCacheBudgetBytes;
    this.releasedCacheAtBudget = snapshot.releasedCacheAtBudget;
    this.replayCacheCriticalReleaseCut = snapshot.replayCacheCriticalReleaseCut;
    this.retainReplayCacheAcrossCuts = snapshot.retainReplayCacheAcrossCuts;
    this.replayCacheAuthors = snapshot.replayCacheAuthors;
    this.pendingCriticalCut = snapshot.pendingCriticalCut;
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
        this.currentVersion,
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
    this.captureEngineStatsBeforeSwap();
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
        } else {
          this.retiredEngineStats = mergeEngineStats(
            this.retiredEngineStats,
            generated.stats,
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
    this.currentVersion = graph.getFrontierView();
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
      this.setReplayCacheBase(
        retainedBaseCheckpoint.version,
        retainedBaseCheckpoint.eventCount,
      );
      this.replayCacheEvents =
        plan.eventCount - retainedBaseCheckpoint.eventCount;
    } else {
      this.engineRecoveryAnchor = null;
      this.setReplayCacheBase(null);
      this.replayCacheEvents = 0;
    }
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;
    this.fullReplayEvents += graph.getEventCount();
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
    this.currentVersion = graph.getFrontierView();
    this.engine = null;
    this.engineStatsOverride = null;
    this.engineRecoveryAnchor = null;
    this.setReplayCacheBase(null);
    this.replayCacheEvents = 0;
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;
    this.fullReplayEvents += graph.getEventCount();
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
      versionsEqual(this.engine.getCurrentVersion(), graph.getFrontierView())
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
   * Fold the outgoing engine's work and peak into lifetime diagnostics.
   * Must be called before any code path that
   * replaces {@link engine} with a fresh instance (see {@link fullReplay}
   * and {@link partialReplayFromCheckpoint}); otherwise the transient
   * pressure observed during a heavy concurrent merge would silently
   * disappear from {@link getReplayStats} after the rebuild.
   */
  private captureEngineStatsBeforeSwap(): void {
    if (!this.engine) {
      return;
    }
    const stats = this.engine.getStats();
    this.retiredEngineStats = mergeEngineStats(this.retiredEngineStats, stats);
    const enginePeak = stats.peakSequenceRecordCount;
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
   *
   * `extendsCurrentVersion` says whether the event's parents were exactly
   * {@link currentVersion} before the caller appended it. The caller checks
   * that before the append, because the current version can be the graph's
   * live frontier, which the append changes.
   */
  private advanceWithEvent(
    event: GraphEvent,
    extendsCurrentVersion: boolean,
  ): RemoteIntegrationEffect {
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
    if (!this.engine && extendsCurrentVersion) {
      const operation = this.validateLocalOperation(event.operation);
      if (operation !== null) {
        this.applyPlainDocumentOperation(operation);
      }
      this.currentVersion = graph.getFrontierView();
      this.incrementalApplyCount++;
      this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
      this.clearSupersededReplayCacheRefusal();
      this.maybeAdvanceCheckpoint();
      return toRemoteIntegrationEffect(operation === null ? [] : [operation]);
    }

    // A retained replay engine can retreat as well as advance. Reuse it for a
    // concurrent burst while its seed checkpoint remains an ancestor of the
    // incoming prepare version.
    if (
      this.engine &&
      this.replayCacheCoversEventAt(graph, graph.localVersionOf(event.id))
    ) {
      const applied = this.engine.applyEvent(event, graph);
      this.documentBuffer = applied.textBuffer;
      this.documentCache = null;
      this.currentVersion = graph.getFrontierView();
      this.incrementalApplyCount++;
      this.lastReplaySource = REPLAY_SOURCE.INCREMENTAL;
      this.replayCacheEvents++;
      this.clearSupersededReplayCacheRefusal();
      this.refreshReplayCacheMetrics();
      this.growReplayCacheBudgetToKeepRebuild(false);
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

  /**
   * Whether the event at `localVersion` descends from the replay-cache base,
   * so the cache can integrate it.
   *
   * Every event at or after the base's cut descends from the base (see
   * {@link replayCacheBaseEventCount}), so one such parent is enough. An
   * event whose parents all precede the cut descends from a base event only
   * by naming it: the base's events are the heads of the events before the
   * cut, and no other of those events descends from one of them.
   */
  private replayCacheCoversEventAt(
    graph: EventGraph,
    localVersion: number,
  ): boolean {
    const base = this.replayCacheBaseVersion;
    if (base === null) {
      return false;
    }
    if (base.size === 0) {
      return true;
    }
    const parents = this.coverageParents;
    parents.length = 0;
    graph.forEachParentLocalVersion(localVersion, this.pushCoverageParent);
    const cut = this.replayCacheBaseEventCount;
    for (let index = 0; index < parents.length; index++) {
      this.replayCacheCoverageChecks++;
      if (parents[index]! >= cut) {
        return true;
      }
    }
    const heads = this.replayCacheBaseLocalVersions;
    if (parents.length < heads.length) {
      return false;
    }
    for (const head of heads) {
      this.replayCacheCoverageChecks++;
      if (!parents.includes(head)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Base the replay cache at `baseVersion`, whose closure is the first
   * `baseEventCount` events, or drop it with `null`.
   */
  private setReplayCacheBase(
    baseVersion: Version | null,
    baseEventCount = 0,
  ): void {
    this.retainReplayCacheAcrossCuts = false;
    this.replayCacheAuthors = emptyIntervalAuthors(baseEventCount);
    this.pendingCriticalCut = null;
    this.replayCacheBaseVersion =
      baseVersion === null ? null : new Set(baseVersion);
    this.replayCacheBaseEventCount = baseEventCount;
    if (baseVersion === null || baseVersion.size === 0) {
      this.replayCacheBaseLocalVersions = [];
      return;
    }
    const graph = this.ensureEventGraph();
    this.replayCacheBaseLocalVersions = Array.from(baseVersion, (eventId) =>
      graph.localVersionOf(eventId),
    );
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
   * Widen the budget so an over-budget cache is kept, when releasing it would
   * only make the next event rebuild it.
   *
   * The cache's engine starts at the newest critical version before the
   * divergence. While the frontier still has more than one head, the
   * divergence is open and the next event on the concurrent branch needs the
   * same interval: no checkpoint after the cache's start can serve it.
   * Releasing an over-budget cache then saves memory only until that event
   * and pays the whole replay again, a full replay when no checkpoint is
   * left. That is the thrash a full replay after a refusal detects, and it is
   * treated the same way when a partial replay rebuilt a refused cache. A
   * cache of more than {@link REPLAY_CACHE_CRITICAL_RELEASE_EVENTS} events
   * is that costly from its first refusal, whether a replay just built it or
   * incremental applies grew it, so it does not wait to be paid twice. A
   * smaller cache is cheap to rebuild and is still released the first time.
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
      this.replayCacheBudgetRefusals++;
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

  /**
   * Release the replay cache when it is over its budget, or when it is large
   * and the frontier is a confirmed critical cut, unless `retainAcrossCuts`;
   * see {@link isAtConfirmedCriticalCut} and
   * {@link retainReplayCacheAcrossCuts}.
   */
  private evictReplayCacheIfNeeded(retainAcrossCuts = false): void {
    const overBudget = this.replayCacheBytes > this.replayCacheBudgetBytes;
    if (
      !overBudget &&
      (this.replayCacheEvents <= REPLAY_CACHE_CRITICAL_RELEASE_EVENTS ||
        retainAcrossCuts ||
        !this.isAtConfirmedCriticalCut())
    ) {
      return;
    }
    if (this.engine !== null) {
      if (overBudget) {
        this.replayCacheBudgetRefusals++;
        this.releasedCacheAtBudget = true;
      } else {
        this.replayCacheCriticalReleaseCut =
          this.ensureEventGraph().getEventCount();
      }
    }
    if (this.engine !== null) this.replayCacheEvictions++;
    this.captureEngineStatsBeforeSwap();
    this.engine = null;
    this.engineStatsOverride = null;
    this.engineRecoveryAnchor = null;
    this.setReplayCacheBase(null);
    this.replayCacheEvents = 0;
    this.replayCacheBytes = 0;
  }

  /**
   * Whether the frontier is a critical cut that releasing the replay cache
   * at will not be undone by an event still in flight.
   *
   * A singleton frontier is only critical among the events this replica
   * holds. Under sustained concurrency, an author that has not seen it yet
   * sends an event concurrent with it, no checkpoint after the cut can serve
   * that event, and the replay that follows rebuilds the whole concurrent
   * interval, once per such event. So the first singleton frontier becomes a
   * pending cut, and the cache is released at a singleton frontier only once
   * that cut is confirmed; an event concurrent with it cancels it. See
   * {@link PendingCriticalCut}.
   */
  private isAtConfirmedCriticalCut(): boolean {
    const graph = this.ensureEventGraph();
    const eventCount = graph.getEventCount();
    let cut =
      this.pendingCriticalCut === null
        ? null
        : advanceCriticalCut(this.pendingCriticalCut, graph, eventCount);
    if (cut === null && graph.getFrontierSize() === 1) {
      this.replayCacheAuthors = scanIntervalAuthors(
        this.replayCacheAuthors,
        graph,
        eventCount,
      );
      cut = openCriticalCut(eventCount, this.replayCacheAuthors, [
        graph.agentAt(eventCount - 1),
        graph.agentTable.numberOf(this.replicaId),
      ]);
    }
    this.pendingCriticalCut = cut;
    return (
      cut !== null &&
      graph.getFrontierSize() === 1 &&
      isCriticalCutConfirmed(cut)
    );
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
   * have placed up to twice as far back. A replay for a batch receive may
   * keep its engine across critical cuts; see
   * {@link retainReplayCacheAcrossCuts}.
   */
  private partialReplayFromCheckpoint(
    checkpoint: CriticalCheckpoint,
    receivesBatch = false,
  ): void {
    const graph = this.ensureEventGraph();
    // A refusal still pending means this replay rebuilds a cache that was
    // refused at the budget. Settle it here: the end of this replay either
    // keeps the rebuilt cache or records a new refusal.
    const rebuildsRefusedCache = this.releasedCacheAtBudget;
    this.releasedCacheAtBudget = false;
    this.captureEngineStatsBeforeSwap();
    const frontier = graph.getFrontierView();
    const plan =
      checkpoint.eventCount > 0 && checkpoint.eventCount < graph.getEventCount()
        ? planPackedSuffixCriticalReplaySections(graph, checkpoint.eventCount)
        : null;
    const replay =
      plan === null
        ? this.replaySuffixAsObjects(graph, checkpoint)
        : this.replayPackedSuffix(graph, checkpoint, plan);
    // The next event on the same divergence replays from the same base.
    if (replay.base.eventCount > checkpoint.eventCount) {
      this.criticalCheckpoints.recordReplayBase(
        replay.base.version,
        replay.base.textBuffer,
        replay.base.eventCount,
        graph.getEventCount(),
      );
    }
    this.engine = replay.engine;
    this.engineRecoveryAnchor = {
      kind: "checkpoint",
      checkpoint: replay.base,
      estimatedBytes: 0,
    };
    this.setReplayCacheBase(replay.base.version, replay.base.eventCount);
    // Whether the last release at a critical cut dropped events this replay
    // had to rebuild.
    this.retainReplayCacheAcrossCuts =
      receivesBatch &&
      this.replayCacheCriticalReleaseCut - replay.base.eventCount >
        REPLAY_CACHE_CRITICAL_RELEASE_EVENTS;
    this.replayCacheEvents = graph.getEventCount() - replay.base.eventCount;
    this.replicaPeakSequenceRecordCount = Math.max(
      this.replicaPeakSequenceRecordCount,
      replay.peakSequenceRecordCount,
    );
    this.documentBuffer = replay.textBuffer;
    this.documentCache = null;
    this.currentVersion = frontier;
    this.restoredSequenceRecords = null;
    this.restoredDeleteTargets = null;
    this.partialReplayEvents += graph.getEventCount() - checkpoint.eventCount;
    this.partialReplayCount++;
    this.lastReplaySource = REPLAY_SOURCE.PARTIAL;
    this.refreshReplayCacheMetrics();
    this.growReplayCacheBudgetToKeepRebuild(rebuildsRefusedCache);
    this.evictReplayCacheIfNeeded(this.retainReplayCacheAcrossCuts);
  }

  /**
   * Replay the events after `checkpoint` over a packed view of them alone,
   * with the planner and section replay a cold replay uses. No event is
   * materialized as an object, and the work follows the suffix.
   *
   * The plan's first section is the checkpoint, which is not replayed.
   */
  private replayPackedSuffix(
    graph: EventGraph,
    checkpoint: CriticalCheckpoint,
    plan: PackedCriticalReplayPlan,
  ): SuffixReplay {
    // Consecutive chains are linear sections, so a suffix without
    // concurrency keeps the whole chain in the engine, as a single replay
    // would.
    let engineSection = plan.sectionCount - 1;
    while (engineSection > 1 && plan.isLinearSection(engineSection)) {
      engineSection--;
    }

    let document = checkpoint.textBuffer;
    let version: Version = checkpoint.version;
    let peakSequenceRecordCount = 0;
    for (let sectionIndex = 1; sectionIndex < engineSection; ) {
      if (plan.isLinearSection(sectionIndex)) {
        let sectionEnd = sectionIndex + 1;
        while (sectionEnd < engineSection && plan.isLinearSection(sectionEnd)) {
          sectionEnd++;
        }
        const end = plan.sectionEndAt(sectionEnd - 1);
        document = this.replayChain(
          (orderIndex) => plan.operationAt(orderIndex),
          plan.sectionStartAt(sectionIndex),
          end,
          document,
        );
        version = new Set([plan.eventIdAt(end - 1)]);
        sectionIndex = sectionEnd;
        continue;
      }
      // One engine lifetime covers nonlinear sections separated only by
      // short chains, as in a cold replay, so a history of many small
      // concurrent sections does not rebuild the document once per section.
      const grouped = extendPackedNonlinearReplayRange(
        plan,
        sectionIndex,
        engineSection,
        MAX_LINEAR_BRIDGE_EVENTS,
      );
      const endVersion = plan.advanceFrontierRange(
        version,
        sectionIndex,
        grouped.endSection,
      );
      const generated = new EgWalkerEngine().generatePackedSectionRange(
        plan,
        sectionIndex,
        grouped.endSection,
        graph,
        version,
        document,
      );
      document = generated.textBuffer;
      this.retiredEngineStats = mergeEngineStats(
        this.retiredEngineStats,
        generated.stats,
      );
      peakSequenceRecordCount = Math.max(
        peakSequenceRecordCount,
        generated.stats.peakSequenceRecordCount,
      );
      version = endVersion;
      sectionIndex = grouped.endSection;
    }

    const base: CriticalCheckpoint = {
      version: new Set(version),
      textBuffer: document,
      // The plan's first event is the checkpoint's last one.
      eventCount:
        checkpoint.eventCount + plan.sectionStartAt(engineSection) - 1,
    };
    const engine = new EgWalkerEngine();
    const generated = engine.generatePackedSectionRange(
      plan,
      engineSection,
      plan.sectionCount,
      graph,
      version,
      document,
    );
    engine.preparePackedRetention(plan, engineSection, plan.sectionCount);
    return {
      engine,
      base,
      textBuffer: generated.textBuffer,
      peakSequenceRecordCount,
    };
  }

  /**
   * Replay the events after `checkpoint` as objects, for a graph whose
   * suffix has no packed view (see {@link EventGraph.getPackedSuffixReplayView}).
   */
  private replaySuffixAsObjects(
    graph: EventGraph,
    checkpoint: CriticalCheckpoint,
  ): SuffixReplay {
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
        document = this.replayChain(
          (rank) => graph.operationAtInsertionRank(rank),
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
      this.retiredEngineStats = mergeEngineStats(
        this.retiredEngineStats,
        generated.stats,
      );
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
    return {
      engine: result.engine,
      base,
      textBuffer: result.textBuffer,
      peakSequenceRecordCount,
    };
  }

  /**
   * Apply the chain of events `[start, end)` of `operationAt` to `document`,
   * validating each operation against the text it edits.
   *
   * A long chain goes through a one-shot piece index. Freezing that index
   * rebuilds the whole document, so a short chain edits the persistent rope
   * directly, joining adjacent inserts and deletes into one edit.
   */
  private replayChain(
    operationAt: (index: number) => ExternalOperation,
    start: number,
    end: number,
    document: PersistentUtf16Rope,
  ): PersistentUtf16Rope {
    if (end - start >= MIN_TRANSIENT_CHAIN_EVENTS) {
      const editor = new TransientUtf16RopeEditor(document);
      for (let rank = start; rank < end; rank++) {
        const operation = this.validateLocalOperation(
          operationAt(rank),
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
      const operation = operationAt(rank);
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
    recordSplitCount: aggregate.recordSplitCount + next.recordSplitCount,
    prepareToggleCount: aggregate.prepareToggleCount + next.prepareToggleCount,
    placeholderStructuralOperations:
      aggregate.placeholderStructuralOperations +
      next.placeholderStructuralOperations,
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
