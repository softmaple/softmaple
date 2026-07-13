import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import { compareEventIds } from "../event-id";

const INSERT_OPERATION = 1;
const DELETE_OPERATION = 2;

export interface PackedEventGraphColumns {
  readonly ids: ReadonlyArray<EventId>;
  readonly offsetById: ReadonlyMap<EventId, number>;
  readonly operationTypes: Uint8Array;
  readonly operationIndexes: Float64Array;
  readonly operationLengths: Float64Array;
  readonly timestamps: Float64Array;
  /** UTF-16 offset of each INSERT event in `insertedContent`; 0 for DELETE. */
  readonly insertStarts: Uint32Array;
  readonly insertedContent: string;
  readonly parentStarts: Uint32Array;
  readonly parentOffsets: Uint32Array;
  readonly childStarts: Uint32Array;
  readonly childOffsets: Uint32Array;
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
  private readonly ids: ReadonlyArray<EventId>;
  private readonly offsetById: ReadonlyMap<EventId, number>;
  private readonly operationTypes: Uint8Array;
  private readonly operationIndexes: Float64Array;
  private readonly operationLengths: Float64Array;
  private readonly timestamps: Float64Array;
  private readonly insertStarts: Uint32Array;
  private readonly insertedContent: string;
  private readonly parentStarts: Uint32Array;
  private readonly parentOffsets: Uint32Array;
  private readonly childStarts: Uint32Array;
  private readonly childOffsets: Uint32Array;
  private readonly exactLinear: boolean;

  constructor(columns: PackedEventGraphColumns) {
    const count = columns.ids.length;
    if (
      columns.operationTypes.length !== count ||
      columns.operationIndexes.length !== count ||
      columns.operationLengths.length !== count ||
      columns.timestamps.length !== count ||
      columns.insertStarts.length !== count ||
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

    // The packed decoder transfers ownership of this array. Keeping it avoids
    // a second O(N) pointer array at peak decode memory.
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
    this.operationTypes = columns.operationTypes;
    this.operationIndexes = columns.operationIndexes;
    this.operationLengths = columns.operationLengths;
    this.timestamps = columns.timestamps;
    this.insertStarts = columns.insertStarts;
    this.insertedContent = columns.insertedContent;
    this.parentStarts = columns.parentStarts;
    this.parentOffsets = columns.parentOffsets;
    this.childStarts = columns.childStarts;
    this.childOffsets = columns.childOffsets;
    this.exactLinear = this.computeExactLinear();
  }

  get count(): number {
    return this.ids.length;
  }

  has(id: EventId): boolean {
    return this.offsetById.has(id);
  }

  offsetOf(id: EventId): number | undefined {
    return this.offsetById.get(id);
  }

  idAt(offset: number): EventId | undefined {
    return this.ids[offset];
  }

  *iterateIds(): IterableIterator<EventId> {
    yield* this.ids;
  }

  eventAt(offset: number): GraphEvent | undefined {
    const id = this.ids[offset];
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

  timestampAt(offset: number): number | undefined {
    return this.timestamps[offset];
  }

  parentCountAt(offset: number): number {
    return this.parentStarts[offset + 1]! - this.parentStarts[offset]!;
  }

  childCountAt(offset: number): number {
    return this.childStarts[offset + 1]! - this.childStarts[offset]!;
  }

  *iterateParents(id: EventId): IterableIterator<EventId> {
    const offset = this.offsetById.get(id);
    if (offset !== undefined) {
      yield* this.iterateParentsAt(offset);
    }
  }

  *iterateChildren(id: EventId): IterableIterator<EventId> {
    const offset = this.offsetById.get(id);
    if (offset !== undefined) {
      const start = this.childStarts[offset]!;
      const end = this.childStarts[offset + 1]!;
      for (let cursor = start; cursor < end; cursor++) {
        yield this.ids[this.childOffsets[cursor]!]!;
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
    const remainingParents = new Uint32Array(this.count);
    const roots: number[] = [];

    for (let offset = 0; offset < this.count; offset++) {
      const parentCount = this.parentCountAt(offset);
      remainingParents[offset] = parentCount;
      if (parentCount === 0) roots.push(offset);
    }
    roots.sort((left, right) =>
      compareEventIds(this.ids[left]!, this.ids[right]!),
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
      const start = this.childStarts[offset]!;
      const end = this.childStarts[offset + 1]!;
      for (let cursor = start; cursor < end; cursor++) {
        const childOffset = this.childOffsets[cursor]!;
        const remaining = remainingParents[childOffset]! - 1;
        remainingParents[childOffset] = remaining;
        if (remaining === 0) newlyReady.push(childOffset);
      }
      newlyReady.sort((left, right) =>
        compareEventIds(this.ids[left]!, this.ids[right]!),
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
    const start = this.parentStarts[offset]!;
    const end = this.parentStarts[offset + 1]!;
    for (let cursor = start; cursor < end; cursor++) {
      yield this.ids[this.parentOffsets[cursor]!]!;
    }
  }

  private computeExactLinear(): boolean {
    for (let offset = 0; offset < this.count; offset++) {
      const start = this.parentStarts[offset]!;
      const end = this.parentStarts[offset + 1]!;
      if (offset === 0) {
        if (start !== end) return false;
      } else if (
        end - start !== 1 ||
        this.parentOffsets[start] !== offset - 1
      ) {
        return false;
      }
    }
    return true;
  }
}

export const PACKED_OPERATION_TYPE = {
  INSERT: INSERT_OPERATION,
  DELETE: DELETE_OPERATION,
} as const;
