/**
 * Integer-label order maintenance using the amortized Dietz-Sleator relabel
 * algorithm. Inserts relabel O(log n) nodes amortized while order queries are
 * a pair of constant-time integer operations.
 *
 * Labels live in a circular arena. The sentinel identifies the logical start
 * of the list and may itself be relabelled; comparing sentinel-relative labels
 * therefore remains valid even when a dense insertion region wraps around the
 * end of the numeric arena.
 */

const LABEL_ARENA_SIZE = 2 ** 52;

/** Intrusive fields avoid allocating a wrapper object for every Fugue marker. */
export interface OrderMaintenanceItem {
  orderLabel: number;
  orderPrevious: OrderMaintenanceItem | null;
  orderNext: OrderMaintenanceItem | null;
  orderGeneration: number;
}

export interface OrderMaintenanceStats {
  readonly insertions: number;
  readonly scans: number;
  readonly relabels: number;
}

export class OrderMaintenanceList<T extends OrderMaintenanceItem> {
  private sentinel: OrderMaintenanceItem = createSentinel();
  private generation = 0;
  private itemCount = 0;
  private insertions = 0;
  private scans = 0;
  private relabels = 0;

  constructor(items: ReadonlyArray<T> = []) {
    this.resetFromItems(items);
  }

  resetFromItems(items: ReadonlyArray<T>): void {
    this.assertCapacity(items.length);
    const seen = new Set<T>();
    for (const item of items) {
      if (seen.has(item)) {
        throw new Error("Order-maintenance item is duplicated");
      }
      seen.add(item);
    }

    this.sentinel = createSentinel();
    this.generation++;
    this.sentinel.orderGeneration = this.generation;
    this.itemCount = 0;
    this.insertions = 0;
    this.scans = 0;
    this.relabels = 0;

    const gap = Math.floor(LABEL_ARENA_SIZE / (items.length + 1));
    let previous = this.sentinel;
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      initializeItem(item, gap * (index + 1), this.generation);
      linkAfter(previous, item);
      previous = item;
      this.itemCount++;
    }
  }

  insertManyBefore(anchor: T, items: ReadonlyArray<T>): boolean {
    if (!this.contains(anchor) || !this.canInsert(items)) {
      return false;
    }
    this.insertRunAfter(anchor.orderPrevious!, items);
    return true;
  }

  insertBefore(anchor: T, item: T): boolean {
    if (!this.contains(anchor) || !this.canInsertOne(item)) {
      return false;
    }
    this.insertAfterNode(anchor.orderPrevious!, item);
    return true;
  }

  insertManyAtStart(items: ReadonlyArray<T>): boolean {
    if (!this.canInsert(items)) {
      return false;
    }
    this.insertRunAfter(this.sentinel, items);
    return true;
  }

  insertAtStart(item: T): boolean {
    if (!this.canInsertOne(item)) {
      return false;
    }
    this.insertAfterNode(this.sentinel, item);
    return true;
  }

  insertManyAtEnd(items: ReadonlyArray<T>): boolean {
    if (!this.canInsert(items)) {
      return false;
    }
    this.insertRunAfter(this.sentinel.orderPrevious!, items);
    return true;
  }

  insertAtEnd(item: T): boolean {
    if (!this.canInsertOne(item)) {
      return false;
    }
    this.insertAfterNode(this.sentinel.orderPrevious!, item);
    return true;
  }

  insertManyAfter(anchor: T, items: ReadonlyArray<T>): boolean {
    if (!this.contains(anchor) || !this.canInsert(items)) {
      return false;
    }
    this.insertRunAfter(anchor, items);
    return true;
  }

  insertAfter(anchor: T, item: T): boolean {
    if (!this.contains(anchor) || !this.canInsertOne(item)) {
      return false;
    }
    this.insertAfterNode(anchor, item);
    return true;
  }

  compare(left: T, right: T): number {
    if (!this.contains(left) || !this.contains(right)) {
      throw new Error("Order-maintenance item is unavailable");
    }
    if (left === right) {
      return 0;
    }
    const leftLabel = this.relativeToSentinel(left.orderLabel);
    const rightLabel = this.relativeToSentinel(right.orderLabel);
    return leftLabel < rightLabel ? -1 : 1;
  }

  isLast(item: T): boolean {
    return this.contains(item) && item.orderNext === this.sentinel;
  }

  toArray(): T[] {
    const result: T[] = [];
    for (
      let current = this.sentinel.orderNext!;
      current !== this.sentinel;
      current = current.orderNext!
    ) {
      result.push(current as T);
    }
    return result;
  }

  getStats(): OrderMaintenanceStats {
    return {
      insertions: this.insertions,
      scans: this.scans,
      relabels: this.relabels,
    };
  }

  getStructuralOperationCount(): number {
    return this.insertions + this.scans + this.relabels;
  }

  restoreStructuralOperationCount(count: number): void {
    this.insertions = count;
    this.scans = 0;
    this.relabels = 0;
  }

  private canInsert(items: ReadonlyArray<T>): boolean {
    const seen = new Set<T>();
    for (const item of items) {
      if (seen.has(item) || this.contains(item)) {
        return false;
      }
      seen.add(item);
    }
    this.assertCapacity(this.itemCount + items.length);
    return true;
  }

  private canInsertOne(item: T): boolean {
    if (this.contains(item)) {
      return false;
    }
    this.assertCapacity(this.itemCount + 1);
    return true;
  }

  private insertRunAfter(
    predecessor: OrderMaintenanceItem,
    items: ReadonlyArray<T>,
  ): void {
    let current = predecessor;
    for (const item of items) {
      current = this.insertAfterNode(current, item);
    }
  }

  private insertAfterNode(predecessor: OrderMaintenanceItem, item: T): T {
    let successor = predecessor.orderNext!;
    let distance = clockwiseDistance(predecessor, successor);
    let coveredNodes = 1;
    this.scans++;
    while (distance <= coveredNodes * coveredNodes) {
      successor = successor.orderNext!;
      coveredNodes++;
      this.scans++;
      if (coveredNodes > this.itemCount + 1) {
        throw new Error("Order-maintenance labels exhausted");
      }
      distance = clockwiseDistance(predecessor, successor);
    }

    const baseGap = Math.floor(distance / coveredNodes);
    const widerGapCount = distance - baseGap * coveredNodes;
    let cumulativeDistance = 0;
    let relabelled = predecessor.orderNext!;
    for (let index = 1; index < coveredNodes; index++) {
      cumulativeDistance += baseGap + (index <= widerGapCount ? 1 : 0);
      relabelled.orderLabel = addLabel(
        predecessor.orderLabel,
        cumulativeDistance,
      );
      relabelled = relabelled.orderNext!;
      this.relabels++;
    }

    const firstGap = baseGap + (widerGapCount > 0 ? 1 : 0);
    initializeItem(
      item,
      addLabel(predecessor.orderLabel, Math.floor(firstGap / 2)),
      this.generation,
    );
    linkAfter(predecessor, item);
    this.itemCount++;
    this.insertions++;
    return item;
  }

  private relativeToSentinel(label: number): number {
    return label >= this.sentinel.orderLabel
      ? label - this.sentinel.orderLabel
      : LABEL_ARENA_SIZE - this.sentinel.orderLabel + label;
  }

  private contains(item: T): boolean {
    return (
      item.orderGeneration === this.generation &&
      item.orderPrevious !== null &&
      item.orderNext !== null
    );
  }

  private assertCapacity(itemCount: number): void {
    const totalNodeCount = itemCount + 1;
    if (totalNodeCount * totalNodeCount >= LABEL_ARENA_SIZE) {
      throw new Error("Order-maintenance capacity exceeded");
    }
  }
}

