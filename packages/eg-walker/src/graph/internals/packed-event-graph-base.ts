import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import type { AgentTable } from "./agent-table";
import { EventIdTieBreaker } from "./event-id-tie-breaker";
import {
  EventIdRunIndex,
  type PackedCanonicalIdRun,
} from "./event-id-run-index";
import { GraphRuns } from "./graph-runs";
import { MaxHeap } from "./max-heap";
import type { TailOperationColumns } from "./tail-event-log";
import {
  type PackedIntegerColumn,
  type PackedUnsignedIntegerColumn,
} from "./packed-numeric-columns";
import {
  type PackedLocalVersionTransition,
  type PackedOffsetTransition,
  PackedDiffVersionsWorkspace,
} from "./packed-diff-versions";

const INSERT_OPERATION = 1;
const DELETE_OPERATION = 2;
const MAX_EXCLUSIVE_BRANCH_SPAN = 1_024;

/** Per-event operation columns, indexed by packed offset. */
export interface PackedOperationColumns {
  readonly operationTypes: Uint8Array;
  readonly operationIndexes: PackedUnsignedIntegerColumn;
  readonly operationLengths: PackedUnsignedIntegerColumn;
  readonly timestamps: PackedIntegerColumn;
  /** UTF-16 offset of each INSERT event in `insertedContent`; 0 for DELETE. */
  readonly insertStarts: Uint32Array;
}

/**
 * Operation columns supplied on first read. Queries that need only IDs, edges
 * and counts never load them.
 */
interface DeferredPackedOperationColumns {
  readonly operationTypes?: never;
  readonly operationIndexes?: never;
  readonly operationLengths?: never;
  readonly timestamps?: never;
  readonly insertStarts?: never;
  readonly loadOperationColumns: () => PackedOperationColumns;
}

type PackedEventGraphCommonColumns = (
  | (PackedOperationColumns & { readonly loadOperationColumns?: never })
  | DeferredPackedOperationColumns
) & {
  readonly insertedContent: string;
  /** Edges as runs of consecutive local versions. */
  readonly runs: GraphRuns;
};

export type { PackedCanonicalIdRun } from "./event-id-run-index";

/**
 * Event IDs of a packed graph by offset (local version).
 *
 * Replicas are numbered by the shared {@link agents} table. `agentAt`
 * returns `-1` for an ID that does not parse as `replicaId:sequence`, so
 * callers order and group events numerically and format an ID only at an
 * API boundary.
 */
export interface PackedEventIdIndex {
  readonly count: number;
  readonly agents: AgentTable;
  has(id: EventId): boolean;
  offsetOf(id: EventId): number | undefined;
  idAt(offset: number): EventId | undefined;
  agentAt(offset: number): number;
  sequenceAt(offset: number): number;
  /** Offset of the canonical ID `(agent, sequence)`, or `-1`. */
  offsetOfCanonical?(agent: number, sequence: number): number;
  /** Whether any event has a custom (verbatim) ID. */
  hasCustomIds?(): boolean;
  canonicalRunAt?(offset: number): PackedCanonicalIdRun | undefined;
  iterateIds(): IterableIterator<EventId>;
  maximumSequenceForReplica(replicaId: string): number | undefined;
}

interface MaterializedPackedEventIds {
  readonly ids: ReadonlyArray<EventId>;
  readonly offsetById: ReadonlyMap<EventId, number>;
  readonly idIndex?: never;
}

interface RunIndexedMaterializedPackedEventIds {
  readonly ids: ReadonlyArray<EventId>;
  readonly offsetById?: never;
  readonly idIndex: PackedEventIdIndex;
}

interface LazyIndexedPackedEventIds {
  readonly ids?: never;
  readonly offsetById?: never;
  readonly idIndex: PackedEventIdIndex;
}

export type PackedEventGraphColumns = PackedEventGraphCommonColumns &
  (
    | MaterializedPackedEventIds
    | RunIndexedMaterializedPackedEventIds
    | LazyIndexedPackedEventIds
  );

export interface PackedLinearEventGraphBuild {
  readonly base: PackedEventGraphBase;
  readonly frontier: ReadonlySet<EventId>;
}

/**
 * Owned numeric layout for one packed critical-section replay.
 *
 * `eventOrder` maps replay rank to packed insertion offset and
 * `rankByOffset` is its inverse. Section bounds index that order. The graph
 * builds all four columns in one branch-preserving traversal so the critical
 * planner does not have to walk every event and edge a second time.
 */
export interface PackedBranchReplayLayout {
  readonly eventOrder: Uint32Array;
  readonly rankByOffset: Uint32Array;
  readonly sectionEnds: Uint32Array;
  readonly linearSections: Uint8Array;
  readonly sectionCount: number;
  /** Runs the traversal visited; it scanned edges once per run. */
  readonly runCount: number;
}

interface PackedBranchTraversalWorkspace {
  readonly remainingParents: Uint32Array;
  readonly roots: number[];
  sortBranchGroup(group: number[]): void;
}

/**
 * Immutable, allocation-light storage for an already validated columnar
 * graph prefix.
 *
 * Public `GraphEvent` objects and parent sets are reconstructed only at an API
 * boundary. Edges are stored as {@link GraphRuns}: runs of consecutive local
 * versions whose inner events have their predecessor as only parent. Graph
 * queries use the packed numeric columns and the runs directly, so loading
 * a snapshot allocates neither an object, operation and two sets nor an
 * edge entry for every event.
 */
