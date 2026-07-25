import type { EventId } from "../../types";

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
export class RankedDiffVersionsWorkspace {
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

  private run(
    left: ReadonlySet<EventId>,
    right: ReadonlySet<EventId>,
    view: RankedDiffVersionsView,
    onlyInLeft: Set<EventId> | null,
    onlyInRight: Set<EventId> | null,
    retreat: EventId[] | null,
    advanceDescending: EventId[] | null,
  ): void {
    this.visitedRankCount = 0;
    this.ensureCapacity(view.eventCount());
    this.activeView = view;
    this.pendingDivergent = 0;
    this.propagatedColor = DIFF_COLOR.NONE;

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
      for (const rank of this.touchedRanks) {
        this.colors[rank] = DIFF_COLOR.NONE;
      }
      this.touchedRanks.length = 0;
      this.heap.clear();
      this.activeView = null;
      this.pendingDivergent = 0;
      this.propagatedColor = DIFF_COLOR.NONE;
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

/** Max heap whose value is also its topological priority. */
class NumericMaxHeap {
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
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
