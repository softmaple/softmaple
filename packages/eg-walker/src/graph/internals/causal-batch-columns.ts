import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import { EventAlreadyExistsError } from "../event-graph-errors";
import { EventIdRunIndex } from "./event-id-run-index";
import { GraphRuns } from "./graph-runs";
import {
  PackedEventGraphBase,
  type PackedOperationColumns,
} from "./packed-event-graph-base";

/**
 * Owned columns of a one-shot causal batch. IDs are interned runs; only
 * parents outside the preceding batch prefix retain strings. Ordinary chain
 * edges are implicit, so edge storage follows branches rather than events.
 * @internal
 */
export class CausalBatchColumns {
  readonly ids = new EventIdRunIndex();
  readonly externalParents: EventId[] = [];
  readonly explicit: number[] = [];
  readonly parentStarts: number[] = [0];
  readonly parents: number[] = [];
  private readonly externalIndexes = new Map<EventId, number>();
  private readonly texts: string[] = [];
  private readonly parentScratch: number[] = [];
  private content = "";
  private contentLength = 0;
  private types: Uint8Array;
  private indexes: Uint32Array | Float64Array;
  private lengths: Uint32Array | Float64Array;
  private timestamps: Int32Array | Float64Array;
  private insertStarts: Uint32Array;
  private lastEventId = "";
  private duplicate: EventAlreadyExistsError | null = null;
  count = 0;
  exactChain = true;

  constructor(capacity: number) {
    this.types = new Uint8Array(capacity);
    this.indexes = new Uint32Array(capacity);
    this.lengths = new Uint32Array(capacity);
    this.timestamps = new Int32Array(capacity);
    this.insertStarts = new Uint32Array(capacity);
  }

  /** Append validated operation fields, reading and validating parents once. */
  append(
    id: EventId,
    parentIds: Iterable<EventId>,
    index: number,
    text: string | null,
    length: number,
    timestamp: number,
  ): void {
    if (this.contentLength + (text?.length ?? 0) > 0xffff_ffff) {
      throw new Error("Inserted content exceeds packed UTF-16 offset range");
    }
    const offset = this.count;
    this.appendParents(id, parentIds);
    // Preserve the API's validation boundary: duplicate IDs fail at apply,
    // not while building. No graph can adopt a batch with this error.
    if (this.duplicate === null) {
      try {
        this.ids.append(id);
      } catch (error) {
        if (!(error instanceof EventAlreadyExistsError)) throw error;
        this.duplicate = error;
      }
    }
    this.reserve(offset + 1);
    this.types[offset] = text === null ? 2 : 1;
    this.indexes[offset] = index;
    this.lengths[offset] = length;
    this.timestamps[offset] = timestamp;
    if (this.indexes[offset] !== index) {
      this.indexes = new Float64Array(this.indexes);
      this.indexes[offset] = index;
    }
    if (this.lengths[offset] !== length) {
      this.lengths = new Float64Array(this.lengths);
      this.lengths[offset] = length;
    }
    if (this.timestamps[offset] !== timestamp) {
      this.timestamps = new Float64Array(this.timestamps);
      this.timestamps[offset] = timestamp;
    }
    this.insertStarts[offset] = text === null ? 0 : this.contentLength;
    if (text !== null) {
      this.texts.push(text);
      this.contentLength += text.length;
    }
    this.count++;
    this.lastEventId = id;
  }

  /** Read caller code once; publish edges only after the iterable succeeds. */
  private appendParents(id: EventId, parentIds: Iterable<EventId>): void {
    const offset = this.count;
    const scratch = this.parentScratch;
    const externalStart = this.externalParents.length;
    let count = 0;
    let seen: Set<number> | null = null;
    try {
      for (const parent of parentIds) {
        if (typeof parent !== "string" || parent.length === 0) {
          throw new Error(`causal event ${id} has an invalid parent event ID`);
        }
        if (parent === id)
          throw new Error(`causal event ${id} cannot parent itself`);
        let rank =
          parent === this.lastEventId
            ? offset - 1
            : this.ids.localVersionOf(parent);
        if (rank < 0) {
          let external = this.externalIndexes.get(parent);
          if (external === undefined) {
            external = this.externalParents.length;
            this.externalIndexes.set(parent, external);
            this.externalParents.push(parent);
          }
          rank = -1 - external;
        }
        if (count === 0) {
          scratch[0] = rank;
          count = 1;
          continue;
        }
        if (count === 16 && seen === null)
          seen = new Set(scratch.slice(0, count));
        const existing = seen === null ? scratch.indexOf(rank) : -1;
        if (
          seen === null ? existing < 0 || existing >= count : !seen.has(rank)
        ) {
          scratch[count++] = rank;
          seen?.add(rank);
        }
      }
    } catch (error) {
      for (
        let index = externalStart;
        index < this.externalParents.length;
        index++
      ) {
        this.externalIndexes.delete(this.externalParents[index]!);
      }
      this.externalParents.length = externalStart;
      throw error;
    }
    scratch.length = count;
    const implicit = offset > 0 && count === 1 && scratch[0] === offset - 1;
    if (offset > 0 && !implicit) this.exactChain = false;
    if (!implicit && (offset > 0 || count > 0)) {
      this.explicit.push(offset);
      for (let index = 0; index < count; index++)
        this.parents.push(scratch[index]!);
      this.parentStarts.push(this.parents.length);
    }
  }

