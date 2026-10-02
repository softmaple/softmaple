import {
  ANCHOR_WEIGHT,
  BRANCH_FACTOR,
  EFFECT_WEIGHT,
  LEAF_CAPACITY,
  PREPARE_WEIGHT,
  WEIGHT_STRIDE,
  createInternal,
  createLeaf,
  type IndexedNode,
  type IndexedSequenceItem,
  type InternalNode,
  type LeafNode,
  type SequenceTree,
} from "./internals/indexed-sequence-node";
import { OrderMaintenanceList } from "./internals/order-maintenance-list";

export type { IndexedSequenceItem } from "./internals/indexed-sequence-node";

/**
 * Sentinel thrown by the ranked B-tree's prepare/effect index lookups when
 * the requested index falls outside the visible weight range. Distinct from
 * a generic `Error` so callers like {@link IndexedSequence.tryPrepareIndexToPositionAndOffset}
 * can catch *only* the legitimate "ran past the end" case and re-raise any
 * structural-invariant violation (e.g. an inconsistent aggregate sum) that
 * the same code path would surface as an opaque `Error`.
 */
export class IndexOutOfRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexOutOfRangeError";
  }
}

type WeightKind = "prepare" | "effect" | "anchor";

type WeightOffsetResolver<T> = (
  item: T,
  visibleOffset: number,
  kind: WeightKind,
) => number;

/**
 * Ranked B-tree for Eg-walker's mutable CRDT sequence.
 *
 * Each leaf stores a cache-sized run of CRDT items and each internal edge keeps
 * three ranks: record count, prepare-visible count, and effect-visible count.
 * This mirrors the paper's B-tree indexes. Each item records the leaf that
 * holds it ({@link IndexedSequenceItem}), so an object-anchored operation
 * starts at that leaf after the caller resolves the event ID to a record.
 *
 * An item belongs to at most one live sequence. Inserting an item that a live
 * sequence holds throws, except that `insertAfter` and `updateAndInsertAfter`
 * return `false` for an item this sequence holds. Clearing a sequence
 * releases its items.
 *
 * The hot maintenance paths — single-item inserts, weight updates, and
 * `positionOf` lookups — all run in O(log n):
 *   - Inserts and weight updates propagate `(size, prepareSum, effectSum)`
 *     deltas to ancestors instead of recomputing every internal node's
 *     sums from its children.
 *   - Each item records its leaf and its offset is found by scanning that
 *     leaf, at most 32 slots, so an insert shifts the slots after it
 *     without touching the shifted items. Each node caches its index
 *     inside its parent, so `positionOfNode` skips the inner
 *     `Array.indexOf` scans.
 *   - Splits do not propagate deltas at all: the moved subtree's weight
 *     leaves one parent edge and joins another, so the grandparent sums
 *     are unchanged by construction.
 */
export class IndexedSequence<T extends IndexedSequenceItem<T>> {
  private root: IndexedNode<T> | null = null;
  private tree: SequenceTree = { live: true };
  private readonly leafOrder = new OrderMaintenanceList<LeafNode<T>>();
  private structuralOperationCount = 0;
  private weightUpdateGeneration = 0;
  private weightUpdateActive = false;
  private readonly weightUpdateLevelA: IndexedNode<T>[] = [];
  private readonly weightUpdateLevelB: IndexedNode<T>[] = [];

  /**
   * Build a ranked sequence from an already ordered record list in linear time.
   *
   * Snapshot restore should use this entry point once serialized sequence
   * records are available: it preserves the same public behavior as passing
   * `items` to the constructor while making the bulk-restore intent explicit.
   */
  static fromRecords<T extends IndexedSequenceItem<T>>(
    records: ReadonlyArray<T>,
    prepareWeight: (item: T) => number,
    effectWeight: (item: T) => number,
    anchorWeight?: (item: T) => number,
    maintainOrder: boolean = false,
    weightOffsetResolver?: WeightOffsetResolver<T>,
  ): IndexedSequence<T> {
    return new IndexedSequence(
      prepareWeight,
      effectWeight,
      records,
      anchorWeight,
      maintainOrder,
      weightOffsetResolver,
    );
  }

  constructor(
    private readonly prepareWeight: (item: T) => number,
    private readonly effectWeight: (item: T) => number,
    items: ReadonlyArray<T> = [],
    private readonly anchorWeight: (item: T) => number = (item) =>
      prepareWeight(item) > 0 ? 1 : 0,
    private readonly maintainOrder: boolean = false,
    private readonly weightOffsetResolver: WeightOffsetResolver<T> = (
      _item,
      visibleOffset,
    ) => visibleOffset,
  ) {
    if (items.length > 0) {
      this.bulkLoad(items);
    }
  }

  get length(): number {
    return this.root?.size ?? 0;
  }

  /** UTF-16 width visible in the engine's current prepare view. */
  get prepareLength(): number {
    return this.root?.prepareSum ?? 0;
  }

  getStructuralOperationCount(): number {
    return (
      this.structuralOperationCount +
      (this.maintainOrder ? this.leafOrder.getStructuralOperationCount() : 0)
    );
  }

  restoreStructuralOperationCount(count: number): void {
    this.structuralOperationCount = count;
    if (this.maintainOrder) {
      this.leafOrder.restoreStructuralOperationCount(0);
    }
  }

  toArray(): T[] {
    const items: T[] = [];
    this.forEach((item) => items.push(item));
    return items;
  }

  /** Visit resident records in sequence order without allocating an array. */
  forEach(visitor: (item: T) => void): void {
    if (this.root) {
      this.visit(this.root, visitor);
    }
  }

  at(index: number): T | undefined {
    if (!this.root || index < 0 || index >= this.root.size) {
      return undefined;
    }

    const { leaf, offset } = this.findLeafByRecordIndex(index);
    return leaf.items[offset];
  }

  slice(start: number): T[] {
    return this.toArray().slice(start);
  }

  indexOf(predicate: (item: T) => boolean): number {
    let index = 0;
    let found = -1;
    if (!this.root) {
      return found;
    }

    this.visit(this.root, (item) => {
      if (found === -1 && predicate(item)) {
        found = index;
      }
      index++;
    });
    return found;
  }

