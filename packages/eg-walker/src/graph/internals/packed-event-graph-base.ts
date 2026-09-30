import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import type { AgentTable } from "./agent-table";
import { EventIdTieBreaker } from "./event-id-tie-breaker";
import {
  EventIdRunIndex,
  type PackedCanonicalIdRun,
} from "./event-id-run-index";
import { MaxHeap } from "./max-heap";
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
  readonly parentStarts: Uint32Array;
  readonly parentOffsets: Uint32Array;
  readonly childStarts: Uint32Array;
  readonly childOffsets: Uint32Array;
  readonly implicitLinearEdges?: boolean;
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
  ensureRunLookup?(): void;
  releaseCanonicalRunLookup?(): void;
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
  /** Events emitted without repeating unchanged strict-chain bookkeeping. */
  readonly strictChainEventCount: number;
  /** Maximal strict-chain spans emitted by the fast path. */
  readonly strictChainRunCount: number;
}

interface PackedBranchTraversalWorkspace {
  readonly remainingParents: Uint32Array;
  readonly roots: number[];
  sortBranchGroup(group: number[]): void;
}

/**
 * Immutable, allocation-light storage for an already validated EGW3 prefix.
 *
 * Public `GraphEvent` objects and parent sets are reconstructed only at an API
 * boundary. Graph queries use the packed numeric columns and CSR edges
 * directly, so loading a snapshot does not permanently allocate an object,
 * operation and two sets for every event.
 */
