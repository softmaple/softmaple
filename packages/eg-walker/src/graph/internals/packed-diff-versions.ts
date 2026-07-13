import type { EventId } from "../../types";

const DIFF_COLOR = {
  LEFT: 1,
  RIGHT: 2,
  COMMON: 3,
} as const;

const INITIAL_WORKSPACE_CAPACITY = 64;

export interface PackedDiffVersionsView {
  readonly count: number;
  offsetOf(id: EventId): number | undefined;
  idAt(offset: number): EventId | undefined;
  parentCountAt(offset: number): number;
  parentOffsetAt(offset: number, parentIndex: number): number | undefined;
}

export interface PackedVersionDiff {
  readonly onlyInLeft: Set<EventId>;
  readonly onlyInRight: Set<EventId>;
}

/**
 * Reusable numeric workspace for Appendix B's version diff.
 *
 * Packed insertion offsets are already a valid topological rank, so the
 * traversal needs neither string-keyed colour maps nor a generic heap with a
 * comparator closure. Colours live in one byte per packed event; the heap and
 * touched-offset list grow only to the largest divergent region observed by
 * this immutable graph and are reused by subsequent diffs.
 */
export class PackedDiffVersionsWorkspace {
  private readonly colors: Uint8Array;
  private heap: Uint32Array;
  private heapLength = 0;
  private touched: Uint32Array;
  private touchedLength = 0;
  private active = false;

  constructor(private readonly eventCount: number) {
    this.colors = new Uint8Array(eventCount);
    const initialCapacity = Math.min(eventCount, INITIAL_WORKSPACE_CAPACITY);
    this.heap = new Uint32Array(initialCapacity);
    this.touched = new Uint32Array(initialCapacity);
  }

  diff(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
    view: PackedDiffVersionsView,
  ): PackedVersionDiff {
    // Public callers can supply custom Set subclasses whose iterator invokes
    // diffVersions recursively. Keep the common path allocation-light while
    // preserving correctness for that unusual re-entrant case.
    if (this.active) {
      return new PackedDiffVersionsWorkspace(this.eventCount).diff(
        left,
        right,
        view,
      );
    }

    this.active = true;
    const onlyInLeft = new Set<EventId>();
    const onlyInRight = new Set<EventId>();
    let pendingDivergent = 0;

    try {
      for (const id of left) {
        const offset = view.offsetOf(id);
        if (offset !== undefined) {
          pendingDivergent += this.paint(offset, DIFF_COLOR.LEFT);
        }
      }
      for (const id of right) {
        const offset = view.offsetOf(id);
        if (offset !== undefined) {
          pendingDivergent += this.paint(offset, DIFF_COLOR.RIGHT);
        }
      }

      while (this.heapLength > 0 && pendingDivergent > 0) {
        const offset = this.pop();
        const finalColor = this.colors[offset]!;

        if (finalColor === DIFF_COLOR.LEFT) {
          onlyInLeft.add(this.requireId(view, offset));
          pendingDivergent--;
        } else if (finalColor === DIFF_COLOR.RIGHT) {
          onlyInRight.add(this.requireId(view, offset));
          pendingDivergent--;
        }

        const parentCount = view.parentCountAt(offset);
        for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
          const parentOffset = view.parentOffsetAt(offset, parentIndex);
          if (parentOffset === undefined) {
            throw new Error(
              `Packed event ${offset} is missing parent ${parentIndex}`,
            );
          }
          pendingDivergent += this.paint(parentOffset, finalColor);
        }
      }

      return { onlyInLeft, onlyInRight };
    } finally {
      this.reset();
      this.active = false;
    }
  }

  /**
   * Merge one colour and return its contribution to pendingDivergent.
   * A positive result represents a newly queued one-sided event; -1 means a
   * queued event has just become common.
   */
  private paint(offset: number, addedColor: number): number {
    const existing = this.colors[offset]!;
    const merged = existing | addedColor;
    if (merged === existing) {
      return 0;
    }

    this.colors[offset] = merged;
    if (existing === 0) {
      this.recordTouched(offset);
      this.push(offset);
      return merged === DIFF_COLOR.COMMON ? 0 : 1;
    }
    return merged === DIFF_COLOR.COMMON ? -1 : 0;
  }

  private push(offset: number): void {
    this.heap = this.ensureCapacity(this.heap, this.heapLength + 1);
    let index = this.heapLength++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentOffset = this.heap[parent]!;
      if (parentOffset >= offset) {
        break;
      }
      this.heap[index] = parentOffset;
      index = parent;
    }
    this.heap[index] = offset;
  }

  private pop(): number {
    const top = this.heap[0]!;
    const last = this.heap[--this.heapLength]!;
    if (this.heapLength === 0) {
      return top;
    }

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.heapLength) {
        break;
      }
      const right = left + 1;
      const largerChild =
        right < this.heapLength && this.heap[right]! > this.heap[left]!
          ? right
          : left;
      if (this.heap[largerChild]! <= last) {
        break;
      }
      this.heap[index] = this.heap[largerChild]!;
      index = largerChild;
    }
    this.heap[index] = last;
    return top;
  }

  private recordTouched(offset: number): void {
    this.touched = this.ensureCapacity(this.touched, this.touchedLength + 1);
    this.touched[this.touchedLength++] = offset;
  }

  private ensureCapacity(current: Uint32Array, required: number): Uint32Array {
    if (required <= current.length) {
      return current;
    }
    if (required > this.eventCount) {
      throw new Error("Packed diff workspace exceeded the event count");
    }

    let capacity = Math.max(1, current.length);
    while (capacity < required) {
      capacity = Math.min(this.eventCount, capacity * 2);
    }
    const grown = new Uint32Array(capacity);
    grown.set(current);
    return grown;
  }

  private requireId(view: PackedDiffVersionsView, offset: number): EventId {
    const id = view.idAt(offset);
    if (id === undefined) {
      throw new Error(`Packed graph is missing event ${offset}`);
    }
    return id;
  }

  private reset(): void {
    for (let index = 0; index < this.touchedLength; index++) {
      this.colors[this.touched[index]!] = 0;
    }
    this.heapLength = 0;
    this.touchedLength = 0;
  }
}