  finish(): void {
    this.content = this.texts.join("");
    this.texts.length = 0;
    this.externalIndexes.clear();
  }

  assertValid(): void {
    if (this.duplicate !== null) throw this.duplicate;
  }

  /** Transferable immutable views; no operation columns are copied. */
  packedBase(): PackedEventGraphBase {
    this.assertValid();
    if (this.externalParents.length !== 0) {
      throw new Error("Cannot pack a causal batch with external parents");
    }
    return PackedEventGraphBase.create({
      idIndex: this.ids.view(),
      ...this.operationColumns(),
      insertedContent: this.content,
      runs: GraphRuns.fromExplicitParents(
        this.count,
        this.explicit,
        this.parentStarts,
        this.parents,
      ),
    });
  }

  get insertedContent(): string {
    return this.content;
  }

  operationColumns(): PackedOperationColumns {
    return {
      operationTypes: this.types.subarray(0, this.count),
      operationIndexes: this.indexes.subarray(0, this.count),
      operationLengths: this.lengths.subarray(0, this.count),
      timestamps: this.timestamps.subarray(0, this.count),
      insertStarts: this.insertStarts.subarray(0, this.count),
    };
  }

  get lastId(): EventId {
    return this.lastEventId;
  }
  idAt(offset: number): EventId | undefined {
    return this.ids.idAt(offset);
  }
  isInsertAt(offset: number): boolean {
    return this.types[offset] === 1;
  }
  operationIndexAt(offset: number): number {
    return this.indexes[offset]!;
  }
  operationLengthAt(offset: number): number {
    return this.lengths[offset]!;
  }
  insertStartAt(offset: number): number {
    return this.insertStarts[offset]!;
  }
  timestampAt(offset: number): number {
    return this.timestamps[offset]!;
  }
  sliceInsertedContent(start: number, end: number): string {
    return this.content.slice(start, end);
  }

  operationAt(offset: number): ExternalOperation {
    const index = this.indexes[offset]!;
    const length = this.lengths[offset]!;
    const start = this.insertStarts[offset]!;
    return this.isInsertAt(offset)
      ? {
          type: OPERATION_TYPE.INSERT,
          index,
          text: this.content.slice(start, start + length),
        }
      : { type: OPERATION_TYPE.DELETE, index, length };
  }

  /** Materialize only at object API boundaries and for small warm batches. */
  eventAt(offset: number): GraphEvent {
    let low = 0;
    let high = this.explicit.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.explicit[middle]! < offset) low = middle + 1;
      else high = middle;
    }
    const explicit = this.explicit[low] === offset ? low : -1;
    const parents = new Set<EventId>();
    if (explicit >= 0) {
      for (
        let edge = this.parentStarts[explicit]!;
        edge < this.parentStarts[explicit + 1]!;
        edge++
      ) {
        const rank = this.parents[edge]!;
        parents.add(
          rank < 0 ? this.externalParents[-1 - rank]! : this.idAt(rank)!,
        );
      }
    } else if (offset > 0) {
      parents.add(this.idAt(offset - 1)!);
    }
    return {
      id: this.idAt(offset)!,
      parentVersion: parents,
      operation: this.operationAt(offset),
      timestamp: this.timestampAt(offset),
    };
  }

  private reserve(required: number): void {
    if (required <= this.types.length) return;
    const capacity = Math.max(16, this.types.length * 2, required);
    this.types = grow(this.types, new Uint8Array(capacity));
    this.indexes = grow(
      this.indexes,
      this.indexes instanceof Uint32Array
        ? new Uint32Array(capacity)
        : new Float64Array(capacity),
    );
    this.lengths = grow(
      this.lengths,
      this.lengths instanceof Uint32Array
        ? new Uint32Array(capacity)
        : new Float64Array(capacity),
    );
    this.timestamps = grow(
      this.timestamps,
      this.timestamps instanceof Int32Array
        ? new Int32Array(capacity)
        : new Float64Array(capacity),
    );
    this.insertStarts = grow(this.insertStarts, new Uint32Array(capacity));
  }
}

const grow = <T extends Uint8Array | Uint32Array | Int32Array | Float64Array>(
  source: T,
  target: T,
): T => {
  target.set(source);
  return target;
};