export class PackedEventGraphBase {
  private readonly ids: ReadonlyArray<EventId> | null;
  private readonly idIndex: PackedEventIdIndex;
  private readonly eventCount: number;
  /** `null` until {@link loadOperationColumns} supplies deferred columns. */
  private operationColumns: PackedOperationColumns | null;
  private readonly loadOperationColumns: (() => PackedOperationColumns) | null;
  private readonly insertedContent: string;
  /** Edges as runs; an event's parents are read through its run. */
  private readonly graphRuns: GraphRuns;
  private readonly exactLinear: boolean;
  private diffWorkspace: PackedDiffVersionsWorkspace | null = null;

  /** Build from arbitrary packed columns, validating materialized IDs. */
  static create(columns: PackedEventGraphColumns): PackedEventGraphBase {
    return new PackedEventGraphBase(columns, false);
  }

  /**
   * Build from materialized IDs and an index derived from the same validated
   * source. This is intentionally separate from {@link create}: callers must
   * establish that both views came from one validated ID-run column.
   */
  static createWithTrustedMaterializedIds(
    columns: PackedEventGraphColumns,
  ): PackedEventGraphBase {
    if (columns.ids === undefined || columns.idIndex === undefined) {
      throw new Error(
        "Trusted materialized IDs require both an ID column and an ID index",
      );
    }
    return new PackedEventGraphBase(columns, true);
  }

  /**
   * Pack a graph that has no packed prefix, for one numeric replay: the
   * columns {@link appendTail} builds, over an empty prefix.
   */
  static fromTail(tail: PackedTailEvents): PackedEventGraphBase {
    const empty = PackedEventGraphBase.create({
      idIndex: new EventIdRunIndex(tail.agents).view(),
      operationTypes: new Uint8Array(0),
      operationIndexes: new Uint32Array(0),
      operationLengths: new Uint32Array(0),
      timestamps: new Int32Array(0),
      insertStarts: new Uint32Array(0),
      insertedContent: "",
      runs: GraphRuns.linear(0),
    });
    return empty.appendTail(tail);
  }

  private constructor(
    columns: PackedEventGraphColumns,
    trustMaterializedIds: boolean,
  ) {
    const idIndex = columns.idIndex;
    const count = idIndex?.count ?? columns.ids!.length;
    if (columns.loadOperationColumns === undefined) {
      assertOperationColumnLengths(columns, count);
      this.operationColumns = columns;
      this.loadOperationColumns = null;
    } else {
      if (!columns.runs.isLinear()) {
        throw new Error("Deferred operation columns require a linear graph");
      }
      this.operationColumns = null;
      this.loadOperationColumns = columns.loadOperationColumns;
    }
    if (columns.runs.eventCount !== count) {
      throw new Error("Invalid packed event graph: column length mismatch");
    }

    if (columns.ids !== undefined) {
      // The packed decoder transfers ownership of this array. Keeping it
      // avoids a second O(N) pointer array at peak decode memory.
      const ids = Object.freeze(columns.ids);
      if (ids.length !== count) {
        throw new Error(
          "Invalid packed event graph: ID column length mismatch",
        );
      }
      if (!trustMaterializedIds) {
        for (let offset = 0; offset < ids.length; offset++) {
          const id = ids[offset]!;
          const indexedOffset =
            idIndex === undefined
              ? columns.offsetById.get(id)
              : idIndex.offsetOf(id);
          if (
            typeof id !== "string" ||
            id.length === 0 ||
            indexedOffset !== offset
          ) {
            throw new Error(
              `Invalid packed event graph event ID at offset ${offset}`,
            );
          }
        }
      }
      if (idIndex === undefined && columns.offsetById.size !== count) {
        throw new Error("Invalid packed event graph: ID index size mismatch");
      }

      this.ids = ids;
      this.idIndex = idIndex ?? indexMaterializedIds(ids);
    } else {
      this.ids = null;
      this.idIndex = idIndex!;
    }
    this.eventCount = count;
    this.insertedContent = columns.insertedContent;
    this.graphRuns = columns.runs;
    this.exactLinear = columns.runs.isLinear();
  }

  get count(): number {
    return this.eventCount;
  }

  /** The graph's edges as runs of consecutive local versions. */
  get runs(): GraphRuns {
    return this.graphRuns;
  }

  /** Replica numbering shared with the graph that owns this base. */
  get agents(): AgentTable {
    return this.idIndex.agents;
  }

  has(id: EventId): boolean {
    return this.idIndex.has(id);
  }

  offsetOf(id: EventId): number | undefined {
    return this.idIndex.offsetOf(id);
  }

  /**
   * Agent of the event at `offset`, or `-1` when its ID does not parse as
   * `replicaId:sequence`.
   */
  agentAt(offset: number): number {
    return this.idIndex.agentAt(offset);
  }

  /** Sequence of the event at `offset`; meaningful for canonical agents. */
  sequenceAt(offset: number): number {
    return this.idIndex.sequenceAt(offset);
  }

  /**
   * Whether the base holds `id`, given its already parsed canonical parts
   * (`agent < 0` for an ID that does not parse).
   */
  hasParsed(id: EventId, agent: number, sequence: number): boolean {
    const index = this.idIndex;
    if (agent >= 0 && index.offsetOfCanonical !== undefined) {
      // A custom run can still hold a canonical-looking ID in hand-written
      // payloads, so a canonical miss falls back to the full lookup there.
      return (
        index.offsetOfCanonical(agent, sequence) >= 0 ||
        (index.hasCustomIds?.() === true && index.has(id))
      );
    }
    return index.has(id);
  }

