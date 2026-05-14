const LEAF_CAPACITY = 64;
const BRANCH_FACTOR = 32;

type IndexedNode<T extends object> = LeafNode<T> | InternalNode<T>;

interface NodeBase<T extends object> {
  parent: InternalNode<T> | null;
  // Cached position within `parent.children`. Kept in sync by every code
  // path that mutates a parent's child list so {@link positionOfNode}
  // can walk up without scanning siblings linearly. Meaningless when
  // `parent` is `null`; we leave it at 0 in that case.
  childIndex: number;
  size: number;
  prepareSum: number;
  effectSum: number;
}

interface LeafNode<T extends object> extends NodeBase<T> {
  readonly kind: "leaf";
  readonly items: T[];
  readonly prepareWeights: number[];
  readonly effectWeights: number[];
}

interface InternalNode<T extends object> extends NodeBase<T> {
  readonly kind: "internal";
  readonly children: IndexedNode<T>[];
}

interface ItemLocation<T extends object> {
  leaf: LeafNode<T>;
  // Cached offset of the item within `leaf.items`. Maintained by every
  // splice on `leaf.items` so {@link IndexedSequence.positionOf} and
  // {@link IndexedSequence.updateItem} can skip the O(leaf capacity)
  // `Array.indexOf` scan.
  offsetInLeaf: number;
}

const createLeaf = <T extends object>(): LeafNode<T> => ({
  kind: "leaf",
  parent: null,
  childIndex: 0,
  items: [],
  prepareWeights: [],
  effectWeights: [],
  size: 0,
  prepareSum: 0,
  effectSum: 0,
});

const createInternal = <T extends object>(
  children: IndexedNode<T>[],
): InternalNode<T> => {
  let size = 0;
  let prepareSum = 0;
  let effectSum = 0;
  for (const child of children) {
    size += child.size;
    prepareSum += child.prepareSum;
    effectSum += child.effectSum;
  }
  const node: InternalNode<T> = {
    kind: "internal",
    parent: null,
    childIndex: 0,
    children,
    size,
    prepareSum,
    effectSum,
  };
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!child) {
      continue;
    }
    child.parent = node;
    child.childIndex = index;
  }
  return node;
};

/**
 * Ranked B-tree for Eg-walker's mutable CRDT sequence.
 *
 * Each leaf stores a cache-sized run of CRDT items and each internal edge keeps
 * three ranks: record count, prepare-visible count, and effect-visible count.
 * This mirrors the paper's B-tree indexes while the separate WeakMap provides
 * O(log n) event-ID-to-record mapping after the caller resolves the event ID.
 *
 * The hot maintenance paths — single-item inserts, weight updates, and
 * `positionOf` lookups — all run in O(log n):
 *   - Inserts and weight updates propagate `(size, prepareSum, effectSum)`
 *     deltas to ancestors instead of recomputing every internal node's
 *     sums from its children.
 *   - Each item caches its offset inside its leaf, and each node caches
 *     its index inside its parent, so `positionOf` and `positionOfNode`
 *     skip the inner `Array.indexOf` scans.
 *   - Splits do not propagate deltas at all: the moved subtree's weight
 *     leaves one parent edge and joins another, so the grandparent sums
 *     are unchanged by construction.
 */
export class IndexedSequence<T extends object> {
  private root: IndexedNode<T> | null = null;
  private readonly locationsByItem = new WeakMap<T, ItemLocation<T>>();

  constructor(
    private readonly prepareWeight: (item: T) => number,
    private readonly effectWeight: (item: T) => number,
    items: ReadonlyArray<T> = [],
  ) {
    for (const item of items) {
      this.push(item);
    }
  }

  get length(): number {
    return this.root?.size ?? 0;
  }

  toArray(): T[] {
    const items: T[] = [];
    if (this.root) {
      this.visit(this.root, (item) => items.push(item));
    }
    return items;
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
    const location = this.locationsByItem.get(item);
    if (!location) {
      return -1;
    }
    if (location.leaf.items[location.offsetInLeaf] !== item) {
      // Defensive fallback: the cached offset disagrees with the leaf
      // contents (should not happen, but be resilient to bugs).
      const offset = location.leaf.items.indexOf(item);
      if (offset === -1) {
        return -1;
      }
      location.offsetInLeaf = offset;
    }
    return this.positionOfNode(location.leaf) + location.offsetInLeaf;
  }

  clear(): void {
    this.root = null;
  }

  insert(index: number, item: T): void {
    if (index < 0 || index > this.length) {
      throw new Error(`Insert index ${index} out of bounds`);
    }

    if (!this.root) {
      const leaf = createLeaf<T>();
      this.root = leaf;
      this.insertIntoLeaf(leaf, 0, item);
      return;
    }

    const { leaf, offset } =
      index === this.length
        ? this.findRightmostLeaf()
        : this.findLeafByRecordIndex(index);
    this.insertIntoLeaf(leaf, offset, item);
  }

