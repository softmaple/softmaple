import type { EventId } from "../../types";
import type { PackedLocalVersionTransition } from "./packed-diff-versions";

const DIFF_COLOR = {
  NONE: 0,
  LEFT: 1,
  RIGHT: 2,
  COMMON: 3,
} as const;

export interface RankedDiffVersionsView {
  eventCount(): number;
  insertionRankOf(id: EventId): number | undefined;
  eventIdAt(rank: number): EventId | undefined;
  forEachParentRank(rank: number, visit: (parentRank: number) => void): void;
}

/** A ranked view that can also find where an event's causal chain starts. */
export interface RankedRangeDiffView extends RankedDiffVersionsView {
  /**
   * The lowest rank `start <= rank` such that every event in
   * `(start, rank]` has the previous rank as its only parent.
   */
  chainStartOf(rank: number): number;
}

/** A version transition over local versions (insertion ranks). */
export interface LocalVersionTransition {
  /** Child-before-parent order for retreating the left-only suffix. */
  readonly retreat: number[];
  /** Parent-before-child order for advancing the right-only suffix. */
  readonly advance: number[];
}

export interface RankedVersionTransition {
  /** Child-before-parent order for retreating the left-only suffix. */
  readonly retreat: EventId[];
  /** Parent-before-child order for advancing the right-only suffix. */
  readonly advance: EventId[];
}

/**
 * Reusable numeric workspace for object-backed version diffs.
 *
 * EventGraph insertion ranks are a dense topological index. Storing paint
 * colours and heap entries by rank avoids the string-keyed colour Map plus
 * repeated `hasEvent`/rank lookups in the generic graph diff. Only touched
 * colour slots are cleared, so a small divergent suffix remains proportional
 * to that suffix even after a long history.
 */
