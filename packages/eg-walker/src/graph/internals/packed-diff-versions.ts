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
 * Ephemeral, allocation-free transition over packed event offsets.
 *
 * Only the prefixes selected by `retreatCount` and `advanceCount` are valid.
 * The arrays and this view are owned by a reusable workspace and are
 * overwritten by its next query. Retreat offsets are in descending replay
 * rank; advance offsets are in ascending replay rank.
 */
export interface PackedOffsetTransition {
  readonly retreatOffsets: Uint32Array;
  readonly retreatCount: number;
  readonly advanceOffsets: Uint32Array;
  readonly advanceCount: number;
}

/**
 * Reusable numeric workspace for Appendix B's version diff.
 *
 * Packed insertion offsets are already a valid topological rank, so the
 * traversal needs neither string-keyed colour maps nor a generic heap with a
 * comparator closure. A caller may supply another topological rank per offset
 * (the branch-preserving replay order) to exactly match its event traversal.
 * Colours live in one byte per packed event; the heap, touched-offset list and
 * transition outputs grow only to the largest divergent region observed by
 * this immutable graph and are reused by subsequent diffs.
 */
export class PackedDiffVersionsWorkspace implements PackedOffsetTransition {
  private readonly colors: Uint8Array;
  private heap: Uint32Array;
  private heapLength = 0;
  private touched: Uint32Array;
  private touchedLength = 0;
  private retreatBuffer: Uint32Array;
  private retreatLength = 0;
  private advanceBuffer: Uint32Array;
  private advanceLength = 0;
  private activeRankByOffset: Uint32Array | null = null;
  private active = false;

  constructor(private readonly eventCount: number) {
    this.colors = new Uint8Array(eventCount);
    const initialCapacity = Math.min(eventCount, INITIAL_WORKSPACE_CAPACITY);
    this.heap = new Uint32Array(initialCapacity);
    this.touched = new Uint32Array(initialCapacity);
    this.retreatBuffer = new Uint32Array(initialCapacity);
    this.advanceBuffer = new Uint32Array(initialCapacity);
  }

  get retreatOffsets(): Uint32Array {
    return this.retreatBuffer;
  }

  get retreatCount(): number {
    return this.retreatLength;
  }

  get advanceOffsets(): Uint32Array {
    return this.advanceBuffer;
  }

  get advanceCount(): number {
    return this.advanceLength;
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

    this.begin(null);
    try {
      let pendingDivergent = this.paintVersion(left, DIFF_COLOR.LEFT, view);
      pendingDivergent += this.paintVersion(right, DIFF_COLOR.RIGHT, view);
      this.collectTransition(pendingDivergent, view);

      const onlyInLeft = new Set<EventId>();
      for (let index = 0; index < this.retreatLength; index++) {
        onlyInLeft.add(this.requireId(view, this.retreatBuffer[index]!));
      }
      // The historical public implementation inserted right-side IDs in
      // descending topological order. The numeric transition exposes advance
      // offsets in ascending order, so iterate it backwards here to preserve
      // the public Set's observable insertion order as well as its contents.
      const onlyInRight = new Set<EventId>();
      for (let index = this.advanceLength - 1; index >= 0; index--) {
        onlyInRight.add(this.requireId(view, this.advanceBuffer[index]!));
      }
      return { onlyInLeft, onlyInRight };
    } finally {
      this.finish();
    }
  }

  /**
   * Diff an ID frontier against the direct parent version of one packed event.
   */
  diffVersionToParents(
    currentVersion: ReadonlySet<EventId>,
    targetEventOffset: number,
    view: PackedDiffVersionsView,
    rankByOffset?: Uint32Array,
  ): PackedOffsetTransition {
    if (this.active) {
      return new PackedDiffVersionsWorkspace(
        this.eventCount,
      ).diffVersionToParents(
        currentVersion,
        targetEventOffset,
        view,
        rankByOffset,
      );
    }

    this.assertEventOffset(targetEventOffset);
    this.begin(rankByOffset ?? null);
    try {
      let pendingDivergent = this.paintVersion(
        currentVersion,
        DIFF_COLOR.LEFT,
        view,
      );
      pendingDivergent += this.paintParents(
        targetEventOffset,
        DIFF_COLOR.RIGHT,
        view,
      );
      this.collectTransition(pendingDivergent, view);
      return this;
    } finally {
      this.finish();
    }
  }