  positionOf(item: T): number {
    const leaf = this.leafOf(item);
    if (leaf === null) {
      return -1;
    }
    return this.positionOfNode(leaf) + this.offsetInLeaf(leaf, item);
  }

  /** Compare two resident items by sequence order without a rank walk. */
  compareOrder(left: T, right: T): number {
    if (!this.maintainOrder) {
      throw new Error("Indexed sequence order tracking is disabled");
    }
    if (left === right) {
      return 0;
    }
    const leftLeaf = this.leafOf(left);
    const rightLeaf = this.leafOf(right);
    if (leftLeaf === null || rightLeaf === null) {
      throw new Error("Indexed sequence item is unavailable");
    }
    if (leftLeaf === rightLeaf) {
      return this.offsetInLeaf(leftLeaf, left) <
        this.offsetInLeaf(rightLeaf, right)
        ? -1
        : 1;
    }
    return this.leafOrder.compare(leftLeaf, rightLeaf);
  }

  /**
   * Return whether `right` immediately follows `left` in sequence order.
   *
   * Leaf-order tracking makes the cross-leaf case a constant-time neighbour
   * check. Within one leaf, the slot after `left` is sufficient. As with
   * {@link compareOrder}, callers must opt into order tracking when creating
   * the sequence.
   */
  areAdjacent(left: T, right: T): boolean {
    if (!this.maintainOrder) {
      throw new Error("Indexed sequence order tracking is disabled");
    }
    if (left === right) {
      return false;
    }

    const leftLeaf = this.leafOf(left);
    const rightLeaf = this.leafOf(right);
    if (leftLeaf === null || rightLeaf === null) {
      return false;
    }
    if (leftLeaf === rightLeaf) {
      return leftLeaf.items[this.offsetInLeaf(leftLeaf, left) + 1] === right;
    }
    return (
      leftLeaf.items[leftLeaf.items.length - 1] === left &&
      rightLeaf.items[0] === right &&
      leftLeaf.orderNext === rightLeaf
    );
  }

  /** Return whether `item` is the final record without computing its rank. */
  isLast(item: T): boolean {
    const leaf = this.leafOf(item);
    if (leaf === null || leaf.items[leaf.items.length - 1] !== item) {
      return false;
    }
    if (this.maintainOrder) {
      return this.leafOrder.isLast(leaf);
    }
    return this.findRightmostLeaf().leaf === leaf;
  }

  /**
   * Effect-visible UTF-16 width before `item`.
   *
   * Unlike `positionOf(item)` followed by `effectIndexBeforePosition`, this
   * starts at the cached leaf location and accumulates effect weights while
   * walking upward once. Fugue and document-splice lookups use this combined
   * query heavily during concurrent replay.
   */
  effectIndexOf(item: T): number {
    const leaf = this.leafOf(item);
    if (leaf === null) {
      return -1;
    }

    const offsetInLeaf = this.offsetInLeaf(leaf, item);
    const weights = leaf.weights;
    let effectIndex = 0;
    for (let offset = 0; offset < offsetInLeaf; offset++) {
      this.structuralOperationCount++;
      effectIndex += weights[offset * WEIGHT_STRIDE + EFFECT_WEIGHT] ?? 0;
    }

    let current: IndexedNode<T> = leaf;
    while (current.parent) {
      this.structuralOperationCount++;
      const parent: InternalNode<T> = current.parent;
      for (let index = 0; index < current.childIndex; index++) {
        this.structuralOperationCount++;
        effectIndex += parent.children[index]?.effectSum ?? 0;
      }
      current = parent;
    }
    return effectIndex;
  }

  /**
   * Prepare-view boundary immediately after a known item.
   *
   * Packed replay uses this once per candidate span to prove that extending a
   * middle-position typed run lands at the same boundary as scalar replay.
   * The query follows the item's cached leaf location and ancestor weights,
   * so it is O(log n) and does not materialize sequence positions.
   */
  prepareIndexAfter(item: T): number {
    const leaf = this.leafOf(item);
    if (leaf === null) {
      return -1;
    }

    const offsetInLeaf = this.offsetInLeaf(leaf, item);
    const weights = leaf.weights;
    let prepareIndex = 0;
    for (let offset = 0; offset <= offsetInLeaf; offset++) {
      this.structuralOperationCount++;
      prepareIndex += weights[offset * WEIGHT_STRIDE + PREPARE_WEIGHT] ?? 0;
    }

    let current: IndexedNode<T> = leaf;
    while (current.parent) {
      this.structuralOperationCount++;
      const parent: InternalNode<T> = current.parent;
      for (let index = 0; index < current.childIndex; index++) {
        this.structuralOperationCount++;
        prepareIndex += parent.children[index]?.prepareSum ?? 0;
      }
      current = parent;
    }
    return prepareIndex;
  }

  clear(): void {
    if (this.weightUpdateActive) {
      throw new Error("Cannot clear IndexedSequence during a batch update");
    }
    this.root = null;
    // Retire the old tree: its items stop resolving here and may join
    // another sequence.
    this.tree.live = false;
    this.tree = { live: true };
    if (this.maintainOrder) {
      this.leafOrder.resetFromItems([]);
    }
    this.weightUpdateGeneration = 0;
    this.weightUpdateLevelA.length = 0;
    this.weightUpdateLevelB.length = 0;
    this.structuralOperationCount = 0;
  }

  resetFromRecords(records: ReadonlyArray<T>): void {
    this.clear();
    if (records.length > 0) {
      this.bulkLoad(records);
    }
  }

  insert(index: number, item: T): void {
    this.structuralOperationCount++;
    if (index < 0 || index > this.length) {
      throw new Error(`Insert index ${index} out of bounds`);
    }

    if (!this.root) {
      // Fill the leaf before it becomes the root, so that a rejected item
      // leaves the sequence empty. One item cannot split it.
      const leaf = createLeaf<T>(this.tree);
      this.insertIntoLeaf(leaf, 0, item);
      if (this.maintainOrder) {
        this.leafOrder.resetFromItems([leaf]);
      }
      this.root = leaf;
      return;
    }

    const { leaf, offset } =
      index === this.length
        ? this.findRightmostLeaf()
        : this.findLeafByRecordIndex(index);
    this.insertIntoLeaf(leaf, offset, item);
  }

