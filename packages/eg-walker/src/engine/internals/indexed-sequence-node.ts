export const LEAF_CAPACITY = 64;
export const BRANCH_FACTOR = 32;

export type IndexedNode<T extends object> = LeafNode<T> | InternalNode<T>;

interface NodeBase<T extends object> {
  parent: InternalNode<T> | null;
  childIndex: number;
  size: number;
  prepareSum: number;
  effectSum: number;
}

export interface LeafNode<T extends object> extends NodeBase<T> {
  readonly kind: "leaf";
  readonly items: T[];
  readonly prepareWeights: number[];
  readonly effectWeights: number[];
}

export interface InternalNode<T extends object> extends NodeBase<T> {
  readonly kind: "internal";
  readonly children: IndexedNode<T>[];
}

export interface ItemLocation<T extends object> {
  leaf: LeafNode<T>;
  offsetInLeaf: number;
}

export const createLeaf = <T extends object>(): LeafNode<T> => ({
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

export const createInternal = <T extends object>(
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