export class PackedEventGraphBase {
  private readonly ids: ReadonlyArray<EventId> | null;
  private readonly idIndex: PackedEventIdIndex;
  private readonly eventCount: number;
  /** `null` until {@link loadOperationColumns} supplies deferred columns. */
  private operationColumns: PackedOperationColumns | null;
  private readonly loadOperationColumns: (() => PackedOperationColumns) | null;
  private readonly insertedContent: string;
  private readonly parentStarts: Uint32Array | null;
  private readonly parentOffsets: Uint32Array | null;
  private readonly childStarts: Uint32Array | null;
  private readonly childOffsets: Uint32Array | null;
  private readonly implicitLinearEdges: boolean;
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
      parentStarts: new Uint32Array(1),
      parentOffsets: new Uint32Array(0),
      childStarts: new Uint32Array(1),
      childOffsets: new Uint32Array(0),
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
      if (columns.implicitLinearEdges !== true) {
        throw new Error("Deferred operation columns require a linear graph");
      }
      this.operationColumns = null;
      this.loadOperationColumns = columns.loadOperationColumns;
    }
    this.implicitLinearEdges = columns.implicitLinearEdges ?? false;
    if (!this.implicitLinearEdges) {
      if (
        columns.parentStarts.length !== count + 1 ||
        columns.childStarts.length !== count + 1
      ) {
        throw new Error("Invalid packed event graph: column length mismatch");
      }
      if (
        columns.parentStarts[count] !== columns.parentOffsets.length ||
        columns.childStarts[count] !== columns.childOffsets.length
      ) {
        throw new Error("Invalid packed event graph: CSR length mismatch");
      }
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
    this.parentStarts = this.implicitLinearEdges ? null : columns.parentStarts;
    this.parentOffsets = this.implicitLinearEdges
      ? null
      : columns.parentOffsets;
    this.childStarts = this.implicitLinearEdges ? null : columns.childStarts;
    this.childOffsets = this.implicitLinearEdges ? null : columns.childOffsets;
    this.exactLinear = this.implicitLinearEdges || this.computeExactLinear();
  }

  get count(): number {
    return this.eventCount;
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
    rankByOffset?: Uint32Array,
  ): PackedOffsetTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffVersionToParents(
      currentVersion,
      targetEventOffset,
      this,
      rankByOffset,
    );
  }

  /**
   * Compute a range-compressed transition from an ID frontier to one event's
   * parents. The returned buffers are overwritten by the next diff query.
   */
  diffVersionToParentRanges(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
    rankByOffset?: Uint32Array,
  ): PackedLocalVersionTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffVersionToParentRanges(
      currentVersion,
      targetEventOffset,
      this,
      rankByOffset,
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
    rankByOffset?: Uint32Array,
  ): PackedLocalVersionTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffLocalVersionsToParentRanges(
      currentOffsets,
      targetEventOffset,
      this,
      rankByOffset,
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
    rankByOffset?: Uint32Array,
  ): PackedOffsetTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffOffsetToParents(
      currentOffset,
      targetEventOffset,
      this,
      rankByOffset,
    );
  }

  /**
   * Compute a range-compressed transition from one event to another event's
   * parents. The returned buffers are overwritten by the next diff query.
   */
  diffOffsetToParentRanges(
    currentOffset: number,
    targetEventOffset: number,
    rankByOffset?: Uint32Array,
  ): PackedLocalVersionTransition {
    this.diffWorkspace ??= new PackedDiffVersionsWorkspace(this.count);
    return this.diffWorkspace.diffOffsetToParentRanges(
      currentOffset,
      targetEventOffset,
      this,
      rankByOffset,
    );
  }

  /** Release scratch storage once a packed replay has finished. */
  releaseDiffWorkspace(): void {
    this.diffWorkspace = null;
    this.idIndex.releaseCanonicalRunLookup?.();
  }

  /**
   * Prepare random access to agents and sequences by offset, as a replay
   * that walks events out of order does. Released with the diff workspace.
   */
  prepareIdLookup(): void {
    this.idIndex.ensureRunLookup?.();
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
    if (this.implicitLinearEdges) {
      return offset > 0 && offset < this.count ? 1 : 0;
    }
    return this.parentStarts![offset + 1]! - this.parentStarts![offset]!;
  }

  /** Return a parent as a packed insertion offset without materialising IDs. */
  parentOffsetAt(offset: number, parentIndex: number): number | undefined {
    if (!Number.isInteger(parentIndex) || parentIndex < 0) {
      return undefined;
    }
    if (this.implicitLinearEdges) {
      return parentIndex === 0 && offset > 0 && offset < this.count
        ? offset - 1
        : undefined;
    }
    const start = this.parentStarts![offset];
    const end = this.parentStarts![offset + 1];
    if (
      start === undefined ||
      end === undefined ||
      start + parentIndex >= end
    ) {
      return undefined;
    }
    return this.parentOffsets![start + parentIndex];
  }

  childCountAt(offset: number): number {
    if (this.implicitLinearEdges) {
      return offset >= 0 && offset + 1 < this.count ? 1 : 0;
    }
    return this.childStarts![offset + 1]! - this.childStarts![offset]!;
  }

  /** Return a child as a packed insertion offset without materialising IDs. */
  childOffsetAt(offset: number, childIndex: number): number | undefined {
    if (!Number.isInteger(childIndex) || childIndex < 0) {
      return undefined;
    }
    if (this.implicitLinearEdges) {
      return childIndex === 0 && offset >= 0 && offset + 1 < this.count
        ? offset + 1
        : undefined;
    }
    const start = this.childStarts![offset];
    const end = this.childStarts![offset + 1];
    if (start === undefined || end === undefined || start + childIndex >= end) {
      return undefined;
    }
    return this.childOffsets![start + childIndex];
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
      if (this.implicitLinearEdges) {
        const child = this.idAt(offset + 1);
        if (child !== undefined) yield child;
        return;
      }
      const start = this.childStarts![offset]!;
      const end = this.childStarts![offset + 1]!;
      for (let cursor = start; cursor < end; cursor++) {
        yield this.requireIdAt(this.childOffsets![cursor]!);
      }
    }
  }

  /**
   * Return Kahn's topological order as packed insertion offsets, taking
   * ready events in {@link compareEventIds} order.
   *
   * This is the order {@link EventGraph.getTopologicalOrder} returns. It runs
   * over the CSR edges with a typed parent counter and a heap of offsets, and
   * parses an event's ID only when it is ready together with another event.
   */
  getTopologicalOrderOffsets(): Uint32Array {
    const count = this.count;
    const order = new Uint32Array(count);
    if (this.implicitLinearEdges) {
      for (let offset = 0; offset < count; offset++) {
        order[offset] = offset;
      }
      return order;
    }
    const parentStarts = this.parentStarts!;
    const childStarts = this.childStarts!;
    const childOffsets = this.childOffsets!;
    const ids = new EventIdTieBreaker(this);
    // A max-heap with an inverted comparator pops the smallest ready ID.
    const ready = new MaxHeap<number>((left, right) =>
      ids.compare(right, left),
    );
    const remainingParents = new Uint32Array(count);
    for (let offset = 0; offset < count; offset++) {
      const parentCount = parentStarts[offset + 1]! - parentStarts[offset]!;
      remainingParents[offset] = parentCount;
      if (parentCount === 0) {
        ready.push(offset);
      }
    }

    let length = 0;
    while (ready.size > 0) {
      const offset = ready.pop()!;
      order[length++] = offset;
      const end = childStarts[offset + 1]!;
      for (let cursor = childStarts[offset]!; cursor < end; cursor++) {
        const childOffset = childOffsets[cursor]!;
        const remaining = remainingParents[childOffset]! - 1;
        remainingParents[childOffset] = remaining;
        if (remaining === 0) {
          ready.push(childOffset);
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
   * A decoded prefix is already a validated DAG whose parents always precede
   * their children. Keeping this traversal numeric avoids rebuilding an
   * `EventId -> remaining parent count` map and avoids a string-ID lookup plus
   * generator allocation for every visited child edge during cold replay.
   */
  getBranchPreservingOrderOffsets(): Uint32Array {
    if (this.implicitLinearEdges) {
      const result = new Uint32Array(this.count);
      for (let offset = 0; offset < this.count; offset++) {
        result[offset] = offset;
      }
      return result;
    }
    const { remainingParents, roots, sortBranchGroup } =
      this.createBranchTraversalWorkspace();

    const stack: number[] = [];
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push(roots[index]!);
    }

    const result = new Uint32Array(this.count);
    let resultLength = 0;
    // Most events release no child (and a linear edge releases exactly one).
    // Reusing one scratch group avoids allocating an empty array for every
    // event in large operation-granularity traces while preserving the same
    // branch-group ordering whenever several children become ready together.
    const newlyReady: number[] = [];
    while (stack.length > 0) {
      const offset = stack.pop()!;
      result[resultLength++] = offset;

      newlyReady.length = 0;
      const start = this.childStarts![offset]!;
      const end = this.childStarts![offset + 1]!;
      for (let cursor = start; cursor < end; cursor++) {
        const childOffset = this.childOffsets![cursor]!;
        const remaining = remainingParents[childOffset]! - 1;
        remainingParents[childOffset] = remaining;
        if (remaining === 0) newlyReady.push(childOffset);
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
   * Build replay order, inverse rank, and critical cuts in one numeric DFS.
   *
   * The standalone critical planner historically initialized another parent
   * counter, walked every child edge again, kept a separate ready bitmap, and
   * inverted the finished order in a final pass. The DFS stack is already the
   * authoritative ready set, so critical-frontier accounting can advance as
   * each offset is emitted. Once an offset is popped, its remaining-parent
   * slot is dead and can hold the inverse replay rank.
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
        strictChainEventCount: 0,
        strictChainRunCount: 0,
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
        strictChainEventCount: 0,
        strictChainRunCount: 0,
      };
    }

    const { remainingParents, roots, sortBranchGroup } =
      this.createBranchTraversalWorkspace();
    const parentStarts = this.parentStarts!;
    const parentOffsets = this.parentOffsets!;
    const childStarts = this.childStarts!;
    const childOffsets = this.childOffsets!;

    const stack: number[] = [];
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push(roots[index]!);
    }

    const eventOrder = new Uint32Array(eventCount);
    const rankByOffset = remainingParents;
    const sectionEnds = new Uint32Array(eventCount);
    const linearSections = new Uint8Array(eventCount);
    const prefixFrontier = new Uint8Array(eventCount);
    const readyParentCoverage = new Uint32Array(eventCount);
    const newlyReady: number[] = [];

    let readyCount = roots.length;
    let prefixFrontierSize = 0;
    let missingReadyParentPairs = 0;
    let sectionCount = 0;
    let sectionStart = 0;
    let sectionIsLinear = true;
    let resultLength = 0;
    let strictChainEventCount = 0;
    let strictChainRunCount = 0;

    while (stack.length > 0) {
      const eventOffset = stack.pop()!;
      const orderIndex = resultLength;
      eventOrder[orderIndex] = eventOffset;
      rankByOffset[eventOffset] = orderIndex;
      resultLength++;
      readyCount--;

      const parentStart = parentStarts[eventOffset]!;
      const parentEnd = parentStarts[eventOffset + 1]!;
      const parentCount = parentEnd - parentStart;
      const prefixFrontierSizeBefore = prefixFrontierSize;
      let parentsInPrefixFrontier = 0;

      // Remove the popped ready root's coverage while replacing its live
      // parents with the event itself. All arithmetic uses the ready count
      // after the pop, matching the standalone planner exactly.
      for (let cursor = parentStart; cursor < parentEnd; cursor++) {
        const parentOffset = parentOffsets[cursor]!;
        const previousCoverage = readyParentCoverage[parentOffset]!;
        if (previousCoverage === 0) {
          throw new Error("Invalid packed replay ready-parent coverage");
        }
        const nextCoverage = previousCoverage - 1;
        readyParentCoverage[parentOffset] = nextCoverage;

        if (prefixFrontier[parentOffset] !== 1) {
          continue;
        }
        parentsInPrefixFrontier++;
        missingReadyParentPairs -= readyCount - nextCoverage;
        prefixFrontier[parentOffset] = 0;
        prefixFrontierSize--;
      }

      if (orderIndex === sectionStart) {
        sectionIsLinear =
          parentCount === prefixFrontierSizeBefore &&
          parentsInPrefixFrontier === prefixFrontierSizeBefore;
      } else if (
        parentCount !== 1 ||
        parentOffsets[parentStart] !== eventOrder[orderIndex - 1]
      ) {
        sectionIsLinear = false;
      }

      missingReadyParentPairs -=
        prefixFrontierSizeBefore - parentsInPrefixFrontier;
      prefixFrontier[eventOffset] = 1;
      prefixFrontierSize++;
      missingReadyParentPairs += readyCount - readyParentCoverage[eventOffset]!;

      newlyReady.length = 0;
      const childStart = childStarts[eventOffset]!;
      const childEnd = childStarts[eventOffset + 1]!;
      for (let cursor = childStart; cursor < childEnd; cursor++) {
        const childOffset = childOffsets[cursor]!;
        const remaining = remainingParents[childOffset]! - 1;
        remainingParents[childOffset] = remaining;
        if (remaining !== 0) {
          continue;
        }

        const childParentStart = parentStarts[childOffset]!;
        const childParentEnd = parentStarts[childOffset + 1]!;
        let childParentsInPrefixFrontier = 0;
        for (
          let parentCursor = childParentStart;
          parentCursor < childParentEnd;
          parentCursor++
        ) {
          const parentOffset = parentOffsets[parentCursor]!;
          if (prefixFrontier[parentOffset] === 1) {
            childParentsInPrefixFrontier++;
          }
          readyParentCoverage[parentOffset] =
            readyParentCoverage[parentOffset]! + 1;
        }
        missingReadyParentPairs +=
          prefixFrontierSize - childParentsInPrefixFrontier;
        readyCount++;
        newlyReady.push(childOffset);
      }

      if (readyCount === 0 || missingReadyParentPairs === 0) {
        sectionEnds[sectionCount] = orderIndex + 1;
        linearSections[sectionCount] = sectionIsLinear ? 1 : 0;
        sectionCount++;
        sectionStart = orderIndex + 1;
      }

      // A strict p -> v -> c chain leaves every frontier cardinality and
      // ready-parent coverage total unchanged while replacing p with v.
      // Hold the sole newly-ready event out of the stack, emit v, and replace
      // it with c without repeating the parent/child edge scans.
      // Stop before a leaf, fan-out, or fan-in boundary; the normal loop owns
      // those state transitions.
      if (
        newlyReady.length === 1 &&
        childEnd - childStart === 1 &&
        childOffsets[childStart] === newlyReady[0] &&
        prefixFrontier[eventOffset] === 1 &&
        readyParentCoverage[eventOffset] === 1
      ) {
        let chainEventOffset = newlyReady[0]!;
        const chainEventParentStart = parentStarts[chainEventOffset]!;
        const chainEventParentEnd = parentStarts[chainEventOffset + 1]!;
        if (
          chainEventParentEnd - chainEventParentStart === 1 &&
          parentOffsets[chainEventParentStart] === eventOffset &&
          remainingParents[chainEventOffset] === 0
        ) {
          let chainTailOffset = -1;
          const chainEmitsCut =
            readyCount === 0 || missingReadyParentPairs === 0;
          const chainSectionIsLinear = prefixFrontierSize === 1;
          if (!chainEmitsCut && resultLength === sectionStart) {
            sectionIsLinear = chainSectionIsLinear;
          }

          // Packed insertion offsets are topological ranks. Long operation-
          // granularity runs are normally stored as consecutive one-parent
          // offsets, so prove that compact CSR shape directly and skip child
          // offset loads plus parent-counter writes for every interior event.
          while (chainEventOffset + 1 < eventCount) {
            const chainChildOffset = chainEventOffset + 1;
            const chainChildStart = childStarts[chainEventOffset]!;
            const chainChildParentStart = parentStarts[chainChildOffset]!;
            if (
              childStarts[chainEventOffset + 1] !== chainChildStart + 1 ||
              parentStarts[chainChildOffset + 1] !==
                chainChildParentStart + 1 ||
              parentOffsets[chainChildParentStart] !== chainEventOffset
            ) {
              break;
            }

            eventOrder[resultLength] = chainEventOffset;
            rankByOffset[chainEventOffset] = resultLength;
            resultLength++;
            strictChainEventCount++;
            if (chainEmitsCut) {
              sectionEnds[sectionCount] = resultLength;
              linearSections[sectionCount] = chainSectionIsLinear ? 1 : 0;
              sectionCount++;
              sectionStart = resultLength;
            }

            chainTailOffset = chainEventOffset;
            chainEventOffset = chainChildOffset;
          }

          // The general tier preserves arbitrary non-adjacent packed DAGs.
          // Interior remaining-parent slots are dead once their event is
          // emitted and immediately become inverse ranks, so only the final
          // held-out child needs to be marked ready before it reaches stack.
          while (true) {
            const chainChildStart = childStarts[chainEventOffset]!;
            const chainChildEnd = childStarts[chainEventOffset + 1]!;
            if (chainChildEnd - chainChildStart !== 1) {
              break;
            }
            const chainChildOffset = childOffsets[chainChildStart]!;
            const chainChildParentStart = parentStarts[chainChildOffset]!;
            const chainChildParentEnd = parentStarts[chainChildOffset + 1]!;
            if (
              chainChildParentEnd - chainChildParentStart !== 1 ||
              parentOffsets[chainChildParentStart] !== chainEventOffset ||
              remainingParents[chainChildOffset] !== 1
            ) {
              break;
            }

            eventOrder[resultLength] = chainEventOffset;
            rankByOffset[chainEventOffset] = resultLength;
            resultLength++;
            strictChainEventCount++;
            if (chainEmitsCut) {
              sectionEnds[sectionCount] = resultLength;
              linearSections[sectionCount] = chainSectionIsLinear ? 1 : 0;
              sectionCount++;
              sectionStart = resultLength;
            }

            chainTailOffset = chainEventOffset;
            chainEventOffset = chainChildOffset;
          }

          if (chainTailOffset !== -1) {
            strictChainRunCount++;
            remainingParents[chainEventOffset] = 0;
            prefixFrontier[eventOffset] = 0;
            readyParentCoverage[eventOffset] = 0;
            prefixFrontier[chainTailOffset] = 1;
            readyParentCoverage[chainTailOffset] = 1;
            newlyReady[0] = chainEventOffset;
          }
        }
      }

      if (newlyReady.length > 1) {
        sortBranchGroup(newlyReady);
      }
      for (let index = newlyReady.length - 1; index >= 0; index--) {
        stack.push(newlyReady[index]!);
      }
    }

    if (resultLength !== eventCount) {
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
      strictChainEventCount,
      strictChainRunCount,
    };
  }

  private createBranchTraversalWorkspace(): PackedBranchTraversalWorkspace {
    const remainingParents = new Uint32Array(this.count);
    const exclusiveSpan = new Uint32Array(this.count);
    let longestPath: Uint32Array | null = null;
    const roots: number[] = [];
    const parentStarts = this.parentStarts!;
    const childStarts = this.childStarts!;
    const childOffsets = this.childOffsets!;

    for (let offset = 0; offset < this.count; offset++) {
      const parentCount = parentStarts[offset + 1]! - parentStarts[offset]!;
      remainingParents[offset] = parentCount;
      if (parentCount === 0) {
        roots.push(offset);
      }
    }

    // Packed insertion offsets are topological ranks. Accumulate the size of
    // each exclusive single-parent branch in reverse order; multi-parent
    // merge suffixes are shared and therefore do not belong to either branch.
    //
    // Longest-path ordering is needed only after some exclusive branch crosses
    // MAX_EXCLUSIVE_BRANCH_SPAN. Most collaborative traces never cross that
    // threshold, so allocating and filling another event-sized column for
    // every child edge is pure cold-load overhead. Activate it lazily at the
    // first long branch. Because children have larger topological offsets,
    // only the already-visited suffix needs a one-time backfill.
    let nextCombinedOffset = -1;
    for (let offset = this.count - 1; offset >= 0; offset--) {
      let span = 1;
      const start = childStarts[offset]!;
      const end = childStarts[offset + 1]!;
      for (let cursor = start; cursor < end; cursor++) {
        const childOffset = childOffsets[cursor]!;
        if (remainingParents[childOffset] === 1) {
          span += exclusiveSpan[childOffset]!;
        }
      }
      exclusiveSpan[offset] = span;
      if (span > MAX_EXCLUSIVE_BRANCH_SPAN) {
        longestPath = new Uint32Array(this.count);
        for (
          let backfillOffset = this.count - 1;
          backfillOffset >= offset;
          backfillOffset--
        ) {
          let backfillPath = 1;
          const backfillStart = childStarts[backfillOffset]!;
          const backfillEnd = childStarts[backfillOffset + 1]!;
          for (let cursor = backfillStart; cursor < backfillEnd; cursor++) {
            backfillPath = Math.max(
              backfillPath,
              1 + longestPath[childOffsets[cursor]!]!,
            );
          }
          longestPath[backfillOffset] = backfillPath;
        }
        nextCombinedOffset = offset - 1;
        break;
      }
    }
    if (longestPath !== null) {
      for (let offset = nextCombinedOffset; offset >= 0; offset--) {
        let span = 1;
        let path = 1;
        const start = childStarts[offset]!;
        const end = childStarts[offset + 1]!;
        for (let cursor = start; cursor < end; cursor++) {
          const childOffset = childOffsets[cursor]!;
          if (remainingParents[childOffset] === 1) {
            span += exclusiveSpan[childOffset]!;
          }
          path = Math.max(path, 1 + longestPath[childOffset]!);
        }
        exclusiveSpan[offset] = span;
        longestPath[offset] = path;
      }
    }

    // Most sibling groups differ in span; IDs break only the remaining ties.
    const ids = new EventIdTieBreaker(this);
    const compareIds = (left: number, right: number): number =>
      ids.compare(left, right);
    const compareExclusive = (left: number, right: number): number => {
      const difference = exclusiveSpan[left]! - exclusiveSpan[right]!;
      return difference === 0 ? compareIds(left, right) : difference;
    };
    const compareLongest = (left: number, right: number): number => {
      const difference = longestPath![left]! - longestPath![right]!;
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
   * Operation and edge columns are copied, which is linear in the graph like
   * the replay that needs them. IDs are not re-materialized: offsets below
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
    const tailIndexes: number[] = [];
    const tailLengths: number[] = [];
    const tailTimestamps: number[] = [];
    const insertStarts = new Uint32Array(count);
    insertStarts.set(baseOperations.insertStarts);
    const baseContentLength = this.insertedContent.length;
    const tailContent = tail.insertedContent();
    if (baseContentLength + tailContent.length > 0xffff_ffff) {
      throw new Error("Inserted content exceeds packed UTF-16 offset range");
    }

    const parentStarts = new Uint32Array(count + 1);
    let edgeCount = 0;
    if (this.parentStarts !== null) {
      parentStarts.set(this.parentStarts);
      edgeCount = this.parentStarts[baseCount]!;
    } else {
      for (let offset = 0; offset < baseCount; offset++) {
        edgeCount += this.parentCountAt(offset);
        parentStarts[offset + 1] = edgeCount;
      }
    }
    const tailParents: number[] = [];
    const pushTailParent = (parentOffset: number): void => {
      tailParents.push(parentOffset);
    };
    for (let tailIndex = 0; tailIndex < tail.count; tailIndex++) {
      const offset = baseCount + tailIndex;
      tailIndexes.push(tail.operationIndexAt(tailIndex));
      tailLengths.push(tail.operationLengthAt(tailIndex));
      tailTimestamps.push(tail.timestampAt(tailIndex));
      if (tail.isInsertAt(tailIndex)) {
        operationTypes[offset] = INSERT_OPERATION;
        insertStarts[offset] =
          baseContentLength + tail.insertStartAt(tailIndex);
      } else {
        operationTypes[offset] = DELETE_OPERATION;
      }
      tail.forEachParentOffset(tailIndex, pushTailParent);
      parentStarts[offset + 1] = edgeCount + tailParents.length;
    }

    const parentOffsets = new Uint32Array(edgeCount + tailParents.length);
    if (this.parentOffsets !== null) {
      parentOffsets.set(this.parentOffsets);
    } else {
      for (let offset = 1; offset < baseCount; offset++) {
        parentOffsets[offset - 1] = offset - 1;
      }
    }
    parentOffsets.set(tailParents, edgeCount);
    const childCounts = new Uint32Array(count);
    for (let edge = 0; edge < parentOffsets.length; edge++) {
      const parentOffset = parentOffsets[edge]!;
      childCounts[parentOffset] = childCounts[parentOffset]! + 1;
    }

    // Children in ascending offset order, exactly as the EGW3 decoder builds
    // them, so branch ordering of the repacked graph matches a fresh decode.
    const childStarts = new Uint32Array(count + 1);
    for (let offset = 0; offset < count; offset++) {
      childStarts[offset + 1] = childStarts[offset]! + childCounts[offset]!;
    }
    const childOffsets = new Uint32Array(parentOffsets.length);
    const childCursors = childCounts;
    childCursors.set(childStarts.subarray(0, count));
    for (let childOffset = 0; childOffset < count; childOffset++) {
      const end = parentStarts[childOffset + 1]!;
      for (let edge = parentStarts[childOffset]!; edge < end; edge++) {
        const parentOffset = parentOffsets[edge]!;
        childOffsets[childCursors[parentOffset]!] = childOffset;
        childCursors[parentOffset] = childCursors[parentOffset]! + 1;
      }
    }

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
      parentStarts,
      parentOffsets,
      childStarts,
      childOffsets,
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
    if (this.implicitLinearEdges) {
      const parent = this.idAt(offset - 1);
      if (parent !== undefined) yield parent;
      return;
    }
    const start = this.parentStarts![offset]!;
    const end = this.parentStarts![offset + 1]!;
    for (let cursor = start; cursor < end; cursor++) {
      yield this.requireIdAt(this.parentOffsets![cursor]!);
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

  private computeExactLinear(): boolean {
    for (let offset = 0; offset < this.count; offset++) {
      const start = this.parentStarts![offset]!;
      const end = this.parentStarts![offset + 1]!;
      if (offset === 0) {
        if (start !== end) return false;
      } else if (
        end - start !== 1 ||
        this.parentOffsets![start] !== offset - 1
      ) {
        return false;
      }
    }
    return true;
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

  ensureRunLookup(): void {
    this.base.prepareIdLookup();
  }

  releaseCanonicalRunLookup(): void {
    // The prefix owns the canonical lookup; releasing its scratch state is
    // what the owning graph does on every mutation anyway.
    this.base.releaseDiffWorkspace();
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

/** Copy a column and append values, widening only when a value needs it. */
const appendUnsignedColumn = (
  column: PackedUnsignedIntegerColumn,
  values: ReadonlyArray<number>,
): PackedUnsignedIntegerColumn => {
  const length = column.length + values.length;
  const result =
    column instanceof Uint32Array && values.every(fitsUint32)
      ? new Uint32Array(length)
      : new Float64Array(length);
  result.set(column);
  result.set(values, column.length);
  return result;
};

const appendIntegerColumn = (
  column: PackedIntegerColumn,
  values: ReadonlyArray<number>,
): PackedIntegerColumn => {
  const length = column.length + values.length;
  const result =
    column instanceof Int32Array && values.every(fitsInt32)
      ? new Int32Array(length)
      : column instanceof Uint32Array && values.every(fitsUint32)
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