  /** Insert a small contiguous run with one tree lookup and aggregate walk. */
  insertMany(index: number, items: ReadonlyArray<T>): void {
    if (index < 0 || index > this.length) {
      throw new Error(`Insert index ${index} out of bounds`);
    }
    if (items.length === 0) {
      return;
    }
    // The optimized path is intentionally leaf-sized. Larger caller batches
    // retain the exact single-insert semantics while Fugue's hot marker runs
    // (two or three items) use one splice and one ancestor propagation.
    if (items.length > LEAF_CAPACITY) {
      for (let offset = 0; offset < items.length; offset++) {
        this.insert(index + offset, items[offset]!);
      }
      return;
    }

    this.structuralOperationCount++;
    if (!this.root) {
      // At most LEAF_CAPACITY items cannot split the leaf; see `insert`.
      const leaf = createLeaf<T>(this.tree);
      this.insertManyIntoLeaf(leaf, 0, items);
      if (this.maintainOrder) {
        this.leafOrder.resetFromItems([leaf]);
      }
      this.root = leaf;
      return;
    }

    const landing =
      index === this.length
        ? this.findRightmostLeaf()
        : this.findLeafByRecordIndex(index);
    this.insertManyIntoLeaf(landing.leaf, landing.offset, items);
  }

  /** Insert one item immediately after a known object without a rank lookup. */
  insertAfter(anchor: T, item: T): boolean {
    const leaf = this.leafOf(anchor);
    if (leaf === null || this.leafOf(item) !== null) {
      return false;
    }

    this.structuralOperationCount++;
    this.insertIntoLeaf(leaf, this.offsetInLeaf(leaf, anchor) + 1, item);
    return true;
  }

  /** Insert a small run immediately before a known object without rank lookup. */
  insertManyBefore(anchor: T, items: ReadonlyArray<T>): boolean {
    return this.insertManyAtAnchor(anchor, items, false);
  }

  /** Insert a small run immediately after a known object without rank lookup. */
  insertManyAfter(anchor: T, items: ReadonlyArray<T>): boolean {
    return this.insertManyAtAnchor(anchor, items, true);
  }

  push(item: T): void {
    this.insert(this.length, item);
  }

  updateItem(item: T): void {
    this.structuralOperationCount++;
    const leaf = this.leafOf(item);
    if (leaf === null) {
      return;
    }

    const weights = leaf.weights;
    const base = this.offsetInLeaf(leaf, item) * WEIGHT_STRIDE;
    const oldPrepare = weights[base + PREPARE_WEIGHT] ?? 0;
    const oldEffect = weights[base + EFFECT_WEIGHT] ?? 0;
    const oldAnchor = weights[base + ANCHOR_WEIGHT] ?? 0;
    const newPrepare = this.prepareWeight(item);
    const newEffect = this.effectWeight(item);
    const newAnchor = this.anchorWeight(item);
    const prepareDelta = newPrepare - oldPrepare;
    const effectDelta = newEffect - oldEffect;
    const anchorDelta = newAnchor - oldAnchor;
    if (prepareDelta === 0 && effectDelta === 0 && anchorDelta === 0) {
      return;
    }

    weights[base + PREPARE_WEIGHT] = newPrepare;
    weights[base + EFFECT_WEIGHT] = newEffect;
    weights[base + ANCHOR_WEIGHT] = newAnchor;
    this.propagateDelta(leaf, 0, prepareDelta, effectDelta, anchorDelta);
  }

  /**
   * Refresh several mutated items while aggregating shared ancestor work.
   *
   * Callers may yield the same item more than once; after the first refresh
   * its cached weights already match, so later visits contribute zero. Leaf
   * deltas are combined first, then propagated bottom-up once per touched
   * internal node instead of once per event.
   */
  updateItems(items: Iterable<T>): void {
    if (this.weightUpdateActive) {
      throw new Error("Cannot update IndexedSequence reentrantly");
    }

    this.weightUpdateActive = true;
    try {
      this.updateItemsWithScratch(items);
    } finally {
      this.weightUpdateLevelA.length = 0;
      this.weightUpdateLevelB.length = 0;
      this.weightUpdateActive = false;
    }
  }

  private updateItemsWithScratch(items: Iterable<T>): void {
    const generation = this.nextWeightUpdateGeneration();
    let current = this.weightUpdateLevelA;
    let next = this.weightUpdateLevelB;
    for (const item of items) {
      this.structuralOperationCount++;
      const leaf = this.leafOf(item);
      if (leaf === null) {
        continue;
      }

      const weights = leaf.weights;
      const base = this.offsetInLeaf(leaf, item) * WEIGHT_STRIDE;
      const oldPrepare = weights[base + PREPARE_WEIGHT] ?? 0;
      const oldEffect = weights[base + EFFECT_WEIGHT] ?? 0;
      const oldAnchor = weights[base + ANCHOR_WEIGHT] ?? 0;
      const newPrepare = this.prepareWeight(item);
      const newEffect = this.effectWeight(item);
      const newAnchor = this.anchorWeight(item);
      const prepareDelta = newPrepare - oldPrepare;
      const effectDelta = newEffect - oldEffect;
      const anchorDelta = newAnchor - oldAnchor;
      if (prepareDelta === 0 && effectDelta === 0 && anchorDelta === 0) {
        continue;
      }

      weights[base + PREPARE_WEIGHT] = newPrepare;
      weights[base + EFFECT_WEIGHT] = newEffect;
      weights[base + ANCHOR_WEIGHT] = newAnchor;
      addPendingNodeWeightDelta(
        current,
        leaf,
        generation,
        prepareDelta,
        effectDelta,
        anchorDelta,
      );
    }

    while (current.length > 0) {
      for (const node of current) {
        this.structuralOperationCount++;
        const prepareDelta = node.pendingPrepareDelta;
        const effectDelta = node.pendingEffectDelta;
        const anchorDelta = node.pendingAnchorDelta;
        node.prepareSum += prepareDelta;
        node.effectSum += effectDelta;
        node.anchorSum += anchorDelta;
        if (node.parent !== null) {
          addPendingNodeWeightDelta(
            next,
            node.parent,
            generation,
            prepareDelta,
            effectDelta,
            anchorDelta,
          );
        }
      }
      current.length = 0;
      const completed = current;
      current = next;
      next = completed;
    }
  }