  push(item: T): void {
    this.insert(this.length, item);
  }

  updateItem(item: T): void {
    const location = this.locationsByItem.get(item);
    if (!location) {
      return;
    }

    const leaf = location.leaf;
    let offset = location.offsetInLeaf;
    if (leaf.items[offset] !== item) {
      const recovered = leaf.items.indexOf(item);
      if (recovered === -1) {
        return;
      }
      offset = recovered;
      location.offsetInLeaf = recovered;
    }

    const oldPrepare = leaf.prepareWeights[offset] ?? 0;
    const oldEffect = leaf.effectWeights[offset] ?? 0;
    const newPrepare = this.prepareWeight(item);
    const newEffect = this.effectWeight(item);
    const prepareDelta = newPrepare - oldPrepare;
    const effectDelta = newEffect - oldEffect;
    if (prepareDelta === 0 && effectDelta === 0) {
      return;
    }

    leaf.prepareWeights[offset] = newPrepare;
    leaf.effectWeights[offset] = newEffect;
    this.propagateDelta(leaf, 0, prepareDelta, effectDelta);
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
   */
  tryPrepareIndexToPositionAndOffset(
    index: number,
    allowEnd: boolean,
  ):
    | { readonly position: number; readonly offsetInRecord: number }
    | undefined {
    if (index < 0) {
      return undefined;
    }
    if (!this.root) {
      if (allowEnd && index === 0) {
        return { position: 0, offsetInRecord: 0 };
      }
      return undefined;
    }
    const total = allowEnd ? this.root.prepareSum + 1 : this.root.prepareSum;
    if (index >= total) {
      return undefined;
    }
    return this.weightIndexToPositionAndOffset(index, allowEnd, "prepare");
  }

  effectIndexBeforePosition(position: number): number {
    return this.prefixSum(position, "effect");
  }

  nextPrepareVisiblePosition(start: number): number | null {
    if (start < 0 || start > this.length || !this.root) {
      return null;
    }

    const before = this.prefixSum(start, "prepare");
    if (before >= this.root.prepareSum) {
      return null;
    }

    return this.weightIndexToPosition(before, false, "prepare");
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

    const clampedEnd = Math.min(end, this.root.size);
    const before = this.prefixSum(clampedEnd, "prepare");
    if (before === 0) {
      return null;
    }
    return this.weightIndexToPosition(before - 1, false, "prepare");
  }

  private insertIntoLeaf(leaf: LeafNode<T>, offset: number, item: T): void {
    const prepare = this.prepareWeight(item);
    const effect = this.effectWeight(item);

    leaf.items.splice(offset, 0, item);
    leaf.prepareWeights.splice(offset, 0, prepare);
    leaf.effectWeights.splice(offset, 0, effect);

    this.locationsByItem.set(item, { leaf, offsetInLeaf: offset });
    for (let index = offset + 1; index < leaf.items.length; index++) {
      const sibling = leaf.items[index];
      if (!sibling) {
        continue;
      }
      const location = this.locationsByItem.get(sibling);
      if (location) {
        location.offsetInLeaf = index;
      }
    }

    this.propagateDelta(leaf, 1, prepare, effect);

    if (leaf.items.length > LEAF_CAPACITY) {
      this.splitLeaf(leaf);
    }
  }

  private splitLeaf(leaf: LeafNode<T>): void {
    const midpoint = Math.ceil(leaf.items.length / 2);
    const sibling = createLeaf<T>();

    const movedItems = leaf.items.splice(midpoint);
    const movedPrepareWeights = leaf.prepareWeights.splice(midpoint);
    const movedEffectWeights = leaf.effectWeights.splice(midpoint);

    sibling.items.push(...movedItems);
    sibling.prepareWeights.push(...movedPrepareWeights);
    sibling.effectWeights.push(...movedEffectWeights);

    let movedPrepareSum = 0;
    let movedEffectSum = 0;
    for (let index = 0; index < movedItems.length; index++) {
      const item = movedItems[index];
      const prepare = movedPrepareWeights[index] ?? 0;
      const effect = movedEffectWeights[index] ?? 0;
      movedPrepareSum += prepare;
      movedEffectSum += effect;
      if (item) {
        this.locationsByItem.set(item, { leaf: sibling, offsetInLeaf: index });
      }
    }

    leaf.size = leaf.items.length;
    leaf.prepareSum -= movedPrepareSum;
    leaf.effectSum -= movedEffectSum;

    sibling.size = sibling.items.length;
    sibling.prepareSum = movedPrepareSum;
    sibling.effectSum = movedEffectSum;

    this.insertSiblingAfter(leaf, sibling);
  }

  private splitInternal(node: InternalNode<T>): void {
    const midpoint = Math.ceil(node.children.length / 2);
    const movedChildren = node.children.splice(midpoint);

    let movedSize = 0;
    let movedPrepareSum = 0;
    let movedEffectSum = 0;
    for (const child of movedChildren) {
      movedSize += child.size;
      movedPrepareSum += child.prepareSum;
      movedEffectSum += child.effectSum;
    }

    node.size -= movedSize;
    node.prepareSum -= movedPrepareSum;
    node.effectSum -= movedEffectSum;

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
      const child = node.children.find((candidate) => {
        if (remaining < candidate.size) {
          return true;
        }
        remaining -= candidate.size;
        return false;
      });
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
      const parent = current.parent;
      const childIndex = current.childIndex;
      for (let index = 0; index < childIndex; index++) {
        position += parent.children[index]?.size ?? 0;
      }
      current = parent;
    }

    return position;
  }