  /** Compute a version diff directly over immutable packed offsets. */
  diffVersions(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
  ): { readonly onlyInLeft: Set<EventId>; readonly onlyInRight: Set<EventId> } {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diff(left, right, this);
  }

  /**
   * Compute a numeric transition from an ID frontier to one event's parents.
   *
   * The returned view is workspace-owned and is overwritten by the next diff.
   */
  diffVersionToParents(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedOffsetTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffVersionToParents(
      currentVersion,
      targetEventOffset,
      this,
    );
  }

  /**
   * Compute a range-compressed transition from an ID frontier to one event's
   * parents. The returned buffers are overwritten by the next diff query.
   */
  diffVersionToParentRanges(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffVersionToParentRanges(
      currentVersion,
      targetEventOffset,
      this,
    );
  }

  /**
   * Compute a range-compressed transition from a version given as offsets to
   * one event's parents. The returned buffers are overwritten by the next
   * diff query.
   */
  diffLocalVersionsToParentRanges(
    currentOffsets: ReadonlyArray<number>,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffLocalVersionsToParentRanges(
      currentOffsets,
      targetEventOffset,
      this,
    );
  }

  /**
   * Compute a numeric transition from one event to another event's parents.
   *
   * The returned view is workspace-owned and is overwritten by the next diff.
   */
  diffOffsetToParents(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedOffsetTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffOffsetToParents(
      currentOffset,
      targetEventOffset,
      this,
    );
  }