  private nextWeightUpdateGeneration(): number {
    this.weightUpdateGeneration++;
    if (Number.isSafeInteger(this.weightUpdateGeneration)) {
      return this.weightUpdateGeneration;
    }

    if (this.root !== null) {
      const stack: IndexedNode<T>[] = [this.root];
      while (stack.length > 0) {
        const node = stack.pop()!;
        node.pendingWeightGeneration = 0;
        if (node.kind === "internal") {
          stack.push(...node.children);
        }
      }
    }
    this.weightUpdateGeneration = 1;
    return this.weightUpdateGeneration;
  }

  /**
   * Refresh a mutated anchor and insert its split continuation in one leaf
   * operation. Returns `false` without changing the sequence when the anchor
   * is unavailable or the inserted object is already resident.
   *
   * The cached anchor weights are read before the new weights are evaluated,
   * then the leaf's slots are shifted once and one combined delta is walked
   * through the ancestors. This is the record-split counterpart to calling
   * {@link updateItem} followed by {@link insertManyAfter}, without paying for
   * two location lookups and two aggregate walks.
   */
  updateAndInsertAfter(anchor: T, inserted: T): boolean {
    const leaf = this.leafOf(anchor);
    if (leaf === null || this.leafOf(inserted) !== null) {
      return false;
    }
    this.assertDetached(inserted);

    this.structuralOperationCount++;
    const offset = this.offsetInLeaf(leaf, anchor);
    const weights = leaf.weights;
    const base = offset * WEIGHT_STRIDE;
    const oldPrepare = weights[base + PREPARE_WEIGHT] ?? 0;
    const oldEffect = weights[base + EFFECT_WEIGHT] ?? 0;
    const oldAnchor = weights[base + ANCHOR_WEIGHT] ?? 0;
    const anchorPrepare = this.prepareWeight(anchor);
    const anchorEffect = this.effectWeight(anchor);
    const anchorAnchor = this.anchorWeight(anchor);
    const insertedPrepare = this.prepareWeight(inserted);
    const insertedEffect = this.effectWeight(inserted);
    const insertedAnchor = this.anchorWeight(inserted);

    insertSlot(
      leaf,
      offset + 1,
      inserted,
      insertedPrepare,
      insertedEffect,
      insertedAnchor,
    );
    weights[base + PREPARE_WEIGHT] = anchorPrepare;
    weights[base + EFFECT_WEIGHT] = anchorEffect;
    weights[base + ANCHOR_WEIGHT] = anchorAnchor;

    this.propagateDelta(
      leaf,
      1,
      anchorPrepare - oldPrepare + insertedPrepare,
      anchorEffect - oldEffect + insertedEffect,
      anchorAnchor - oldAnchor + insertedAnchor,
    );
    if (leaf.items.length > LEAF_CAPACITY) {
      this.splitLeaf(leaf);
    }
    return true;
  }

  updateWeights(): void {
    if (this.root) {
      this.refreshAll(this.root);
    }
  }

  prepareIndexToPosition(index: number, allowEnd: boolean): number {
    return this.weightIndexToPosition(index, allowEnd, "prepare");
  }

  /**
   * Variant of {@link prepareIndexToPosition} that also reports how far into the
   * landing record the requested prepare-index falls. Used by partial replay to
   * split multi-character placeholder records at the right offset.
   */
  prepareIndexToPositionAndOffset(
    index: number,
    allowEnd: boolean,
  ): { readonly position: number; readonly offsetInRecord: number } {
    return this.weightIndexToPositionAndOffset(index, allowEnd, "prepare");
  }

  /**
   * Resolve an insertion boundary in the prepare-visible document.
   *
   * A weighted record may contain prepare-hidden gaps. In that case the
   * boundary before visible character `index` is not necessarily the content
   * offset of that character: insertion must stay immediately after the
   * previous visible code unit and before every following hidden anchor. This
   * differs from delete/read lookup, which needs the actual kth visible code
   * unit and continues to use {@link prepareIndexToPositionAndOffset}.
   */
  prepareBoundaryToPositionAndOffset(index: number): {
    readonly position: number;
    readonly offsetInRecord: number;
  } {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > this.prepareLength
    ) {
      throw new IndexOutOfRangeError(`Index ${index} out of bounds`);
    }
    if (index === 0) {
      return { position: 0, offsetInRecord: 0 };
    }

