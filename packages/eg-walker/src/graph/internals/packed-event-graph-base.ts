import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import { compareEventIds, parseEventId } from "../event-id";
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

interface PackedEventGraphCommonColumns {
  readonly operationTypes: Uint8Array;
  readonly operationIndexes: PackedUnsignedIntegerColumn;
  readonly operationLengths: PackedUnsignedIntegerColumn;
  readonly timestamps: PackedIntegerColumn;
  /** UTF-16 offset of each INSERT event in `insertedContent`; 0 for DELETE. */
  readonly insertStarts: Uint32Array;
  readonly insertedContent: string;
  readonly parentStarts: Uint32Array;
  readonly parentOffsets: Uint32Array;
  readonly childStarts: Uint32Array;
  readonly childOffsets: Uint32Array;
  readonly implicitLinearEdges?: boolean;
}

export interface PackedEventIdIndex {
  readonly count: number;
  has(id: EventId): boolean;
  offsetOf(id: EventId): number | undefined;
  idAt(offset: number): EventId | undefined;
  canonicalRunAt?(offset: number): PackedCanonicalIdRun | undefined;
  releaseCanonicalRunLookup?(): void;
  iterateIds(): IterableIterator<EventId>;
  maximumSequenceForReplica(replicaId: string): number | undefined;
}

/** Canonical ID interval retained by the EGW3 run index. */
export interface PackedCanonicalIdRun {
  readonly replicaId: string;
  readonly startSequence: number;
  readonly startEventOffset: number;
  readonly length: number;
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
  private readonly offsetById: ReadonlyMap<EventId, number> | null;
  private readonly idIndex: PackedEventIdIndex | null;
  private readonly eventCount: number;
  private readonly operationTypes: Uint8Array;
  private readonly operationIndexes: PackedUnsignedIntegerColumn;
  private readonly operationLengths: PackedUnsignedIntegerColumn;
  private readonly timestamps: PackedIntegerColumn;
  private readonly insertStarts: Uint32Array;
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