  /**
   * Diff a singleton packed version against one event's direct parent version.
   */
  diffOffsetToParents(
    currentOffset: number,
    targetEventOffset: number,
    view: PackedDiffVersionsView,
    rankByOffset?: Uint32Array,
  ): PackedOffsetTransition {
    if (this.active) {
      return new PackedDiffVersionsWorkspace(
        this.eventCount,
      ).diffOffsetToParents(
        currentOffset,
        targetEventOffset,
        view,
        rankByOffset,
      );
    }

    this.assertEventOffset(currentOffset);
    this.assertEventOffset(targetEventOffset);
    this.begin(rankByOffset ?? null);
    try {
      let pendingDivergent = this.paint(currentOffset, DIFF_COLOR.LEFT);
      pendingDivergent += this.paintParents(
        targetEventOffset,
        DIFF_COLOR.RIGHT,
        view,
      );
      this.collectTransition(pendingDivergent, view);
      return this;
    } finally {
      this.finish();
    }
  }

  private begin(rankByOffset: Uint32Array | null): void {
    if (rankByOffset !== null && rankByOffset.length !== this.eventCount) {
      throw new Error(
        `Packed replay rank length ${rankByOffset.length} does not match event count ${this.eventCount}`,
      );
    }
    this.active = true;
    this.activeRankByOffset = rankByOffset;
    this.retreatLength = 0;
    this.advanceLength = 0;
  }

  private paintVersion(
    version: ReadonlySet<EventId>,
    color: number,
    view: PackedDiffVersionsView,
  ): number {
    let pendingDivergent = 0;
    for (const id of version) {
      const offset = view.offsetOf(id);
      if (offset !== undefined) {
        pendingDivergent += this.paint(offset, color);
      }
    }
    return pendingDivergent;
  }

  private paintParents(
    eventOffset: number,
    color: number,
    view: PackedDiffVersionsView,
  ): number {
    let pendingDivergent = 0;
    const parentCount = view.parentCountAt(eventOffset);
    for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
      const parentOffset = view.parentOffsetAt(eventOffset, parentIndex);
      if (parentOffset === undefined) {
        throw new Error(
          `Packed event ${eventOffset} is missing parent ${parentIndex}`,
        );
      }
      pendingDivergent += this.paint(parentOffset, color);
    }
    return pendingDivergent;
  }

  private collectTransition(
    initialPendingDivergent: number,
    view: PackedDiffVersionsView,
  ): void {
    let pendingDivergent = initialPendingDivergent;
    while (this.heapLength > 0 && pendingDivergent > 0) {
      const offset = this.pop();
      const finalColor = this.colors[offset]!;

      if (finalColor === DIFF_COLOR.LEFT) {
        this.retreatBuffer = this.ensureCapacity(
          this.retreatBuffer,
          this.retreatLength + 1,
        );
        this.retreatBuffer[this.retreatLength++] = offset;
        pendingDivergent--;
      } else if (finalColor === DIFF_COLOR.RIGHT) {
        this.advanceBuffer = this.ensureCapacity(
          this.advanceBuffer,
          this.advanceLength + 1,
        );
        this.advanceBuffer[this.advanceLength++] = offset;
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

    // Right-side offsets were discovered from high to low replay rank. Reverse
    // their populated prefix in place so callers can advance causally from low
    // to high without allocating a sorted copy or a typed-array slice.
    for (
      let left = 0, right = this.advanceLength - 1;
      left < right;
      left++, right--
    ) {
      const value = this.advanceBuffer[left]!;
      this.advanceBuffer[left] = this.advanceBuffer[right]!;
      this.advanceBuffer[right] = value;
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
      if (this.compareReplayRank(parentOffset, offset) >= 0) {
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
        right < this.heapLength &&
        this.compareReplayRank(this.heap[right]!, this.heap[left]!) > 0
          ? right
          : left;
      if (this.compareReplayRank(this.heap[largerChild]!, last) <= 0) {
        break;
      }
      this.heap[index] = this.heap[largerChild]!;
      index = largerChild;
    }
    this.heap[index] = last;
    return top;
  }

  private compareReplayRank(leftOffset: number, rightOffset: number): number {
    const leftRank = this.activeRankByOffset?.[leftOffset] ?? leftOffset;
    const rightRank = this.activeRankByOffset?.[rightOffset] ?? rightOffset;
    return leftRank === rightRank
      ? leftOffset - rightOffset
      : leftRank - rightRank;
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

  private assertEventOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.eventCount) {
      throw new RangeError(`Invalid packed event offset ${offset}`);
    }
  }

  private finish(): void {
    for (let index = 0; index < this.touchedLength; index++) {
      this.colors[this.touched[index]!] = 0;
    }
    this.heapLength = 0;
    this.touchedLength = 0;
    this.activeRankByOffset = null;
    this.active = false;
  }
}