  private prefixSum(position: number, kind: "prepare" | "effect"): number {
    if (!this.root) {
      return 0;
    }

    let remaining = Math.min(Math.max(position, 0), this.root.size);
    let node: IndexedNode<T> = this.root;
    let total = 0;

    while (node.kind === "internal") {
      const child = node.children.find((candidate) => {
        if (remaining <= candidate.size) {
          return true;
        }
        remaining -= candidate.size;
        total += this.weightSum(candidate, kind);
        return false;
      });
      if (!child) {
        return total;
      }
      node = child;
    }

    for (let offset = 0; offset < remaining; offset++) {
      total += this.leafWeight(node, offset, kind);
    }

    return total;
  }

  private weightIndexToPosition(
    index: number,
    allowEnd: boolean,
    kind: "prepare" | "effect",
  ): number {
    return this.weightIndexToPositionAndOffset(index, allowEnd, kind).position;
  }

  private weightIndexToPositionAndOffset(
    index: number,
    allowEnd: boolean,
    kind: "prepare" | "effect",
  ): { readonly position: number; readonly offsetInRecord: number } {
    if (index < 0) {
      throw new Error(`Index ${index} out of bounds`);
    }
    if (!this.root) {
      if (allowEnd && index === 0) {
        return { position: 0, offsetInRecord: 0 };
      }
      throw new Error(`Index ${index} out of bounds`);
    }

    const total = this.weightSum(this.root, kind);
    if (allowEnd && index === total) {
      return { position: this.root.size, offsetInRecord: 0 };
    }
    if (index >= total) {
      throw new Error(`Index ${index} out of bounds`);
    }

    let remaining = index;
    let position = 0;
    let node: IndexedNode<T> = this.root;

    while (node.kind === "internal") {
      const child = node.children.find((candidate) => {
        const childSum = this.weightSum(candidate, kind);
        if (remaining < childSum) {
          return true;
        }
        remaining -= childSum;
        position += candidate.size;
        return false;
      });
      if (!child) {
        throw new Error(`Index ${index} out of bounds`);
      }
      node = child;
    }

    for (let offset = 0; offset < node.items.length; offset++) {
      const weight = this.leafWeight(node, offset, kind);
      if (remaining < weight) {
        return { position: position + offset, offsetInRecord: remaining };
      }
      remaining -= weight;
    }
    throw new Error(`Index ${index} out of bounds`);
  }

  private weightSum(node: IndexedNode<T>, kind: "prepare" | "effect"): number {
    return kind === "prepare" ? node.prepareSum : node.effectSum;
  }

  private leafWeight(
    node: LeafNode<T>,
    offset: number,
    kind: "prepare" | "effect",
  ): number {
    return kind === "prepare"
      ? (node.prepareWeights[offset] ?? 0)
      : (node.effectWeights[offset] ?? 0);
  }

  private propagateDelta(
    start: IndexedNode<T>,
    sizeDelta: number,
    prepareDelta: number,
    effectDelta: number,
  ): void {
    let current: IndexedNode<T> | null = start;
    while (current) {
      current.size += sizeDelta;
      current.prepareSum += prepareDelta;
      current.effectSum += effectDelta;
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
      for (let index = 0; index < node.items.length; index++) {
        const item = node.items[index];
        if (!item) {
          continue;
        }
        const prepare = this.prepareWeight(item);
        const effect = this.effectWeight(item);
        node.prepareWeights[index] = prepare;
        node.effectWeights[index] = effect;
        prepareSum += prepare;
        effectSum += effect;
      }
      node.prepareWeights.length = node.items.length;
      node.effectWeights.length = node.items.length;
      node.size = node.items.length;
      node.prepareSum = prepareSum;
      node.effectSum = effectSum;
      return;
    }

    let size = 0;
    let prepareSum = 0;
    let effectSum = 0;
    for (const child of node.children) {
      this.refreshAll(child);
      size += child.size;
      prepareSum += child.prepareSum;
      effectSum += child.effectSum;
    }
    node.size = size;
    node.prepareSum = prepareSum;
    node.effectSum = effectSum;
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