  private constructor(
    columns: PackedEventGraphColumns,
    trustMaterializedIds: boolean,
  ) {
    const idIndex = columns.idIndex;
    const count = idIndex?.count ?? columns.ids!.length;
    if (
      columns.operationTypes.length !== count ||
      columns.operationIndexes.length !== count ||
      columns.operationLengths.length !== count ||
      columns.timestamps.length !== count ||
      columns.insertStarts.length !== count
    ) {
      throw new Error("Invalid packed event graph: column length mismatch");
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
      this.offsetById = idIndex === undefined ? columns.offsetById : null;
      this.idIndex = idIndex ?? null;
    } else {
      this.ids = null;
      this.offsetById = null;
      this.idIndex = idIndex!;
    }
    this.eventCount = count;
    this.operationTypes = columns.operationTypes;
    this.operationIndexes = columns.operationIndexes;
    this.operationLengths = columns.operationLengths;
    this.timestamps = columns.timestamps;
    this.insertStarts = columns.insertStarts;
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

  has(id: EventId): boolean {
    return this.idIndex !== null
      ? this.idIndex.has(id)
      : this.offsetById!.has(id);
  }

  offsetOf(id: EventId): number | undefined {
    return this.idIndex !== null
      ? this.idIndex.offsetOf(id)
      : this.offsetById!.get(id);
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
    this.idIndex?.releaseCanonicalRunLookup?.();
  }

  idAt(offset: number): EventId | undefined {
    return this.ids !== null ? this.ids[offset] : this.idIndex!.idAt(offset);
  }

  /** Return canonical author/sequence metadata without reparsing an ID. */
  canonicalIdRunAt(offset: number): PackedCanonicalIdRun | undefined {
    return this.idIndex?.canonicalRunAt?.(offset);
  }

  *iterateIds(): IterableIterator<EventId> {
    if (this.ids !== null) {
      yield* this.ids!;
    } else {
      yield* this.idIndex!.iterateIds();
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
      timestamp: this.timestamps[offset]!,
    };
  }

  operationAt(offset: number): ExternalOperation {
    const type = this.operationTypes[offset];
    const index = this.operationIndexes[offset]!;
    const length = this.operationLengths[offset]!;
    if (type === INSERT_OPERATION) {
      const start = this.insertStarts[offset]!;
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

  isInsertAt(offset: number): boolean {
    return this.operationTypes[offset] === INSERT_OPERATION;
  }

  operationIndexAt(offset: number): number {
    return this.operationIndexes[offset]!;
  }

  operationLengthAt(offset: number): number {
    return this.operationLengths[offset]!;
  }

  insertStartAt(offset: number): number {
    return this.insertStarts[offset]!;
  }

  sliceInsertedContent(start: number, end: number): string {
    return this.insertedContent.slice(start, end);
  }

  timestampAt(offset: number): number | undefined {
    return this.timestamps[offset];
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
        yield this.ids![this.childOffsets![cursor]!]!;
      }
    }
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

    const compareExclusive = (left: number, right: number): number => {
      const difference = exclusiveSpan[left]! - exclusiveSpan[right]!;
      return difference === 0
        ? compareEventIds(this.idAt(left)!, this.idAt(right)!)
        : difference;
    };
    const compareLongest = (left: number, right: number): number => {
      const difference = longestPath![left]! - longestPath![right]!;
      return difference === 0
        ? compareEventIds(this.idAt(left)!, this.idAt(right)!)
        : difference;
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
      yield this.ids![this.parentOffsets![cursor]!]!;
    }
  }

  maximumSequenceForReplica(replicaId: string): number | undefined {
    if (this.idIndex !== null) {
      return this.idIndex.maximumSequenceForReplica(replicaId);
    }
    let maximum: number | undefined;
    for (const id of this.ids!) {
      const parsed = parseEventId(id);
      if (
        parsed?.replicaId === replicaId &&
        (maximum === undefined || parsed.sequence > maximum)
      ) {
        maximum = parsed.sequence;
      }
    }
    return maximum;
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

/** Build packed columns directly from a validated exact causal chain. */
export const buildPackedLinearEventGraphBase = (
  events: ReadonlyArray<GraphEvent>,
): PackedLinearEventGraphBuild => {
  const count = events.length;
  const ids = new Array<EventId>(count);
  const offsetById = new Map<EventId, number>();
  const operationTypes = new Uint8Array(count);
  let operationIndexes: PackedUnsignedIntegerColumn = new Uint32Array(count);
  let operationLengths: PackedUnsignedIntegerColumn = new Uint32Array(count);
  let timestamps: PackedIntegerColumn = new Int32Array(count);
  const insertStarts = new Uint32Array(count);
  const insertedParts: string[] = [];
  let insertedLength = 0;
  let previousId: EventId | null = null;
  let hasNegativeTimestamp = false;

  for (let offset = 0; offset < count; offset++) {
    const event = events[offset]!;
    if (
      typeof event.id !== "string" ||
      event.id.length === 0 ||
      offsetById.has(event.id)
    ) {
      throw new Error(`Invalid or duplicate linear event ID ${event.id}`);
    }
    if (
      previousId === null
        ? event.parentVersion.size !== 0
        : event.parentVersion.size !== 1 || !event.parentVersion.has(previousId)
    ) {
      throw new Error(`Event ${event.id} does not extend the linear history`);
    }

    ids[offset] = event.id;
    offsetById.set(event.id, offset);
    const operationIndex = event.operation.index;
    if (!Number.isSafeInteger(operationIndex) || operationIndex < 0) {
      throw new Error(`Invalid operation index for event ${event.id}`);
    }
    if (!Number.isSafeInteger(event.timestamp)) {
      throw new Error(`Invalid timestamp for event ${event.id}`);
    }
    if (
      operationIndex > 0xffff_ffff &&
      operationIndexes instanceof Uint32Array
    ) {
      const wideIndexes = new Float64Array(count);
      wideIndexes.set(operationIndexes.subarray(0, offset));
      operationIndexes = wideIndexes;
    }
    operationIndexes[offset] = operationIndex;
    if (timestamps instanceof Int32Array) {
      if (event.timestamp < -0x8000_0000 || event.timestamp > 0x7fff_ffff) {
        const widerTimestamps: Uint32Array | Float64Array =
          !hasNegativeTimestamp &&
          event.timestamp >= 0 &&
          event.timestamp <= 0xffff_ffff
            ? new Uint32Array(count)
            : new Float64Array(count);
        widerTimestamps.set(timestamps.subarray(0, offset));
        timestamps = widerTimestamps;
      }
    } else if (
      timestamps instanceof Uint32Array &&
      (event.timestamp < 0 || event.timestamp > 0xffff_ffff)
    ) {
      const wideTimestamps = new Float64Array(count);
      wideTimestamps.set(timestamps.subarray(0, offset));
      timestamps = wideTimestamps;
    }
    timestamps[offset] = event.timestamp;
    hasNegativeTimestamp ||= event.timestamp < 0;
    if (event.operation.type === OPERATION_TYPE.INSERT) {
      if (insertedLength > 0xffff_ffff) {
        throw new Error("Inserted content exceeds packed UTF-16 offset range");
      }
      operationTypes[offset] = INSERT_OPERATION;
      operationLengths[offset] = event.operation.text.length;
      insertStarts[offset] = insertedLength;
      insertedParts.push(event.operation.text);
      insertedLength += event.operation.text.length;
    } else {
      if (
        !Number.isSafeInteger(event.operation.length) ||
        event.operation.length < 0
      ) {
        throw new Error(`Invalid operation length for event ${event.id}`);
      }
      if (
        event.operation.length > 0xffff_ffff &&
        operationLengths instanceof Uint32Array
      ) {
        const wideLengths = new Float64Array(count);
        wideLengths.set(operationLengths.subarray(0, offset));
        operationLengths = wideLengths;
      }
      operationTypes[offset] = DELETE_OPERATION;
      operationLengths[offset] = event.operation.length;
    }
    previousId = event.id;
  }

  return {
    base: PackedEventGraphBase.create({
      ids,
      offsetById,
      operationTypes,
      operationIndexes,
      operationLengths,
      timestamps,
      insertStarts,
      insertedContent: insertedParts.join(""),
      parentStarts: new Uint32Array(),
      parentOffsets: new Uint32Array(),
      childStarts: new Uint32Array(),
      childOffsets: new Uint32Array(),
      implicitLinearEdges: true,
    }),
    frontier: previousId === null ? new Set() : new Set<EventId>([previousId]),
  };
};

export const PACKED_OPERATION_TYPE = {
  INSERT: INSERT_OPERATION,
  DELETE: DELETE_OPERATION,
} as const;