  /**
   * Compute a range-compressed transition from one event to another event's
   * parents. The returned buffers are overwritten by the next diff query.
   */
  diffOffsetToParentRanges(
    currentOffset: number,
    targetEventOffset: number,
  ): PackedLocalVersionTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffOffsetToParentRanges(
      currentOffset,
      targetEventOffset,
      this,
    );
  }

  /** Release scratch storage once a packed replay has finished. */
  releaseDiffWorkspace(): void {
    this.diffWorkspace = null;
  }

  idAt(offset: number): EventId | undefined {
    return this.ids !== null ? this.ids[offset] : this.idIndex.idAt(offset);
  }

  /** Return canonical author/sequence metadata without reparsing an ID. */
  canonicalIdRunAt(offset: number): PackedCanonicalIdRun | undefined {
    return this.idIndex.canonicalRunAt?.(offset);
  }

  *iterateIds(): IterableIterator<EventId> {
    if (this.ids !== null) {
      yield* this.ids;
    } else {
      yield* this.idIndex.iterateIds();
    }
  }

  eventAt(offset: number): GraphEvent | undefined {
    const id = this.idAt(offset);
    if (id === undefined) {
      return undefined;
    }
    return {
      id,
      operation: this.operationAt(offset),
      parentVersion: new Set(this.iterateParentsAt(offset)),
      timestamp: this.operations().timestamps[offset]!,
    };
  }

  operationAt(offset: number): ExternalOperation {
    const { operationTypes, operationIndexes, operationLengths, insertStarts } =
      this.operations();
    const type = operationTypes[offset];
    const index = operationIndexes[offset]!;
    const length = operationLengths[offset]!;
    if (type === INSERT_OPERATION) {
      const start = insertStarts[offset]!;
      return {
        type: OPERATION_TYPE.INSERT,
        index,
        text: this.insertedContent.slice(start, start + length),
      };
    }
    if (type === DELETE_OPERATION) {
      return { type: OPERATION_TYPE.DELETE, index, length };
    }
    throw new Error(`Invalid packed operation type ${String(type)}`);
  }

  /**
   * Whether some ID is stored verbatim, so its agent and sequence columns
   * may not spell it. Unknown index shapes answer conservatively.
   */
  hasCustomIds(): boolean {
    return this.idIndex.hasCustomIds?.() ?? true;
  }

  isInsertAt(offset: number): boolean {
    return this.operations().operationTypes[offset] === INSERT_OPERATION;
  }

  operationIndexAt(offset: number): number {
    return this.operations().operationIndexes[offset]!;
  }

  operationLengthAt(offset: number): number {
    return this.operations().operationLengths[offset]!;
  }

  insertStartAt(offset: number): number {
    return this.operations().insertStarts[offset]!;
  }

  sliceInsertedContent(start: number, end: number): string {
    return this.insertedContent.slice(start, end);
  }

  timestampAt(offset: number): number | undefined {
    return this.operations().timestamps[offset];
  }

  private operations(): PackedOperationColumns {
    return this.operationColumns ?? this.loadDeferredOperations();
  }

  private loadDeferredOperations(): PackedOperationColumns {
    const columns = this.loadOperationColumns!();
    assertOperationColumnLengths(columns, this.eventCount);
    this.operationColumns = columns;
    return columns;
  }

  parentCountAt(offset: number): number {
    return this.isOffset(offset) ? this.graphRuns.parentCountAt(offset) : 0;
  }

  /** Return a parent as a packed insertion offset without materialising IDs. */
  parentOffsetAt(offset: number, parentIndex: number): number | undefined {
    if (
      !Number.isInteger(parentIndex) ||
      parentIndex < 0 ||
      !this.isOffset(offset)
    ) {
      return undefined;
    }
    const parent = this.graphRuns.parentAt(offset, parentIndex);
    return parent < 0 ? undefined : parent;
  }

  childCountAt(offset: number): number {
    return this.isOffset(offset) ? this.graphRuns.childCountAt(offset) : 0;
  }

  /** Return a child as a packed insertion offset without materialising IDs. */
  childOffsetAt(offset: number, childIndex: number): number | undefined {
    if (
      !Number.isInteger(childIndex) ||
      childIndex < 0 ||
      !this.isOffset(offset)
    ) {
      return undefined;
    }
    const child = this.graphRuns.childAt(offset, childIndex);
    return child < 0 ? undefined : child;
  }

  private isOffset(offset: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && offset < this.eventCount;
  }

  *iterateParents(id: EventId): IterableIterator<EventId> {
    const offset = this.offsetOf(id);
    if (offset !== undefined) {
      yield* this.iterateParentsAt(offset);
    }
  }

  *iterateChildren(id: EventId): IterableIterator<EventId> {
    const offset = this.offsetOf(id);
    if (offset !== undefined) {
      const childCount = this.childCountAt(offset);
      for (let childIndex = 0; childIndex < childCount; childIndex++) {
        yield this.requireIdAt(this.graphRuns.childAt(offset, childIndex));
      }
    }
  }

  /**
   * Return Kahn's topological order as packed insertion offsets, taking
   * ready events in {@link compareEventIds} order.
   *
   * This is the order {@link EventGraph.getTopologicalOrder} returns. It runs
   * over the graph's runs: an event inside a run is the only newly ready
   * event once its predecessor is emitted, so it is emitted directly while it
   * orders before every other ready event, and only a run whose next event
   * loses that comparison goes back into the heap.
   */
  getTopologicalOrderOffsets(): Uint32Array {
    const count = this.count;
    const order = new Uint32Array(count);
    if (this.exactLinear) {
      for (let offset = 0; offset < count; offset++) {
        order[offset] = offset;
      }
      return order;
    }
    const runs = this.runs;
    const ids = new EventIdTieBreaker(this);
    // The next unemitted event of each run in the heap.
    const cursors = new Uint32Array(runs.count);
    // A max-heap with an inverted comparator pops the smallest ready ID.
    const ready = new MaxHeap<number>((left, right) =>
      ids.compare(cursors[right]!, cursors[left]!),
    );
    const remainingParents = new Uint32Array(runs.count);
    for (let run = 0; run < runs.count; run++) {
      const parentCount = runs.parentCountOf(run);
      remainingParents[run] = parentCount;
      if (parentCount === 0) {
        cursors[run] = runs.startOf(run);
        ready.push(run);
      }
    }

    let length = 0;
    while (ready.size > 0) {
      const run = ready.pop()!;
      const last = runs.lastOf(run);
      let offset = cursors[run]!;
      order[length++] = offset;
      while (offset < last) {
        offset++;
        if (
          ready.size > 0 &&
          ids.compare(offset, cursors[ready.peek()!]!) > 0
        ) {
          break;
        }
        order[length++] = offset;
      }
      if (order[length - 1] !== last) {
        cursors[run] = offset;
        ready.push(run);
        continue;
      }
      const childCount = runs.childCountOf(run);
      for (let childIndex = 0; childIndex < childCount; childIndex++) {
        const child = runs.childRunAt(run, childIndex);
        const remaining = remainingParents[child]! - 1;
        remainingParents[child] = remaining;
        if (remaining === 0) {
          cursors[child] = runs.startOf(child);
          ready.push(child);
        }
      }
    }
    if (length !== count) {
      throw new Error("Cycle detected in packed event graph");
    }
    return order;
  }

  /**
   * Return the branch-preserving traversal as packed insertion offsets.
   *
   * The depth-first traversal visits runs: once a run's first event is
   * emitted, its next event is the only newly ready one and is popped
   * straight away, so a run is always emitted whole. Branch groups form only
   * at the last event of a run.
   */
  getBranchPreservingOrderOffsets(): Uint32Array {
    const result = new Uint32Array(this.count);
    if (this.exactLinear) {
      for (let offset = 0; offset < this.count; offset++) {
        result[offset] = offset;
      }
      return result;
    }
    const runs = this.runs;
    const { remainingParents, roots, sortBranchGroup } =
      this.createBranchTraversalWorkspace();

    const stack: number[] = [];
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push(roots[index]!);
    }

    let resultLength = 0;
    const newlyReady: number[] = [];
    while (stack.length > 0) {
      const run = stack.pop()!;
      const end = runs.endOf(run);
      for (let offset = runs.startOf(run); offset < end; offset++) {
        result[resultLength++] = offset;
      }

      newlyReady.length = 0;
      const childCount = runs.childCountOf(run);
      for (let childIndex = 0; childIndex < childCount; childIndex++) {
        const child = runs.childRunAt(run, childIndex);
        const remaining = remainingParents[child]! - 1;
        remainingParents[child] = remaining;
        if (remaining === 0) newlyReady.push(child);
      }
      if (newlyReady.length > 1) {
        sortBranchGroup(newlyReady);
      }
      for (let index = newlyReady.length - 1; index >= 0; index--) {
        stack.push(newlyReady[index]!);
      }
    }

    if (resultLength !== this.count) {
      throw new Error("Cycle detected in packed event graph");
    }
    return result;
  }

  /**
   * Build replay order, inverse rank, and critical cuts in one depth-first
   * traversal of the graph's runs.
   *
   * A cut is critical when every ready event has every event of the emitted
   * prefix's frontier as a parent. The traversal keeps the number of missing
   * (frontier event, ready event) parent pairs. Only a run's first and last
   * events change it: inside a run, each event replaces its predecessor in
   * the frontier and its successor replaces it in the ready set, which
   * leaves the frontier size, the ready count and the missing pairs
   * unchanged. Every event inside a run is therefore a cut exactly when the
   * run's first event is, and the planner decides it once per run instead of
   * scanning each event's edges. Per-run arrays hold the frontier and the
   * ready-parent coverage of run ends; a run's inner events are in the
   * frontier only while the run is being emitted.
   */
  buildBranchPreservingCriticalReplayLayout(): PackedBranchReplayLayout {
    const eventCount = this.count;
    if (eventCount === 0) {
      const empty = new Uint32Array();
      return {
        eventOrder: empty,
        rankByOffset: empty,
        sectionEnds: empty,
        linearSections: new Uint8Array(),
        sectionCount: 0,
        runCount: 0,
      };
    }

    if (this.exactLinear) {
      const eventOrder = new Uint32Array(eventCount);
      for (let offset = 0; offset < eventCount; offset++) {
        eventOrder[offset] = offset;
      }
      return {
        eventOrder,
        rankByOffset: eventOrder,
        sectionEnds: new Uint32Array([eventCount]),
        linearSections: new Uint8Array([1]),
        sectionCount: 1,
        runCount: 1,
      };
    }

    const runs = this.runs;
    const { remainingParents, roots, sortBranchGroup } =
      this.createBranchTraversalWorkspace();

    const stack: number[] = [];
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push(roots[index]!);
    }

    const eventOrder = new Uint32Array(eventCount);
    const rankByOffset = new Uint32Array(eventCount);
    const sectionEnds = new Uint32Array(eventCount);
    const linearSections = new Uint8Array(eventCount);
    /** Whether a run's last event is in the prefix frontier. */
    const frontierEnds = new Uint8Array(runs.count);
    /** Ready runs whose first event has a run's last event as a parent. */
    const readyParentCoverage = new Uint32Array(runs.count);
    const newlyReady: number[] = [];

    let readyCount = roots.length;
    let frontierSize = 0;
    let missingReadyParentPairs = 0;
    let sectionCount = 0;
    let sectionStart = 0;
    let sectionIsLinear = true;
    let orderIndex = 0;

    const emit = (offset: number): void => {
      eventOrder[orderIndex] = offset;
      rankByOffset[offset] = orderIndex;
      orderIndex++;
    };
    const cutIfCritical = (): void => {
      if (readyCount === 0 || missingReadyParentPairs === 0) {
        sectionEnds[sectionCount] = orderIndex;
        linearSections[sectionCount] = sectionIsLinear ? 1 : 0;
        sectionCount++;
        sectionStart = orderIndex;
      }
    };
    // Put a run's last event in the frontier and expose its ready children.
    const finishRun = (run: number): void => {
      frontierEnds[run] = 1;
      frontierSize++;
      missingReadyParentPairs += readyCount - readyParentCoverage[run]!;
      newlyReady.length = 0;
      const childCount = runs.childCountOf(run);
      for (let childIndex = 0; childIndex < childCount; childIndex++) {
        const child = runs.childRunAt(run, childIndex);
        const remaining = remainingParents[child]! - 1;
        remainingParents[child] = remaining;
        if (remaining !== 0) {
          continue;
        }
        const parentCount = runs.parentCountOf(child);
        let parentsInFrontier = 0;
        for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
          const parent = runs.parentRunAt(child, parentIndex);
          if (frontierEnds[parent] === 1) {
            parentsInFrontier++;
          }
          readyParentCoverage[parent] = readyParentCoverage[parent]! + 1;
        }
        missingReadyParentPairs += frontierSize - parentsInFrontier;
        readyCount++;
        newlyReady.push(child);
      }
    };

    let previousOffset = -1;
    while (stack.length > 0) {
      const run = stack.pop()!;
      const start = runs.startOf(run);
      const last = runs.lastOf(run);

      // The run's first event leaves the ready set and replaces its parents
      // in the frontier. All arithmetic uses the ready count after the pop.
      readyCount--;
      const parentCount = runs.parentCountOf(run);
      const frontierSizeBefore = frontierSize;
      let parentsInFrontier = 0;
      for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
        const parent = runs.parentRunAt(run, parentIndex);
        const coverage = readyParentCoverage[parent]!;
        if (coverage === 0) {
          throw new Error("Invalid packed replay ready-parent coverage");
        }
        readyParentCoverage[parent] = coverage - 1;
        if (frontierEnds[parent] !== 1) {
          continue;
        }
        parentsInFrontier++;
        missingReadyParentPairs -= readyCount - (coverage - 1);
        frontierEnds[parent] = 0;
        frontierSize--;
      }
      if (orderIndex === sectionStart) {
        sectionIsLinear =
          parentCount === frontierSizeBefore &&
          parentsInFrontier === frontierSizeBefore;
      } else if (
        parentCount !== 1 ||
        runs.lastOf(runs.parentRunAt(run, 0)) !== previousOffset
      ) {
        sectionIsLinear = false;
      }
      missingReadyParentPairs -= frontierSizeBefore - parentsInFrontier;

      if (start === last) {
        finishRun(run);
        emit(start);
        cutIfCritical();
      } else {
        // The first event joins the frontier, and the next event of the run,
        // whose only parent it is, becomes ready.
        frontierSize++;
        missingReadyParentPairs += readyCount;
        missingReadyParentPairs += frontierSize - 1;
        readyCount++;
        emit(start);
        cutIfCritical();

        const innerCut = missingReadyParentPairs === 0;
        for (let offset = start + 1; offset < last; offset++) {
          if (orderIndex === sectionStart) {
            sectionIsLinear = frontierSize === 1;
          }
          emit(offset);
          if (innerCut) {
            cutIfCritical();
          }
        }

        // The last event replaces its predecessor in the frontier.
        readyCount--;
        missingReadyParentPairs -= readyCount;
        frontierSize--;
        // A cut before the last event leaves its predecessor as the whole
        // frontier, so a section starting here is linear.
        if (orderIndex === sectionStart) {
          sectionIsLinear = true;
        }
        missingReadyParentPairs -= frontierSize;
        finishRun(run);
        emit(last);
        cutIfCritical();
      }
      previousOffset = last;

      if (newlyReady.length > 1) {
        sortBranchGroup(newlyReady);
      }
      for (let index = newlyReady.length - 1; index >= 0; index--) {
        stack.push(newlyReady[index]!);
      }
    }

    if (orderIndex !== eventCount) {
      throw new Error("Cycle detected in packed event graph");
    }
    if (sectionStart !== eventCount) {
      throw new Error("Packed critical replay plan did not cover every event");
    }

    return {
      eventOrder,
      rankByOffset,
      sectionEnds: sectionEnds.slice(0, sectionCount),
      linearSections: linearSections.slice(0, sectionCount),
      sectionCount,
      runCount: runs.count,
    };
  }

  /**
   * Per-run parent counters, roots and the branch-group comparator.
   *
   * A group of ready runs is ordered by the exclusive span of each run's
   * first event: the events that only it leads to through single-parent
   * edges. Inside a run each event's span is one more than its successor's,
   * so a run's span is its length plus the spans of its single-parent child
   * runs. Once any exclusive branch exceeds {@link MAX_EXCLUSIVE_BRANCH_SPAN},
   * groups holding one order by longest causal path instead, which runs
   * accumulate the same way. Event IDs break the remaining ties.
   */
  private createBranchTraversalWorkspace(): PackedBranchTraversalWorkspace {
    const runs = this.runs;
    const runCount = runs.count;
    const remainingParents = new Uint32Array(runCount);
    const exclusiveSpan = new Float64Array(runCount);
    const longestPath = new Float64Array(runCount);
    const roots: number[] = [];

    for (let run = 0; run < runCount; run++) {
      const parentCount = runs.parentCountOf(run);
      remainingParents[run] = parentCount;
      if (parentCount === 0) {
        roots.push(run);
      }
    }
    // Child runs start after their parent run ends.
    for (let run = runCount - 1; run >= 0; run--) {
      const length = runs.endOf(run) - runs.startOf(run);
      let span = length;
      let childPath = 0;
      const childCount = runs.childCountOf(run);
      for (let childIndex = 0; childIndex < childCount; childIndex++) {
        const child = runs.childRunAt(run, childIndex);
        if (remainingParents[child] === 1) {
          span += exclusiveSpan[child]!;
        }
        childPath = Math.max(childPath, longestPath[child]!);
      }
      exclusiveSpan[run] = span;
      longestPath[run] = length + childPath;
    }

    const ids = new EventIdTieBreaker(this);
    const compareIds = (left: number, right: number): number =>
      ids.compare(runs.startOf(left), runs.startOf(right));
    const compareExclusive = (left: number, right: number): number => {
      const difference = exclusiveSpan[left]! - exclusiveSpan[right]!;
      return difference === 0 ? compareIds(left, right) : difference;
    };
    const compareLongest = (left: number, right: number): number => {
      const difference = longestPath[left]! - longestPath[right]!;
      return difference === 0 ? compareIds(left, right) : difference;
    };
    const sortBranchGroup = (group: number[]): void => {
      let hasLongExclusiveBranch = false;
      for (let index = 0; index < group.length; index++) {
        if (exclusiveSpan[group[index]!]! > MAX_EXCLUSIVE_BRANCH_SPAN) {
          hasLongExclusiveBranch = true;
          break;
        }
      }
      group.sort(hasLongExclusiveBranch ? compareLongest : compareExclusive);
    };
    if (roots.length > 1) {
      sortBranchGroup(roots);
    }

    return { remainingParents, roots, sortBranchGroup };
  }
  /**
   * Repack this immutable prefix and events appended after it into one
   * packed base, for planning and replaying a graph that has a mutable tail.
   *
   * Operation columns are copied, which is linear in the graph like the
   * replay that needs them; edges are rebuilt as runs. IDs are not re-materialized: offsets below
   * this prefix resolve through its own index and tail IDs through the
   * tail's.
   */
  appendTail(tail: PackedTailEvents): PackedEventGraphBase {
    if (tail.agents !== this.agents) {
      throw new Error("A packed tail must share its prefix's agent table");
    }
    const baseCount = this.count;
    const count = baseCount + tail.count;
    const baseOperations = this.operations();
    const operationTypes = new Uint8Array(count);
    operationTypes.set(baseOperations.operationTypes);
    const insertStarts = new Uint32Array(count);
    insertStarts.set(baseOperations.insertStarts);
    const baseContentLength = this.insertedContent.length;
    const tailContent = tail.insertedContent();
    if (baseContentLength + tailContent.length > 0xffff_ffff) {
      throw new Error("Inserted content exceeds packed UTF-16 offset range");
    }

    // Only events whose parents are not just their predecessor carry edges:
    // the prefix's run starts and the tail's branch and merge events.
    const explicit: number[] = [];
    const explicitParentStarts: number[] = [0];
    const explicitParents: number[] = [];
    const baseRuns = this.graphRuns;
    for (let run = 0; run < baseRuns.count; run++) {
      const start = baseRuns.startOf(run);
      const parentCount = baseRuns.parentCountOf(run);
      if (
        parentCount === 1 &&
        baseRuns.lastOf(baseRuns.parentRunAt(run, 0)) === start - 1
      ) {
        continue;
      }
      explicit.push(start);
      for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
        explicitParents.push(
          baseRuns.lastOf(baseRuns.parentRunAt(run, parentIndex)),
        );
      }
      explicitParentStarts.push(explicitParents.length);
    }
    tail.appendExplicitParents(
      baseCount,
      explicit,
      explicitParentStarts,
      explicitParents,
    );
    const tailColumns = tail.operationColumns();
    let tailIndexes: ArrayLike<number>;
    let tailLengths: ArrayLike<number>;
    let tailTimestamps: ArrayLike<number>;
    if (tailColumns !== null) {
      operationTypes.set(tailColumns.types, baseCount);
      for (let tailIndex = 0; tailIndex < tail.count; tailIndex++) {
        if (tailColumns.types[tailIndex] === INSERT_OPERATION) {
          insertStarts[baseCount + tailIndex] =
            baseContentLength + tailColumns.insertStarts[tailIndex]!;
        }
      }
      tailIndexes = tailColumns.indexes;
      tailLengths = tailColumns.lengths;
      tailTimestamps = tailColumns.timestamps;
    } else {
      const indexes: number[] = [];
      const lengths: number[] = [];
      const timestamps: number[] = [];
      for (let tailIndex = 0; tailIndex < tail.count; tailIndex++) {
        const offset = baseCount + tailIndex;
        indexes.push(tail.operationIndexAt(tailIndex));
        lengths.push(tail.operationLengthAt(tailIndex));
        timestamps.push(tail.timestampAt(tailIndex));
        if (tail.isInsertAt(tailIndex)) {
          operationTypes[offset] = INSERT_OPERATION;
          insertStarts[offset] =
            baseContentLength + tail.insertStartAt(tailIndex);
        } else {
          operationTypes[offset] = DELETE_OPERATION;
        }
      }
      tailIndexes = indexes;
      tailLengths = lengths;
      tailTimestamps = timestamps;
    }
    // Children stay in ascending offset order, exactly as the columnar
    // decoders build them, so branch ordering of the repacked graph matches a
    // fresh decode.
    const runs = GraphRuns.fromExplicitParents(
      count,
      explicit,
      explicitParentStarts,
      explicitParents,
    );

    const idIndex = new TailExtendedIdIndex(this, tail);
    const columns = {
      idIndex,
      operationTypes,
      operationIndexes: appendUnsignedColumn(
        baseOperations.operationIndexes,
        tailIndexes,
      ),
      operationLengths: appendUnsignedColumn(
        baseOperations.operationLengths,
        tailLengths,
      ),
      timestamps: appendIntegerColumn(
        baseOperations.timestamps,
        tailTimestamps,
      ),
      insertStarts,
      insertedContent:
        tailContent.length === 0
          ? this.insertedContent
          : this.insertedContent + tailContent,
      runs,
    };
    return this.ids === null
      ? PackedEventGraphBase.create(columns)
      : PackedEventGraphBase.createWithTrustedMaterializedIds({
          ...columns,
          ids: this.ids.concat(Array.from(tail.iterateIds())),
        });
  }

  *iterateEvents(): IterableIterator<GraphEvent> {
    for (let offset = 0; offset < this.count; offset++) {
      yield this.eventAt(offset)!;
    }
  }

  isExactLinear(): boolean {
    return this.exactLinear;
  }

  *iterateParentsAt(offset: number): IterableIterator<EventId> {
    const parentCount = this.parentCountAt(offset);
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      yield this.requireIdAt(this.graphRuns.parentAt(offset, parentIndex));
    }
  }

  private requireIdAt(offset: number): EventId {
    const id = this.idAt(offset);
    if (id === undefined) {
      throw new Error(
        `Packed event graph is missing event at offset ${offset}`,
      );
    }
    return id;
  }

  maximumSequenceForReplica(replicaId: string): number | undefined {
    return this.idIndex.maximumSequenceForReplica(replicaId);
  }
}