    const previous = this.weightIndexToPositionAndOffset(
      index - 1,
      false,
      "prepare",
    );
    return {
      position: previous.position,
      offsetInRecord: previous.offsetInRecord + 1,
    };
  }

  /**
   * Non-throwing variant of {@link prepareIndexToPositionAndOffset}.
   *
   * Returns `undefined` when `index` falls outside the prepare-visible
   * weight range (negative index, empty tree without `allowEnd`, or
   * `index >= prepareSum`). Distinguishes this expected "ran past the
   * end" condition from structural bugs in the ranked B-tree, which
   * still throw and propagate. Callers that legitimately tolerate
   * indexes past the end (e.g. defensive replay of a delete event
   * whose `length` exceeds the visible prepare items at the parent
   * version) should use this method instead of wrapping the throwing
   * variant in a try/catch that swallows every error indiscriminately.
   *
   * The implementation delegates to the throwing variant and only
   * catches {@link IndexOutOfRangeError} — any other thrown error
   * (e.g. an aggregate-sum inconsistency in the ranked B-tree) is
   * propagated to the caller. This is preferred over a precheck that
   * duplicates the throwing variant's range checks, because the two
   * paths would otherwise have to be kept in lockstep.
   */
  tryPrepareIndexToPositionAndOffset(
    index: number,
    allowEnd: boolean,
  ):
    | { readonly position: number; readonly offsetInRecord: number }
    | undefined {
    try {
      return this.weightIndexToPositionAndOffset(index, allowEnd, "prepare");
    } catch (error) {
      if (error instanceof IndexOutOfRangeError) {
        return undefined;
      }
      throw error;
    }
  }

  effectIndexBeforePosition(position: number): number {
    return this.prefixSum(position, "effect");
  }

  nextPrepareVisiblePosition(start: number): number | null {
    return this.nextWeightedPosition(start, "prepare");
  }

  /** Next record that exists in the current prepare version, including a
   * delete-hidden ordering anchor whose visible width is zero. */
  nextPrepareAnchorPosition(start: number): number | null {
    return this.nextWeightedPosition(start, "anchor");
  }

  /**
   * Position of the prepare-visible record immediately to the left of
   * {@link end}, or `null` when no such record exists.
   *
   * Counterpart to {@link nextPrepareVisiblePosition}: callers that need
   * the previous record visible at the current prepare-state (e.g. when
   * computing an integration `originLeft`) should use this method
   * instead of walking the sequence linearly.
   */
  previousPrepareVisiblePosition(end: number): number | null {
    if (!this.root || end <= 0) {
      return null;
    }

    return this.findPreviousWeightedPosition(
      this.root,
      Math.min(end, this.root.size),
      "prepare",
      0,
    );
  }

  /**
   * Find the first record at or after `start` with a positive weight.
   *
   * Descend by record count once, then use subtree weight aggregates to skip
   * hidden siblings. The previous implementation first computed a weighted
   * prefix and then descended from the root a second time to resolve that
   * weight; this combined traversal visits each tree level only once.
   */
  private nextWeightedPosition(
    start: number,
    kind: "prepare" | "anchor",
  ): number | null {
    if (start < 0 || start >= this.length || !this.root) {
      return null;
    }
    return this.findNextWeightedPosition(this.root, start, kind, 0);
  }

  private findNextWeightedPosition(
    node: IndexedNode<T>,
    start: number,
    kind: "prepare" | "anchor",
    nodePosition: number,
  ): number | null {
    if (node.kind === "leaf") {
      for (let offset = start; offset < node.items.length; offset++) {
        this.structuralOperationCount++;
        if (this.leafWeight(node, offset, kind) > 0) {
          return nodePosition + offset;
        }
      }
      return null;
    }

    let remaining = start;
    let childPosition = nodePosition;
    for (let childIndex = 0; childIndex < node.children.length; childIndex++) {
      this.structuralOperationCount++;
      const child = node.children[childIndex]!;
      if (remaining < child.size) {
        const local = this.findNextWeightedPosition(
          child,
          remaining,
          kind,
          childPosition,
        );
        if (local !== null) {
          return local;
        }

        childPosition += child.size;
        for (
          let siblingIndex = childIndex + 1;
          siblingIndex < node.children.length;
          siblingIndex++
        ) {
          this.structuralOperationCount++;
          const sibling = node.children[siblingIndex]!;
          if (this.weightSum(sibling, kind) > 0) {
            return this.findFirstWeightedPosition(sibling, kind, childPosition);
          }
          childPosition += sibling.size;
        }
        return null;
      }
      remaining -= child.size;
      childPosition += child.size;
    }
    return null;
  }

  private findPreviousWeightedPosition(
    node: IndexedNode<T>,
    end: number,
    kind: "prepare",
    nodePosition: number,
  ): number | null {
    if (node.kind === "leaf") {
      for (
        let offset = Math.min(end, node.items.length) - 1;
        offset >= 0;
        offset--
      ) {
        this.structuralOperationCount++;
        if (this.leafWeight(node, offset, kind) > 0) {
          return nodePosition + offset;
        }
      }
      return null;
    }

    let remaining = Math.min(end, node.size);
    let childPosition = nodePosition;
    for (let childIndex = 0; childIndex < node.children.length; childIndex++) {
      this.structuralOperationCount++;
      const child = node.children[childIndex]!;
      if (remaining <= child.size) {
        const local = this.findPreviousWeightedPosition(
          child,
          remaining,
          kind,
          childPosition,
        );
        if (local !== null) {
          return local;
        }

        for (
          let siblingIndex = childIndex - 1;
          siblingIndex >= 0;
          siblingIndex--
        ) {
          this.structuralOperationCount++;
          const sibling = node.children[siblingIndex]!;
          childPosition -= sibling.size;
          if (this.weightSum(sibling, kind) > 0) {
            return this.findLastWeightedPosition(sibling, kind, childPosition);
          }
        }
        return null;
      }
      remaining -= child.size;
      childPosition += child.size;
    }
    return null;
  }

  private findFirstWeightedPosition(
    node: IndexedNode<T>,
    kind: "prepare" | "anchor",
    nodePosition: number,
  ): number | null {
    if (node.kind === "leaf") {
      for (let offset = 0; offset < node.items.length; offset++) {
        this.structuralOperationCount++;
        if (this.leafWeight(node, offset, kind) > 0) {
          return nodePosition + offset;
        }
      }
      return null;
    }

    let childPosition = nodePosition;
    for (const child of node.children) {
      this.structuralOperationCount++;
      if (this.weightSum(child, kind) > 0) {
        return this.findFirstWeightedPosition(child, kind, childPosition);
      }
      childPosition += child.size;
    }
    return null;
  }

  private findLastWeightedPosition(
    node: IndexedNode<T>,
    kind: "prepare",
    nodePosition: number,
  ): number | null {
    if (node.kind === "leaf") {
      for (let offset = node.items.length - 1; offset >= 0; offset--) {
        this.structuralOperationCount++;
        if (this.leafWeight(node, offset, kind) > 0) {
          return nodePosition + offset;
        }
      }
      return null;
    }

    let childPosition = nodePosition + node.size;
    for (let index = node.children.length - 1; index >= 0; index--) {
      this.structuralOperationCount++;
      const child = node.children[index]!;
      childPosition -= child.size;
      if (this.weightSum(child, kind) > 0) {
        return this.findLastWeightedPosition(child, kind, childPosition);
      }
    }
    return null;
  }

  private bulkLoad(items: ReadonlyArray<T>): void {
    const leaves: LeafNode<T>[] = [];
    for (let start = 0; start < items.length; start += LEAF_CAPACITY) {
      const leaf = createLeaf<T>(this.tree);
      const end = Math.min(start + LEAF_CAPACITY, items.length);
      for (let index = start; index < end; index++) {
        const item = items[index];
        if (!item) {
          continue;
        }
        this.assertDetached(item);
        const prepare = this.prepareWeight(item);
        const effect = this.effectWeight(item);
        const anchor = this.anchorWeight(item);
        item.sequenceLeaf = leaf;
        leaf.items.push(item);
        leaf.weights.push(prepare, effect, anchor);
        leaf.size++;
        leaf.prepareSum += prepare;
        leaf.effectSum += effect;
        leaf.anchorSum += anchor;
      }
      leaves.push(leaf);
    }

    if (this.maintainOrder) {
      this.leafOrder.resetFromItems(leaves);
    }
    this.root = this.buildBalancedTree(leaves);
  }

  /** The leaf of this sequence that holds `item`, or `null`. */
  private leafOf(item: T): LeafNode<T> | null {
    const leaf = item.sequenceLeaf;
    return leaf !== null && leaf.tree === this.tree ? leaf : null;
  }

  /**
   * Offset of a resident item in its leaf. A leaf holds at most
   * {@link LEAF_CAPACITY} items between operations, so scanning it is cheaper
   * than updating the cached offset of every item an insert shifts.
   */
  private offsetInLeaf(leaf: LeafNode<T>, item: T): number {
    const items = leaf.items;
    for (let offset = 0; offset < items.length; offset++) {
      if (items[offset] === item) {
        return offset;
      }
    }
    throw new Error("IndexedSequence item is missing from its leaf");
  }

  /** Reject an item that a live sequence, this one or another, still holds. */
  private assertDetached(item: T): void {
    const leaf = item.sequenceLeaf;
    if (leaf !== null && leaf.tree.live) {
      throw new Error("IndexedSequence item already belongs to a sequence");
    }
  }

  private insertManyAtAnchor(
    anchor: T,
    items: ReadonlyArray<T>,
    after: boolean,
  ): boolean {
    const leaf = this.leafOf(anchor);
    if (leaf === null) {
      return false;
    }
    if (items.length === 0) {
      return true;
    }
    const offset = this.offsetInLeaf(leaf, anchor) + (after ? 1 : 0);
    if (items.length > LEAF_CAPACITY) {
      this.insertMany(this.positionOfNode(leaf) + offset, items);
      return true;
    }

    this.structuralOperationCount++;
    this.insertManyIntoLeaf(leaf, offset, items);
    return true;
  }

  private buildBalancedTree(
    nodes: ReadonlyArray<IndexedNode<T>>,
  ): IndexedNode<T> | null {
    if (nodes.length === 0) {
      return null;
    }

    let level = [...nodes];
    while (level.length > 1) {
      const nextLevel: InternalNode<T>[] = [];
      for (let start = 0; start < level.length; start += BRANCH_FACTOR) {
        nextLevel.push(
          createInternal(level.slice(start, start + BRANCH_FACTOR)),
        );
      }
      level = nextLevel;
    }

    return level[0] ?? null;
  }

  private insertIntoLeaf(leaf: LeafNode<T>, offset: number, item: T): void {
    this.assertDetached(item);
    const prepare = this.prepareWeight(item);
    const effect = this.effectWeight(item);
    const anchor = this.anchorWeight(item);

    insertSlot(leaf, offset, item, prepare, effect, anchor);
    this.propagateDelta(leaf, 1, prepare, effect, anchor);

    if (leaf.items.length > LEAF_CAPACITY) {
      this.splitLeaf(leaf);
    }
  }

  private insertManyIntoLeaf(
    leaf: LeafNode<T>,
    offset: number,
    items: ReadonlyArray<T>,
  ): void {
    for (const item of items) {
      this.assertDetached(item);
    }
    const weights: number[] = [];
    let prepareSum = 0;
    let effectSum = 0;
    let anchorSum = 0;
    for (const item of items) {
      const prepare = this.prepareWeight(item);
      const effect = this.effectWeight(item);
      const anchor = this.anchorWeight(item);
      weights.push(prepare, effect, anchor);
      prepareSum += prepare;
      effectSum += effect;
      anchorSum += anchor;
      item.sequenceLeaf = leaf;
    }

    insertRange(leaf.items, offset, items);
    insertRange(leaf.weights, offset * WEIGHT_STRIDE, weights);
    this.propagateDelta(leaf, items.length, prepareSum, effectSum, anchorSum);

    if (leaf.items.length > LEAF_CAPACITY) {
      this.splitLeaf(leaf);
    }
  }

  private splitLeaf(leaf: LeafNode<T>): void {
    this.structuralOperationCount++;
    const midpoint = Math.ceil(leaf.items.length / 2);
    const sibling = createLeaf<T>(
      this.tree,
      leaf.items.slice(midpoint),
      leaf.weights.slice(midpoint * WEIGHT_STRIDE),
    );
    leaf.items.length = midpoint;
    leaf.weights.length = midpoint * WEIGHT_STRIDE;

    const movedItems = sibling.items;
    const movedWeights = sibling.weights;
    let movedPrepareSum = 0;
    let movedEffectSum = 0;
    let movedAnchorSum = 0;
    for (let index = 0; index < movedItems.length; index++) {
      const base = index * WEIGHT_STRIDE;
      movedPrepareSum += movedWeights[base + PREPARE_WEIGHT] ?? 0;
      movedEffectSum += movedWeights[base + EFFECT_WEIGHT] ?? 0;
      movedAnchorSum += movedWeights[base + ANCHOR_WEIGHT] ?? 0;
      movedItems[index]!.sequenceLeaf = sibling;
    }

    leaf.size = leaf.items.length;
    leaf.prepareSum -= movedPrepareSum;
    leaf.effectSum -= movedEffectSum;
    leaf.anchorSum -= movedAnchorSum;

    sibling.size = movedItems.length;
    sibling.prepareSum = movedPrepareSum;
    sibling.effectSum = movedEffectSum;
    sibling.anchorSum = movedAnchorSum;

    if (this.maintainOrder && !this.leafOrder.insertAfter(leaf, sibling)) {
      throw new Error("Indexed sequence leaf order is unavailable");
    }
    this.insertSiblingAfter(leaf, sibling);
  }

  private splitInternal(node: InternalNode<T>): void {
    this.structuralOperationCount++;
    const midpoint = Math.ceil(node.children.length / 2);
    const movedChildren = node.children.splice(midpoint);

    let movedSize = 0;
    let movedPrepareSum = 0;
    let movedEffectSum = 0;
    let movedAnchorSum = 0;
    for (const child of movedChildren) {
      movedSize += child.size;
      movedPrepareSum += child.prepareSum;
      movedEffectSum += child.effectSum;
      movedAnchorSum += child.anchorSum;
    }

    node.size -= movedSize;
    node.prepareSum -= movedPrepareSum;
    node.effectSum -= movedEffectSum;
    node.anchorSum -= movedAnchorSum;

    const sibling = createInternal(movedChildren);
    this.insertSiblingAfter(node, sibling);
  }

  private insertSiblingAfter(
    node: IndexedNode<T>,
    sibling: IndexedNode<T>,
  ): void {
    const parent = node.parent;
    if (!parent) {
      // `node` was the root: wrap it and its new sibling in a fresh
      // internal node. `node`'s and `sibling`'s sums are already
      // correct, so `createInternal` just adds them.
      this.root = createInternal([node, sibling]);
      return;
    }

    const nodeIndex = node.childIndex;
    parent.children.splice(nodeIndex + 1, 0, sibling);
    sibling.parent = parent;
    sibling.childIndex = nodeIndex + 1;
    for (let index = nodeIndex + 2; index < parent.children.length; index++) {
      const shifted = parent.children[index];
      if (shifted) {
        shifted.childIndex = index;
      }
    }

    // No delta propagation: the moved subtree's weight left `node`'s
    // edge and rejoined `parent` via `sibling`, so `parent` and its
    // ancestors net zero change.

    if (parent.children.length > BRANCH_FACTOR) {
      this.splitInternal(parent);
    }
  }

  private findLeafByRecordIndex(index: number): {
    readonly leaf: LeafNode<T>;
    readonly offset: number;
  } {
    if (!this.root || index < 0 || index >= this.root.size) {
      throw new Error(`Index ${index} out of bounds`);
    }

    let node = this.root;
    let remaining = index;
    while (node.kind === "internal") {
      let child: IndexedNode<T> | undefined;
      for (const candidate of node.children) {
        this.structuralOperationCount++;
        if (remaining < candidate.size) {
          child = candidate;
          break;
        }
        remaining -= candidate.size;
      }
      if (!child) {
        throw new Error(`Index ${index} out of bounds`);
      }
      node = child;
    }

    return { leaf: node, offset: remaining };
  }

  private findRightmostLeaf(): {
    readonly leaf: LeafNode<T>;
    readonly offset: number;
  } {
    if (!this.root) {
      throw new Error("Cannot find rightmost leaf in an empty sequence");
    }

    let node = this.root;
    while (node.kind === "internal") {
      this.structuralOperationCount++;
      const child = node.children[node.children.length - 1];
      if (!child) {
        throw new Error("Encountered empty internal node");
      }
      node = child;
    }

    return { leaf: node, offset: node.items.length };
  }

  private positionOfNode(node: IndexedNode<T>): number {
    let position = 0;
    let current: IndexedNode<T> = node;

    while (current.parent) {
      this.structuralOperationCount++;
      const parent = current.parent;
      const childIndex = current.childIndex;
      for (let index = 0; index < childIndex; index++) {
        this.structuralOperationCount++;
        position += parent.children[index]?.size ?? 0;
      }
      current = parent;
    }

    return position;
  }

  private prefixSum(
    position: number,
    kind: "prepare" | "effect" | "anchor",
  ): number {
    if (!this.root) {
      return 0;
    }

    let remaining = Math.min(Math.max(position, 0), this.root.size);
    let node: IndexedNode<T> = this.root;
    let total = 0;

    while (node.kind === "internal") {
      let child: IndexedNode<T> | undefined;
      for (const candidate of node.children) {
        this.structuralOperationCount++;
        if (remaining <= candidate.size) {
          child = candidate;
          break;
        }
        remaining -= candidate.size;
        total += this.weightSum(candidate, kind);
      }
      if (!child) {
        return total;
      }
      node = child;
    }

    for (let offset = 0; offset < remaining; offset++) {
      this.structuralOperationCount++;
      total += this.leafWeight(node, offset, kind);
    }

    return total;
  }

  private weightIndexToPosition(
    index: number,
    allowEnd: boolean,
    kind: WeightKind,
  ): number {
    return this.weightIndexToPositionAndOffset(index, allowEnd, kind).position;
  }

  private weightIndexToPositionAndOffset(
    index: number,
    allowEnd: boolean,
    kind: WeightKind,
  ): { readonly position: number; readonly offsetInRecord: number } {
    if (index < 0) {
      throw new IndexOutOfRangeError(`Index ${index} out of bounds`);
    }
    if (!this.root) {
      if (allowEnd && index === 0) {
        return { position: 0, offsetInRecord: 0 };
      }
      throw new IndexOutOfRangeError(`Index ${index} out of bounds`);
    }

    const total = this.weightSum(this.root, kind);
    if (allowEnd && index === total) {
      return { position: this.root.size, offsetInRecord: 0 };
    }
    if (index >= total) {
      throw new IndexOutOfRangeError(`Index ${index} out of bounds`);
    }

    let remaining = index;
    let position = 0;
    let node: IndexedNode<T> = this.root;

    while (node.kind === "internal") {
      let child: IndexedNode<T> | undefined;
      for (const candidate of node.children) {
        this.structuralOperationCount++;
        const childSum = this.weightSum(candidate, kind);
        if (remaining < childSum) {
          child = candidate;
          break;
        }
        remaining -= childSum;
        position += candidate.size;
      }
      if (!child) {
        // Structural-invariant violation: the prepareSum/effectSum
        // aggregate said `index` was reachable, but no child claimed
        // it. This is a B-tree bug, not an out-of-range index, so we
        // throw a generic `Error` that the try-helper does NOT swallow.
        throw new Error(
          `IndexedSequence aggregate inconsistency: weight ${kind} index ${index} resolved past all children`,
        );
      }
      node = child;
    }

    for (let offset = 0; offset < node.items.length; offset++) {
      this.structuralOperationCount++;
      const weight = this.leafWeight(node, offset, kind);
      if (remaining < weight) {
        const item = node.items[offset];
        if (item === undefined) {
          throw new Error(
            `IndexedSequence aggregate inconsistency: weight ${kind} index ${index} resolved to a missing leaf item`,
          );
        }
        return {
          position: position + offset,
          offsetInRecord: this.weightOffsetResolver(item, remaining, kind),
        };
      }
      remaining -= weight;
    }
    // Same as above: the leaf was reached but no slot claimed the
    // remaining weight. Generic `Error` so the try-helper re-raises.
    throw new Error(
      `IndexedSequence aggregate inconsistency: weight ${kind} index ${index} resolved past leaf items`,
    );
  }

  private weightSum(node: IndexedNode<T>, kind: WeightKind): number {
    return kind === "prepare"
      ? node.prepareSum
      : kind === "effect"
        ? node.effectSum
        : node.anchorSum;
  }

  private leafWeight(
    node: LeafNode<T>,
    offset: number,
    kind: WeightKind,
  ): number {
    return (
      node.weights[
        offset * WEIGHT_STRIDE +
          (kind === "prepare"
            ? PREPARE_WEIGHT
            : kind === "effect"
              ? EFFECT_WEIGHT
              : ANCHOR_WEIGHT)
      ] ?? 0
    );
  }

  private propagateDelta(
    start: IndexedNode<T>,
    sizeDelta: number,
    prepareDelta: number,
    effectDelta: number,
    anchorDelta: number,
  ): void {
    let current: IndexedNode<T> | null = start;
    while (current) {
      this.structuralOperationCount++;
      current.size += sizeDelta;
      current.prepareSum += prepareDelta;
      current.effectSum += effectDelta;
      current.anchorSum += anchorDelta;
      current = current.parent;
    }
  }

  /**
   * Recompute every node's cached sums from its current contents. Used
   * by {@link updateWeights} when a caller has mutated multiple items'
   * weights externally; the per-update delta path keeps the tree
   * accurate during normal operation.
   */
  private refreshAll(node: IndexedNode<T>): void {
    if (node.kind === "leaf") {
      let prepareSum = 0;
      let effectSum = 0;
      let anchorSum = 0;
      const weights = node.weights;
      for (let index = 0; index < node.items.length; index++) {
        const item = node.items[index];
        if (!item) {
          continue;
        }
        const prepare = this.prepareWeight(item);
        const effect = this.effectWeight(item);
        const anchor = this.anchorWeight(item);
        const base = index * WEIGHT_STRIDE;
        weights[base + PREPARE_WEIGHT] = prepare;
        weights[base + EFFECT_WEIGHT] = effect;
        weights[base + ANCHOR_WEIGHT] = anchor;
        prepareSum += prepare;
        effectSum += effect;
        anchorSum += anchor;
      }
      weights.length = node.items.length * WEIGHT_STRIDE;
      node.size = node.items.length;
      node.prepareSum = prepareSum;
      node.effectSum = effectSum;
      node.anchorSum = anchorSum;
      return;
    }

    let size = 0;
    let prepareSum = 0;
    let effectSum = 0;
    let anchorSum = 0;
    for (const child of node.children) {
      this.refreshAll(child);
      size += child.size;
      prepareSum += child.prepareSum;
      effectSum += child.effectSum;
      anchorSum += child.anchorSum;
    }
    node.size = size;
    node.prepareSum = prepareSum;
    node.effectSum = effectSum;
    node.anchorSum = anchorSum;
  }

  private visit(node: IndexedNode<T>, visitor: (item: T) => void): void {
    if (node.kind === "leaf") {
      for (const item of node.items) {
        visitor(item);
      }
      return;
    }

    for (const child of node.children) {
      this.visit(child, visitor);
    }
  }
}