export class RankedDiffVersionsWorkspace
  implements PackedLocalVersionTransition
{
  private colors = new Uint8Array(0);
  private readonly touchedRanks: number[] = [];
  private readonly heap = new NumericMaxHeap();
  private visitedRankCount = 0;
  private activeView: RankedDiffVersionsView | null = null;
  private pendingDivergent = 0;
  private propagatedColor: number = DIFF_COLOR.NONE;
  private readonly paintParentRank = (parentRank: number): void => {
    this.paintRank(parentRank, this.propagatedColor);
  };

  retreatStarts: Uint32Array = new Uint32Array(16);
  retreatEnds: Uint32Array = new Uint32Array(16);
  retreatRangeCount = 0;
  retreatEventCount = 0;
  advanceStarts: Uint32Array = new Uint32Array(16);
  advanceEnds: Uint32Array = new Uint32Array(16);
  advanceRangeCount = 0;
  advanceEventCount = 0;

  get lastVisitedRankCount(): number {
    return this.visitedRankCount;
  }

  release(): void {
    this.colors = new Uint8Array(0);
    this.touchedRanks.length = 0;
    this.heap.clear();
    this.activeView = null;
    this.pendingDivergent = 0;
    this.propagatedColor = DIFF_COLOR.NONE;
  }

  diff(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
    view: RankedDiffVersionsView,
  ): {
    readonly onlyInLeft: Set<EventId>;
    readonly onlyInRight: Set<EventId>;
  } {
    const onlyInLeft = new Set<EventId>();
    const onlyInRight = new Set<EventId>();
    this.run(left, right, view, onlyInLeft, onlyInRight, null, null);
    return { onlyInLeft, onlyInRight };
  }

  /**
   * Return the same diff directly in insertion-topological transition order.
   *
   * This avoids allocating two string Sets only for the replay engine to
   * iterate, rank, and sort them immediately afterward.
   */
  diffOrdered(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
    view: RankedDiffVersionsView,
  ): RankedVersionTransition {
    const retreat: EventId[] = [];
    const advanceDescending: EventId[] = [];
    this.run(left, right, view, null, null, retreat, advanceDescending);
    advanceDescending.reverse();
    return { retreat, advance: advanceDescending };
  }

  /**
   * Return the diff of two versions given as local versions, as local
   * versions in insertion-topological transition order. No ID is parsed or
   * formatted.
   */
  diffLocalVersions(
    left: ReadonlyArray<number>,
    right: ReadonlyArray<number>,
    view: RankedDiffVersionsView,
  ): LocalVersionTransition {
    const retreat: number[] = [];
    const advance: number[] = [];
    this.begin(view);
    try {
      for (const rank of left) {
        this.paintRank(rank, DIFF_COLOR.LEFT);
      }
      for (const rank of right) {
        this.paintRank(rank, DIFF_COLOR.RIGHT);
      }
      while (this.heap.size > 0 && this.pendingDivergent > 0) {
        const rank = this.heap.pop()!;
        this.visitedRankCount++;
        const finalColor = this.colors[rank] ?? DIFF_COLOR.NONE;
        if (finalColor === DIFF_COLOR.LEFT) {
          retreat.push(rank);
          this.pendingDivergent--;
        } else if (finalColor === DIFF_COLOR.RIGHT) {
          advance.push(rank);
          this.pendingDivergent--;
        }
        this.propagatedColor = finalColor;
        view.forEachParentRank(rank, this.paintParentRank);
      }
    } finally {
      this.end();
    }
    advance.reverse();
    return { retreat, advance };
  }

  /**
   * Return the diff of two versions given as local versions, as ranges of
   * local versions: retreat ranges expand from `end - 1` down to `start`, in
   * order, and advance ranges from `start` up to `end - 1`, in order. The
   * result is this workspace, overwritten by its next diff.
   *
   * The walk visits causal chains rather than events, as the packed diff
   * walks runs: it pops the highest queued event, absorbs the other queued
   * events of its chain, emits the chain's coloured spans and queues the
   * parents of the chain's first event. A transition across a long branch
   * costs one heap step per chain, not one per event.
   */
  diffLocalVersionRanges(
    left: ReadonlyArray<number>,
    right: ReadonlyArray<number>,
    view: RankedRangeDiffView,
  ): PackedLocalVersionTransition {
    this.begin(view);
    this.retreatRangeCount = 0;
    this.retreatEventCount = 0;
    this.advanceRangeCount = 0;
    this.advanceEventCount = 0;
    try {
      for (const rank of left) {
        this.paintRank(rank, DIFF_COLOR.LEFT);
      }
      for (const rank of right) {
        this.paintRank(rank, DIFF_COLOR.RIGHT);
      }
      const heap = this.heap;
      while (heap.size > 0 && this.pendingDivergent > 0) {
        let top = heap.pop()!;
        let color = this.colors[top]!;
        if (color !== DIFF_COLOR.COMMON) {
          this.pendingDivergent--;
        }
        const start = view.chainStartOf(top);
        this.visitedRankCount++;
        while (heap.size > 0 && heap.peek()! >= start) {
          const next = heap.pop()!;
          this.emitRankSpan(next + 1, top + 1, color);
          const nextColor = this.colors[next]!;
          if (nextColor !== DIFF_COLOR.COMMON) {
            this.pendingDivergent--;
          }
          color |= nextColor;
          top = next;
        }
        this.emitRankSpan(start, top + 1, color);
        if (this.pendingDivergent === 0 && color === DIFF_COLOR.COMMON) {
          break;
        }
        this.propagatedColor = color;
        view.forEachParentRank(start, this.paintParentRank);
      }
    } finally {
      this.end();
    }
    // Spans arrive in descending local version; advance in ascending order.
    for (
      let low = 0, high = this.advanceRangeCount - 1;
      low < high;
      low++, high--
    ) {
      const start = this.advanceStarts[low]!;
      const end = this.advanceEnds[low]!;
      this.advanceStarts[low] = this.advanceStarts[high]!;
      this.advanceEnds[low] = this.advanceEnds[high]!;
      this.advanceStarts[high] = start;
      this.advanceEnds[high] = end;
    }
    return this;
  }

  /** Record ranks `[start, end)`, visited in descending order, by colour. */
  private emitRankSpan(start: number, end: number, color: number): void {
    if (start >= end || color === DIFF_COLOR.COMMON) {
      return;
    }
    if (color === DIFF_COLOR.LEFT) {
      this.retreatEventCount += end - start;
      const previous = this.retreatRangeCount - 1;
      if (previous >= 0 && end === this.retreatStarts[previous]) {
        this.retreatStarts[previous] = start;
        return;
      }
      if (this.retreatRangeCount === this.retreatStarts.length) {
        this.retreatStarts = grownRanges(this.retreatStarts);
        this.retreatEnds = grownRanges(this.retreatEnds);
      }
      this.retreatStarts[this.retreatRangeCount] = start;
      this.retreatEnds[this.retreatRangeCount] = end;
      this.retreatRangeCount++;
      return;
    }
    this.advanceEventCount += end - start;
    const previous = this.advanceRangeCount - 1;
    if (previous >= 0 && end === this.advanceStarts[previous]) {
      this.advanceStarts[previous] = start;
      return;
    }
    if (this.advanceRangeCount === this.advanceStarts.length) {
      this.advanceStarts = grownRanges(this.advanceStarts);
      this.advanceEnds = grownRanges(this.advanceEnds);
    }
    this.advanceStarts[this.advanceRangeCount] = start;
    this.advanceEnds[this.advanceRangeCount] = end;
    this.advanceRangeCount++;
  }

  private begin(view: RankedDiffVersionsView): void {
    this.visitedRankCount = 0;
    this.ensureCapacity(view.eventCount());
    this.activeView = view;
    this.pendingDivergent = 0;
    this.propagatedColor = DIFF_COLOR.NONE;
  }

  private end(): void {
    for (const rank of this.touchedRanks) {
      this.colors[rank] = DIFF_COLOR.NONE;
    }
    this.touchedRanks.length = 0;
    this.heap.clear();
    this.activeView = null;
    this.pendingDivergent = 0;
    this.propagatedColor = DIFF_COLOR.NONE;
  }

  private run(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
    view: RankedDiffVersionsView,
    onlyInLeft: Set<EventId> | null,
    onlyInRight: Set<EventId> | null,
    retreat: EventId[] | null,
    advanceDescending: EventId[] | null,
  ): void {
    this.begin(view);

    try {
      this.paintVersion(left, DIFF_COLOR.LEFT);
      this.paintVersion(right, DIFF_COLOR.RIGHT);

      while (this.heap.size > 0 && this.pendingDivergent > 0) {
        const rank = this.heap.pop()!;
        this.visitedRankCount++;
        const finalColor = this.colors[rank] ?? DIFF_COLOR.NONE;
        const id = view.eventIdAt(rank);
        if (id === undefined) {
          throw new Error(`Event graph is missing insertion rank ${rank}`);
        }

        if (finalColor === DIFF_COLOR.LEFT) {
          onlyInLeft?.add(id);
          retreat?.push(id);
          this.pendingDivergent--;
        } else if (finalColor === DIFF_COLOR.RIGHT) {
          onlyInRight?.add(id);
          advanceDescending?.push(id);
          this.pendingDivergent--;
        }

        this.propagatedColor = finalColor;
        view.forEachParentRank(rank, this.paintParentRank);
      }
    } finally {
      this.end();
    }
  }

  private paintVersion(version: ReadonlySet<EventId>, color: number): void {
    const view = this.activeView;
    if (view === null) {
      throw new Error("Ranked diff workspace is not active");
    }
    for (const id of version) {
      const rank = view.insertionRankOf(id);
      if (rank !== undefined) {
        this.paintRank(rank, color);
      }
    }
  }

  private paintRank(rank: number, addedColor: number): void {
    const existing = this.colors[rank] ?? DIFF_COLOR.NONE;
    const merged = existing | addedColor;
    if (merged === existing) {
      return;
    }
    this.colors[rank] = merged;
    if (existing === DIFF_COLOR.NONE) {
      this.touchedRanks.push(rank);
      this.heap.push(rank);
      if (merged !== DIFF_COLOR.COMMON) {
        this.pendingDivergent++;
      }
    } else if (existing !== DIFF_COLOR.COMMON && merged === DIFF_COLOR.COMMON) {
      this.pendingDivergent--;
    }
  }

  private ensureCapacity(eventCount: number): void {
    if (this.colors.length >= eventCount) {
      return;
    }
    let capacity = Math.max(16, this.colors.length);
    while (capacity < eventCount) {
      capacity *= 2;
    }
    this.colors = new Uint8Array(capacity);
  }
}

const grownRanges = (ranges: Uint32Array): Uint32Array => {
  const grown = new Uint32Array(ranges.length * 2);
  grown.set(ranges);
  return grown;
};

/** Max heap whose value is also its topological priority. */
class NumericMaxHeap {
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): number | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items.length = 0;
  }

  push(value: number): void {
    const items = this.items;
    let index = items.length;
    items.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentValue = items[parent]!;
      if (value <= parentValue) {
        break;
      }
      items[index] = parentValue;
      index = parent;
    }
    items[index] = value;
  }

  pop(): number | undefined {
    const items = this.items;
    if (items.length === 0) {
      return undefined;
    }
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length === 0) {
      return top;
    }

    let index = 0;
    const length = items.length;
    while (true) {
      const left = index * 2 + 1;
      if (left >= length) {
        break;
      }
      const right = left + 1;
      let child = left;
      if (right < length && items[right]! > items[left]!) {
        child = right;
      }
      const childValue = items[child]!;
      if (childValue <= last) {
        break;
      }
      items[index] = childValue;
      index = child;
    }
    items[index] = last;
    return top;
  }
}