/**
 * Events appended after an immutable packed prefix, as seen by
 * {@link PackedEventGraphBase.appendTail}. Parent offsets are insertion ranks
 * in the combined graph and always precede the event's own rank. The tail
 * numbers its replicas with the prefix's {@link AgentTable}.
 */
export interface PackedTailEvents {
  readonly count: number;
  readonly agents: AgentTable;
  isInsertAt(tailIndex: number): boolean;
  operationIndexAt(tailIndex: number): number;
  operationLengthAt(tailIndex: number): number;
  timestampAt(tailIndex: number): number;
  /** Offset of an insert's text in {@link insertedContent}. */
  insertStartAt(tailIndex: number): number;
  insertedContent(): string;
  forEachParentOffset(
    tailIndex: number,
    visit: (parentOffset: number) => void,
  ): void;
  /** Typed operation columns, or `null` to read events one at a time. */
  operationColumns(): TailOperationColumns | null;
  /** Append events whose parents are not just their predecessor. */
  appendExplicitParents(
    baseCount: number,
    explicit: number[],
    parentStarts: number[],
    parents: number[],
  ): void;
  idAt(tailIndex: number): EventId;
  /** Tail index of `id`, or `-1`. */
  indexOf(id: EventId): number;
  agentAt(tailIndex: number): number;
  sequenceAt(tailIndex: number): number;
  maximumSequenceForReplica(replicaId: string): number | undefined;
  iterateIds(): IterableIterator<EventId>;
}