const addPendingNodeWeightDelta = <T extends object>(
  touched: IndexedNode<T>[],
  node: IndexedNode<T>,
  generation: number,
  prepare: number,
  effect: number,
  anchor: number,
): void => {
  if (node.pendingWeightGeneration !== generation) {
    node.pendingWeightGeneration = generation;
    node.pendingPrepareDelta = prepare;
    node.pendingEffectDelta = effect;
    node.pendingAnchorDelta = anchor;
    touched.push(node);
    return;
  }
  node.pendingPrepareDelta += prepare;
  node.pendingEffectDelta += effect;
  node.pendingAnchorDelta += anchor;
};

/**
 * Insert one item and its weights at `offset`, shifting the later slots of
 * both leaf arrays right in place. Each array first grows at its end, in
 * index order, so it stays packed.
 */
const insertSlot = <T extends IndexedSequenceItem<T>>(
  leaf: LeafNode<T>,
  offset: number,
  item: T,
  prepare: number,
  effect: number,
  anchor: number,
): void => {
  const items = leaf.items;
  const weights = leaf.weights;
  const length = items.length;
  item.sequenceLeaf = leaf;
  if (offset === length) {
    items.push(item);
    weights.push(prepare, effect, anchor);
    return;
  }

  items.push(items[length - 1]!);
  for (let slot = length - 1; slot > offset; slot--) {
    items[slot] = items[slot - 1]!;
  }
  items[offset] = item;

  const base = offset * WEIGHT_STRIDE;
  const end = length * WEIGHT_STRIDE;
  weights.push(weights[end - 3]!, weights[end - 2]!, weights[end - 1]!);
  for (let index = end - 1; index >= base + WEIGHT_STRIDE; index--) {
    weights[index] = weights[index - WEIGHT_STRIDE]!;
  }
  weights[base + PREPARE_WEIGHT] = prepare;
  weights[base + EFFECT_WEIGHT] = effect;
  weights[base + ANCHOR_WEIGHT] = anchor;
};

/**
 * Insert `inserted` at `start`, shifting later values right in place. The
 * array grows at its end in index order, so it stays packed.
 */
const insertRange = <V>(
  values: V[],
  start: number,
  inserted: ReadonlyArray<V>,
): void => {
  const length = values.length;
  const count = inserted.length;
  for (let index = length; index < length + count; index++) {
    values.push(
      index - count >= start
        ? values[index - count]!
        : inserted[index - start]!,
    );
  }
  for (let index = length - 1; index >= start + count; index--) {
    values[index] = values[index - count]!;
  }
  const filledEnd = Math.min(start + count, length);
  for (let index = start; index < filledEnd; index++) {
    values[index] = inserted[index - start]!;
  }
};
