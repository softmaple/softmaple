import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import { compareEventIds, parseEventId } from "../event-id";
import {
  type PackedIntegerColumn,
  type PackedUnsignedIntegerColumn,
} from "./packed-numeric-columns";

const INSERT_OPERATION = 1;
const DELETE_OPERATION = 2;

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
  iterateIds(): IterableIterator<EventId>;
  maximumSequenceForReplica(replicaId: string): number | undefined;
}

interface MaterializedPackedEventIds {
  readonly ids: ReadonlyArray<EventId>;
  readonly offsetById: ReadonlyMap<EventId, number>;
  readonly idIndex?: never;
}

interface IndexedPackedEventIds {
  readonly ids?: never;
  readonly offsetById?: never;
  readonly idIndex: PackedEventIdIndex;
}

export type PackedEventGraphColumns = PackedEventGraphCommonColumns &
  (MaterializedPackedEventIds | IndexedPackedEventIds);

export interface PackedLinearEventGraphBuild {
  readonly base: PackedEventGraphBase;
  readonly frontier: ReadonlySet<EventId>;
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

  constructor(columns: PackedEventGraphColumns) {
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
    if (idIndex !== undefined && !this.implicitLinearEdges) {
      throw new Error(
        "Invalid packed event graph: lazy IDs require implicit linear edges",
      );
    }
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

    if (idIndex === undefined) {
      // The packed decoder transfers ownership of this array. Keeping it
      // avoids a second O(N) pointer array at peak decode memory.
      const ids = Object.freeze(columns.ids);
      for (let offset = 0; offset < ids.length; offset++) {
        const id = ids[offset]!;
        if (
          typeof id !== "string" ||
          id.length === 0 ||
          columns.offsetById.get(id) !== offset
        ) {
          throw new Error(
            `Invalid packed event graph event ID at offset ${offset}`,
          );
        }
      }
      if (columns.offsetById.size !== count) {
        throw new Error("Invalid packed event graph: ID index size mismatch");
      }

      this.ids = ids;
      this.offsetById = columns.offsetById;
      this.idIndex = null;
    } else {
      this.ids = null;
      this.offsetById = null;
      this.idIndex = idIndex;
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

  idAt(offset: number): EventId | undefined {
    return this.idIndex !== null
      ? this.idIndex.idAt(offset)
      : this.ids![offset];
  }

  *iterateIds(): IterableIterator<EventId> {
    if (this.idIndex !== null) {
      yield* this.idIndex.iterateIds();
    } else {
      yield* this.ids!;
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
    const remainingParents = new Uint32Array(this.count);
    const roots: number[] = [];

    for (let offset = 0; offset < this.count; offset++) {
      const parentCount = this.parentCountAt(offset);
      remainingParents[offset] = parentCount;
      if (parentCount === 0) roots.push(offset);
    }
    roots.sort((left, right) =>
      compareEventIds(this.ids![left]!, this.ids![right]!),
    );

    const stack: number[] = [];
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push(roots[index]!);
    }

    const result = new Uint32Array(this.count);
    let resultLength = 0;
    while (stack.length > 0) {
      const offset = stack.pop()!;
      result[resultLength++] = offset;

      const newlyReady: number[] = [];
      const start = this.childStarts![offset]!;
      const end = this.childStarts![offset + 1]!;
      for (let cursor = start; cursor < end; cursor++) {
        const childOffset = this.childOffsets![cursor]!;
        const remaining = remainingParents[childOffset]! - 1;
        remainingParents[childOffset] = remaining;
        if (remaining === 0) newlyReady.push(childOffset);
      }
      newlyReady.sort((left, right) =>
        compareEventIds(this.ids![left]!, this.ids![right]!),
      );
      for (let index = newlyReady.length - 1; index >= 0; index--) {
        stack.push(newlyReady[index]!);
      }
    }

    if (resultLength !== this.count) {
      throw new Error("Cycle detected in packed event graph");
    }
    return result;
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
    base: new PackedEventGraphBase({
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