/** ID index of a repacked prefix: the prefix's own index, then the tail. */
class TailExtendedIdIndex implements PackedEventIdIndex {
  readonly count: number;

  constructor(
    private readonly base: PackedEventGraphBase,
    private readonly tail: PackedTailEvents,
  ) {
    this.count = base.count + tail.count;
  }

  get agents(): AgentTable {
    return this.base.agents;
  }

  has(id: EventId): boolean {
    return this.offsetOf(id) !== undefined;
  }

  offsetOf(id: EventId): number | undefined {
    const baseOffset = this.base.offsetOf(id);
    if (baseOffset !== undefined) {
      return baseOffset;
    }
    const tailIndex = this.tail.indexOf(id);
    return tailIndex < 0 ? undefined : this.base.count + tailIndex;
  }

  idAt(offset: number): EventId | undefined {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.count) {
      return undefined;
    }
    return offset < this.base.count
      ? this.base.idAt(offset)
      : this.tail.idAt(offset - this.base.count);
  }

  agentAt(offset: number): number {
    return offset < this.base.count
      ? this.base.agentAt(offset)
      : this.tail.agentAt(offset - this.base.count);
  }

  sequenceAt(offset: number): number {
    return offset < this.base.count
      ? this.base.sequenceAt(offset)
      : this.tail.sequenceAt(offset - this.base.count);
  }

  canonicalRunAt(offset: number): PackedCanonicalIdRun | undefined {
    return offset < this.base.count
      ? this.base.canonicalIdRunAt(offset)
      : undefined;
  }

  *iterateIds(): IterableIterator<EventId> {
    yield* this.base.iterateIds();
    yield* this.tail.iterateIds();
  }

  maximumSequenceForReplica(replicaId: string): number | undefined {
    const baseMaximum = this.base.maximumSequenceForReplica(replicaId);
    const tailMaximum = this.tail.maximumSequenceForReplica(replicaId);
    if (baseMaximum === undefined) {
      return tailMaximum;
    }
    return tailMaximum === undefined
      ? baseMaximum
      : Math.max(baseMaximum, tailMaximum);
  }
}

