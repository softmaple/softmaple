const LEAF_CAPACITY = 64;
const BRANCH_FACTOR = 32;

type IndexedNode<T extends object> = LeafNode<T> | InternalNode<T>;

interface NodeBase<T extends object> {
  parent: InternalNode<T> | null;
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
}

const createLeaf = <T extends object>(): LeafNode<T> => ({
  kind: "leaf",
  parent: null,
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
  const node: InternalNode<T> = {
    kind: "internal",
    parent: null,
    children,
    size: 0,
    prepareSum: 0,
    effectSum: 0,
  };
  for (const child of children) {
    child.parent = node;
  }
  refresh(node);
  return node;
};

const sum = (values: ReadonlyArray<number>): number =>
  values.reduce((total, value) => total + value, 0);

const refresh = <T extends object>(node: IndexedNode<T>): void => {
  if (node.kind === "leaf") {
    node.size = node.items.length;
    node.prepareSum = sum(node.prepareWeights);
    node.effectSum = sum(node.effectWeights);
    return;
  }

  node.size = sum(node.children.map((child) => child.size));
  node.prepareSum = sum(node.children.map((child) => child.prepareSum));
  node.effectSum = sum(node.children.map((child) => child.effectSum));
};

/**
 * Ranked B-tree for Eg-walker's mutable CRDT sequence.
 *
 * Each leaf stores a cache-sized run of CRDT items and each internal edge keeps
 * three ranks: record count, prepare-visible count, and effect-visible count.
 * This mirrors the paper's B-tree indexes while the separate WeakMap provides
 * O(log n) event-ID-to-record mapping after the caller resolves the event ID.
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

    const leafOffset = location.leaf.items.indexOf(item);
    if (leafOffset === -1) {
      return -1;
    }

    return this.positionOfNode(location.leaf) + leafOffset;
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

    const offset = location.leaf.items.indexOf(item);
    if (offset === -1) {
      return;
    }

    location.leaf.prepareWeights[offset] = this.prepareWeight(item);
    location.leaf.effectWeights[offset] = this.effectWeight(item);
    this.refreshUp(location.leaf);
  }

  updateWeights(): void {
    if (this.root) {
      this.refreshAll(this.root);
    }
  }

  prepareIndexToPosition(index: number, allowEnd: boolean): number {
    return this.weightIndexToPosition(index, allowEnd, "prepare");
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

  private insertIntoLeaf(leaf: LeafNode<T>, offset: number, item: T): void {
    leaf.items.splice(offset, 0, item);
    leaf.prepareWeights.splice(offset, 0, this.prepareWeight(item));
    leaf.effectWeights.splice(offset, 0, this.effectWeight(item));
    this.locationsByItem.set(item, { leaf });
    this.refreshUp(leaf);

    if (leaf.items.length > LEAF_CAPACITY) {
      this.splitLeaf(leaf);
    }
  }

  private splitLeaf(leaf: LeafNode<T>): void {
    const midpoint = Math.ceil(leaf.items.length / 2);
    const sibling = createLeaf<T>();

    sibling.items.push(...leaf.items.splice(midpoint));
    sibling.prepareWeights.push(...leaf.prepareWeights.splice(midpoint));
    sibling.effectWeights.push(...leaf.effectWeights.splice(midpoint));

    for (const item of sibling.items) {
      this.locationsByItem.set(item, { leaf: sibling });
    }

    refresh(leaf);
    refresh(sibling);
    this.insertSiblingAfter(leaf, sibling);
  }

  private splitInternal(node: InternalNode<T>): void {
    const midpoint = Math.ceil(node.children.length / 2);
    const sibling = createInternal(node.children.splice(midpoint));
    refresh(node);
    this.insertSiblingAfter(node, sibling);
  }

  private insertSiblingAfter(
    node: IndexedNode<T>,
    sibling: IndexedNode<T>,
  ): void {
    const parent = node.parent;
    if (!parent) {
      this.root = createInternal([node, sibling]);
      return;
    }

    const nodeIndex = parent.children.indexOf(node);
    parent.children.splice(nodeIndex + 1, 0, sibling);
    sibling.parent = parent;
    this.refreshUp(parent);

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
      const childIndex = parent.children.indexOf(current);
      for (let i = 0; i < childIndex; i++) {
        position += parent.children[i]?.size ?? 0;
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
    if (index < 0) {
      throw new Error(`Index ${index} out of bounds`);
    }
    if (!this.root) {
      if (allowEnd && index === 0) {
        return 0;
      }
      throw new Error(`Index ${index} out of bounds`);
    }

    const total = this.weightSum(this.root, kind);
    if (allowEnd && index === total) {
      return this.root.size;
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
        return position + offset;
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

  private refreshUp(node: IndexedNode<T>): void {
    let current: IndexedNode<T> | null = node;
    while (current) {
      refresh(current);
      current = current.parent;
    }
  }

  private refreshAll(node: IndexedNode<T>): void {
    if (node.kind === "leaf") {
      node.prepareWeights.splice(
        0,
        node.prepareWeights.length,
        ...node.items.map((item) => this.prepareWeight(item)),
      );
      node.effectWeights.splice(
        0,
        node.effectWeights.length,
        ...node.items.map((item) => this.effectWeight(item)),
      );
      refresh(node);
      return;
    }

    for (const child of node.children) {
      this.refreshAll(child);
    }
    refresh(node);
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