const createSentinel = (): OrderMaintenanceItem => {
  const sentinel: OrderMaintenanceItem = {
    orderLabel: 0,
    orderPrevious: null,
    orderNext: null,
    orderGeneration: 0,
  };
  sentinel.orderPrevious = sentinel;
  sentinel.orderNext = sentinel;
  return sentinel;
};

const initializeItem = <T extends OrderMaintenanceItem>(
  item: T,
  label: number,
  generation: number,
): void => {
  item.orderLabel = label;
  item.orderPrevious = item;
  item.orderNext = item;
  item.orderGeneration = generation;
};

const linkAfter = (
  predecessor: OrderMaintenanceItem,
  item: OrderMaintenanceItem,
): void => {
  const successor = predecessor.orderNext!;
  item.orderPrevious = predecessor;
  item.orderNext = successor;
  predecessor.orderNext = item;
  successor.orderPrevious = item;
};

const clockwiseDistance = (
  from: OrderMaintenanceItem,
  to: OrderMaintenanceItem,
): number => {
  if (from === to) {
    return LABEL_ARENA_SIZE;
  }
  return to.orderLabel > from.orderLabel
    ? to.orderLabel - from.orderLabel
    : LABEL_ARENA_SIZE - from.orderLabel + to.orderLabel;
};

const addLabel = (label: number, distance: number): number => {
  const distanceToEnd = LABEL_ARENA_SIZE - label;
  return distance >= distanceToEnd
    ? distance - distanceToEnd
    : label + distance;
};