const indexMaterializedIds = (
  ids: ReadonlyArray<EventId>,
): PackedEventIdIndex => {
  const index = new EventIdRunIndex();
  for (const id of ids) {
    index.append(id);
  }
  return index.view();
};

const assertOperationColumnLengths = (
  columns: PackedOperationColumns,
  count: number,
): void => {
  if (
    columns.operationTypes.length !== count ||
    columns.operationIndexes.length !== count ||
    columns.operationLengths.length !== count ||
    columns.timestamps.length !== count ||
    columns.insertStarts.length !== count
  ) {
    throw new Error("Invalid packed event graph: column length mismatch");
  }
};

const fitsUint32 = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;

const fitsInt32 = (value: number): boolean =>
  Number.isInteger(value) && value >= -0x8000_0000 && value <= 0x7fff_ffff;

const everyValue = (
  values: ArrayLike<number>,
  test: (value: number) => boolean,
): boolean => {
  for (let index = 0; index < values.length; index++) {
    if (!test(values[index]!)) {
      return false;
    }
  }
  return true;
};

/** Copy a column and append values, widening only when a value needs it. */
const appendUnsignedColumn = (
  column: PackedUnsignedIntegerColumn,
  values: ArrayLike<number>,
): PackedUnsignedIntegerColumn => {
  const length = column.length + values.length;
  const result =
    column instanceof Uint32Array &&
    (values instanceof Uint32Array || everyValue(values, fitsUint32))
      ? new Uint32Array(length)
      : new Float64Array(length);
  result.set(column);
  result.set(values, column.length);
  return result;
};

const appendIntegerColumn = (
  column: PackedIntegerColumn,
  values: ArrayLike<number>,
): PackedIntegerColumn => {
  const length = column.length + values.length;
  const result =
    column instanceof Int32Array &&
    (values instanceof Int32Array || everyValue(values, fitsInt32))
      ? new Int32Array(length)
      : column instanceof Uint32Array && everyValue(values, fitsUint32)
        ? new Uint32Array(length)
        : new Float64Array(length);
  result.set(column);
  result.set(values, column.length);
  return result;
};

export const PACKED_OPERATION_TYPE = {
  INSERT: INSERT_OPERATION,
  DELETE: DELETE_OPERATION,
} as const;
